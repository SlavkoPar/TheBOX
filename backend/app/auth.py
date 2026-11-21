import re
from functools import wraps

from flask import Blueprint, current_app, jsonify, request, session
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from .extensions import db
from .mail import send_email
from .models import User, utcnow

auth = Blueprint("auth", __name__)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 128
CONFIRM_SALT = "email-confirm"

REGISTER_MESSAGE = "Check your inbox for a link to confirm your email address."
RESEND_MESSAGE = "If that account exists and is not confirmed, a new link has been sent."


def error(message, status):
    return jsonify(error=message), status


def _serializer():
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt=CONFIRM_SALT)


def make_confirm_token(user):
    return _serializer().dumps({"id": user.id, "email": user.email})


def send_confirmation_email(user):
    link = f"{current_app.config['FRONTEND_URL']}/confirm?token={make_confirm_token(user)}"
    hours = current_app.config["CONFIRM_TOKEN_MAX_AGE"] // 3600
    send_email(
        user.email,
        "Confirm your TheBOX account",
        "Welcome to TheBOX.\n\n"
        f"Confirm your email address by opening this link:\n{link}\n\n"
        f"The link expires in {hours} hours. "
        "If you did not create an account, you can ignore this email.\n",
    )


def _try_send_confirmation(user):
    try:
        send_confirmation_email(user)
        return True
    except Exception:
        current_app.logger.exception("Could not send confirmation email to %s", user.email)
        return False


def _credentials():
    data = request.get_json(silent=True) or {}
    email = data.get("email")
    password = data.get("password")
    email = email.strip().lower() if isinstance(email, str) else ""
    password = password if isinstance(password, str) else ""
    return email, password


def current_user():
    user_id = session.get("user_id")
    return db.session.get(User, user_id) if user_id else None


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if current_user() is None:
            return error("Authentication required.", 401)
        return view(*args, **kwargs)

    return wrapped


@auth.post("/register")
def register():
    email, password = _credentials()

    if len(email) > 254 or not EMAIL_RE.match(email):
        return error("Enter a valid email address.", 400)
    if len(password) < MIN_PASSWORD_LENGTH:
        return error(f"Password must be at least {MIN_PASSWORD_LENGTH} characters.", 400)
    if len(password) > MAX_PASSWORD_LENGTH:
        return error(f"Password must be at most {MAX_PASSWORD_LENGTH} characters.", 400)

    user = db.session.scalar(db.select(User).where(User.email == email))
    if user is None:
        user = User(email=email)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
    elif user.is_confirmed:
        # Same response as a new registration, so the endpoint does not
        # reveal which addresses already have an account.
        return jsonify(message=REGISTER_MESSAGE), 201

    if not _try_send_confirmation(user):
        return error(
            "Your account was created, but the confirmation email could not be sent. "
            "Try again later from the sign-in page.",
            502,
        )
    return jsonify(message=REGISTER_MESSAGE), 201


@auth.post("/confirm")
def confirm():
    data = request.get_json(silent=True) or {}
    token = data.get("token")
    if not isinstance(token, str) or not token:
        return error("Confirmation token is missing.", 400)

    try:
        payload = _serializer().loads(token, max_age=current_app.config["CONFIRM_TOKEN_MAX_AGE"])
    except SignatureExpired:
        return error("This confirmation link has expired. Request a new one.", 400)
    except BadSignature:
        return error("This confirmation link is not valid.", 400)

    user = db.session.get(User, payload.get("id")) if isinstance(payload, dict) else None
    if user is None or user.email != payload.get("email"):
        return error("This confirmation link is not valid.", 400)

    if not user.is_confirmed:
        user.is_confirmed = True
        user.confirmed_at = utcnow()
        db.session.commit()
    return jsonify(message="Your email address is confirmed. You can sign in now.")


@auth.post("/resend-confirmation")
def resend_confirmation():
    email, _ = _credentials()
    user = db.session.scalar(db.select(User).where(User.email == email)) if email else None
    if user is not None and not user.is_confirmed:
        _try_send_confirmation(user)
    return jsonify(message=RESEND_MESSAGE)


@auth.post("/login")
def login():
    email, password = _credentials()
    user = db.session.scalar(db.select(User).where(User.email == email)) if email else None

    if user is None or not user.check_password(password):
        return error("Incorrect email or password.", 401)
    if not user.is_confirmed:
        return jsonify(
            error="Confirm your email address before signing in.", code="email_not_confirmed"
        ), 403

    session.clear()
    session["user_id"] = user.id
    session.permanent = True
    return jsonify(user=user.to_dict())


@auth.post("/logout")
def logout():
    session.clear()
    return "", 204


@auth.get("/me")
@login_required
def me():
    return jsonify(user=current_user().to_dict())
