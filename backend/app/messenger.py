"""Messenger: one-to-one chats between the signed-in user and their recipients.

The friends are the user's recipients. A message is addressed to an email
address, not to an account: the person reads it once they sign in with that
address, whether they already have an account or register later. So the
endpoints never tell whether an address belongs to an account.

Anyone who received a message can answer it, also when the sender is not among
their own recipients.
"""

from datetime import timedelta
from urllib.parse import quote

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy.orm import aliased

from .auth import ONLINE_FOR, current_user, login_required
from .common import ApiError, Email, Str, as_utc, json_body
from .extensions import db
from .mail import send_email
from .models import Message, Recipient, User, utcnow

messenger = Blueprint("messenger", __name__)

MAX_BODY = 4000
# Most recent messages returned when a chat is opened.
PAGE = 500
# Someone who read or wrote in a chat this recently is taken to be looking at it.
ACTIVE_FOR = timedelta(minutes=10)

TO = Email(required=True, label="Recipient")
BODY = Str(required=True, max_len=MAX_BODY, label="Message")


def _incoming(user, sender_email=None):
    """Condition: messages written to `user`, optionally only those from one address."""
    where = [Message.to_email == user.email]
    if sender_email is not None:
        where.append(
            Message.sender_id.in_(db.select(User.id).where(User.email == sender_email))
        )
    return where


def _peer(user):
    """The address of the other side, from the `with` query argument."""
    email = Email(required=True, label="With").parse("with", request.args.get("with"))
    if email == user.email:
        raise ApiError("You cannot chat with yourself.")
    return email


def _may_write(user, email):
    """Your recipients, and whoever wrote to you first."""
    is_recipient = db.session.scalar(
        db.select(Recipient.id).where(Recipient.user_id == user.id, Recipient.email == email)
    )
    if is_recipient is not None:
        return True
    return db.session.scalar(db.select(Message.id).where(*_incoming(user, email)).limit(1)) is not None


@messenger.get("/conversations")
@login_required
def conversations():
    """The user's recipients, and anyone else they exchanged messages with.

    Each comes with the last message and how many are unread; chats with the
    most recent message first, then the recipients nobody wrote to yet.
    """
    user = current_user()
    people = {}

    def person(email):
        return people.setdefault(
            email,
            {
                "email": email,
                "name": email,
                "recipient_id": None,
                "unread": 0,
                "last": None,
                "online": False,
            },
        )

    recipients = db.session.scalars(db.select(Recipient).where(Recipient.user_id == user.id))
    for recipient in recipients:
        if recipient.email != user.email:
            person(recipient.email).update(name=recipient.full_name, recipient_id=recipient.id)

    last_ids = {}  # address -> id of the last message of the chat with it
    sent = db.session.execute(
        db.select(Message.to_email, db.func.max(Message.id))
        .where(Message.sender_id == user.id)
        .group_by(Message.to_email)
    )
    for email, last_id in sent:
        last_ids[email] = last_id
    received = db.session.execute(
        db.select(
            User.email,
            db.func.max(Message.id),
            db.func.count(Message.id).filter(Message.read_at.is_(None)),
        )
        .join(User, User.id == Message.sender_id)
        .where(*_incoming(user))
        .group_by(User.email)
    )
    for email, last_id, unread in received:
        last_ids[email] = max(last_id, last_ids.get(email, 0))
        person(email)["unread"] = unread

    if last_ids:
        emails = {last_id: email for email, last_id in last_ids.items()}
        for message in db.session.scalars(db.select(Message).where(Message.id.in_(emails))):
            person(emails[message.id])["last"] = message.to_dict(user)

    if people:
        online = db.session.scalars(
            db.select(User.email).where(
                User.email.in_(people),
                User.is_confirmed.is_(True),
                User.last_seen_at > utcnow() - ONLINE_FOR,
            )
        )
        for email in online:
            people[email]["online"] = True

    items = sorted(people.values(), key=lambda p: p["name"].lower())
    items.sort(key=lambda p: p["last"]["id"] if p["last"] else 0, reverse=True)
    return jsonify(items=items)


@messenger.get("/messages")
@login_required
def list_messages():
    """The chat with one address, oldest first; what was unread is now read.

    `after=<id>` returns only newer messages (the page polls with it).
    """
    user = current_user()
    email = _peer(user)
    after = request.args.get("after", default=0, type=int) or 0

    between = db.or_(
        db.and_(Message.sender_id == user.id, Message.to_email == email),
        db.and_(*_incoming(user, email)),
    )
    found = db.session.scalars(
        db.select(Message).where(between, Message.id > after).order_by(Message.id.desc()).limit(PAGE)
    ).all()
    found.reverse()

    now = utcnow()
    unread = [m for m in found if m.sender_id != user.id and m.read_at is None]
    for message in unread:
        message.read_at = now
    if unread:
        db.session.commit()
    return jsonify(items=[m.to_dict(user) for m in found])


@messenger.post("/messages")
@login_required
def send_message():
    user = current_user()
    data = json_body()
    email = TO.parse("to", data.get("to"))
    body = BODY.parse("body", data.get("body"))
    if email == user.email:
        raise ApiError("You cannot write to yourself.")
    if not _may_write(user, email):
        raise ApiError("Add this person to your recipients to write to them.", 403, "not_a_friend")

    notify = _should_notify(user, email)
    message = Message(sender_id=user.id, to_email=email, body=body)
    db.session.add(message)
    db.session.commit()
    if notify:
        _notify(user, email)
    return jsonify(message.to_dict(user)), 201


@messenger.delete("/messages/<int:message_id>")
@login_required
def delete_message(message_id):
    """Take back a message you wrote; it disappears for both sides."""
    message = db.session.get(Message, message_id)
    if message is None or message.sender_id != current_user().id:
        raise ApiError("Message not found.", 404)
    db.session.delete(message)
    db.session.commit()
    return "", 204


# --- Email notice -----------------------------------------------------------------


def _should_notify(user, email):
    """Email a notice for the first message of a burst only.

    Not when an earlier message is still unread (they were told already), and
    not when they read or wrote in this chat a moment ago (they are here).
    """
    sent = [Message.sender_id == user.id, Message.to_email == email]
    waiting = db.session.scalar(db.select(Message.id).where(*sent, Message.read_at.is_(None)).limit(1))
    if waiting is not None:
        return False
    theirs = aliased(Message)
    seen = [
        db.session.scalar(db.select(db.func.max(Message.read_at)).where(*sent)),
        db.session.scalar(
            db.select(db.func.max(theirs.created_at)).where(
                theirs.to_email == user.email,
                theirs.sender_id.in_(db.select(User.id).where(User.email == email)),
            )
        ),
    ]
    recently = utcnow() - ACTIVE_FOR
    return not any(moment is not None and as_utc(moment) > recently for moment in seen)


def _notify(user, email):
    link = f"{current_app.config['FRONTEND_URL']}/messenger?with={quote(user.email, safe='@')}"
    try:
        send_email(
            email,
            f"{user.email} sent you a message on TheBOX",
            f"{user.email} wrote to you in TheBOX Messenger.\n\n"
            f"Read it and answer here:\n{link}\n\n"
            f"Sign in with this email address ({email}). "
            "If you do not have an account yet, register with it first.\n",
        )
    except Exception:
        current_app.logger.exception("Could not send message notice to %s", email)


def unread_count(user):
    return db.session.scalar(
        db.select(db.func.count(Message.id)).where(*_incoming(user), Message.read_at.is_(None))
    )

