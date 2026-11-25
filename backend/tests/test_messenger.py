from datetime import timedelta

from app.extensions import db
from app.models import Message, utcnow
from conftest import CREDS, OTHER_CREDS

ME = CREDS["email"]
OTHER = OTHER_CREDS["email"]


def add_recipient(client, email, first_name="Friend", last_name=""):
    response = client.post(
        "/api/recipients", json={"first_name": first_name, "last_name": last_name, "email": email}
    )
    assert response.status_code == 201
    return response.get_json()


def send(client, to, body="Hello"):
    return client.post("/api/messenger/messages", json={"to": to, "body": body})


def chat(client, email, after=None):
    url = f"/api/messenger/messages?with={email}" + (f"&after={after}" if after else "")
    response = client.get(url)
    assert response.status_code == 200
    return response.get_json()["items"]


def people(client):
    return client.get("/api/messenger/conversations").get_json()["items"]


def test_messenger_requires_sign_in(client):
    assert client.get("/api/messenger/conversations").status_code == 401
    assert client.get(f"/api/messenger/messages?with={OTHER}").status_code == 401
    assert send(client, OTHER).status_code == 401
    assert client.delete("/api/messenger/messages/1").status_code == 401


def test_recipients_are_the_friends(signed_in):
    add_recipient(signed_in, "zoe@example.com", "Zoe")
    ana = add_recipient(signed_in, "ana@example.com", "Ana", "Kovač")
    add_recipient(signed_in, ME, "Myself")  # nobody chats with themselves

    assert people(signed_in) == [
        {"email": "ana@example.com", "name": "Ana Kovač", "recipient_id": ana["id"], "unread": 0, "last": None, "online": False},
        {"email": "zoe@example.com", "name": "Zoe", "recipient_id": people(signed_in)[1]["recipient_id"], "unread": 0, "last": None, "online": False},
    ]


def test_two_users_chat(signed_in, other):
    add_recipient(signed_in, OTHER, "Olga")

    sent = send(signed_in, OTHER.upper(), "  Hi Olga  ")
    assert sent.status_code == 201
    first = sent.get_json()
    assert first["body"] == "Hi Olga" and first["mine"] is True and first["created_at"]

    # Olga has no recipients, and still sees who wrote to her
    (inbox,) = people(other)
    assert inbox["email"] == ME and inbox["name"] == ME and inbox["recipient_id"] is None
    assert inbox["unread"] == 1
    assert inbox["last"]["body"] == "Hi Olga" and inbox["last"]["mine"] is False
    assert other.get("/api/summary").get_json()["messenger"] == {"unread": 1}

    # Opening the chat reads it
    assert [(m["body"], m["mine"]) for m in chat(other, ME)] == [("Hi Olga", False)]
    assert people(other)[0]["unread"] == 0
    assert other.get("/api/summary").get_json()["messenger"] == {"unread": 0}

    # She can answer although the sender is not one of her recipients
    reply = send(other, ME, "Hi back")
    assert reply.status_code == 201
    assert [(m["body"], m["mine"]) for m in chat(signed_in, OTHER)] == [
        ("Hi Olga", True),
        ("Hi back", False),
    ]
    (olga,) = people(signed_in)
    assert olga["name"] == "Olga" and olga["last"]["body"] == "Hi back" and olga["unread"] == 0

    # Polling for what is new
    assert chat(signed_in, OTHER, after=reply.get_json()["id"]) == []
    send(other, ME, "Still there?")
    assert [m["body"] for m in chat(signed_in, OTHER, after=reply.get_json()["id"])] == ["Still there?"]


def test_chats_come_before_silent_recipients_newest_first(signed_in, other):
    add_recipient(signed_in, "ana@example.com", "Ana")
    add_recipient(signed_in, "bob@example.com", "Bob")
    add_recipient(signed_in, "cy@example.com", "Cy")
    send(signed_in, "cy@example.com")
    send(signed_in, "bob@example.com")
    add_recipient(other, ME)
    assert send(other, ME).status_code == 201

    assert [p["email"] for p in people(signed_in)] == [
        OTHER,
        "bob@example.com",
        "cy@example.com",
        "ana@example.com",
    ]


def test_only_recipients_and_people_who_wrote_can_be_written_to(signed_in, other):
    refused = send(signed_in, OTHER)
    assert refused.status_code == 403
    assert refused.get_json()["code"] == "not_a_friend"
    assert send(signed_in, ME).status_code == 400
    assert people(other) == []


def test_message_is_validated(signed_in):
    add_recipient(signed_in, "ana@example.com")
    assert send(signed_in, "ana@example.com", "   ").status_code == 400
    assert send(signed_in, "ana@example.com", "x" * 4001).status_code == 400
    assert send(signed_in, "not an address").status_code == 400
    assert signed_in.post("/api/messenger/messages", json={"body": "Hi"}).status_code == 400
    assert signed_in.get("/api/messenger/messages").status_code == 400
    assert signed_in.get(f"/api/messenger/messages?with={ME}").status_code == 400


def test_a_message_waits_for_someone_who_registers_later(app, signed_in, outbox):
    from test_admin import sign_in

    add_recipient(signed_in, "late@example.com", "Late")
    assert send(signed_in, "late@example.com", "Welcome").status_code == 201
    # Nothing tells the sender whether the address has an account
    assert people(signed_in)[0]["last"]["body"] == "Welcome"

    late = sign_in(app, outbox, {"email": "late@example.com", "password": "late horse 1"})
    assert [m["body"] for m in chat(late, ME)] == ["Welcome"]


def test_others_cannot_read_or_delete_a_chat(app, signed_in, other, outbox):
    from test_admin import sign_in

    add_recipient(signed_in, "ana@example.com")
    message = send(signed_in, "ana@example.com", "Private").get_json()
    add_recipient(other, "ana@example.com")
    add_recipient(other, ME)

    assert chat(other, "ana@example.com") == []
    assert chat(other, ME) == []
    assert other.delete(f"/api/messenger/messages/{message['id']}").status_code == 404
    # Not even the person it was written to can delete it
    ana = sign_in(app, outbox, {"email": "ana@example.com", "password": "ana horse 12"})
    assert ana.delete(f"/api/messenger/messages/{message['id']}").status_code == 404
    assert [m["body"] for m in chat(ana, ME)] == ["Private"]


def test_sender_can_take_a_message_back(signed_in, other):
    add_recipient(signed_in, OTHER)
    message = send(signed_in, OTHER, "Oops").get_json()

    assert signed_in.delete(f"/api/messenger/messages/{message['id']}").status_code == 204
    assert chat(other, ME) == []
    assert people(other) == []
    assert signed_in.delete(f"/api/messenger/messages/{message['id']}").status_code == 404


def test_first_message_of_a_burst_is_announced_by_email(app, signed_in, other, outbox):
    add_recipient(signed_in, OTHER)

    send(signed_in, OTHER, "One")
    assert len(outbox) == 1
    to, subject, body = outbox[0]
    assert to == OTHER
    assert subject == f"{ME} sent you a message on TheBOX"
    assert f"http://frontend.test/messenger?with={ME}" in body
    assert "One" not in body  # the text itself stays in TheBOX

    # Still unread: no second email
    send(signed_in, OTHER, "Two")
    assert len(outbox) == 1

    # Read a moment ago, so they are looking at the chat: no email either
    chat(other, ME)
    send(signed_in, OTHER, "Three")
    assert len(outbox) == 1

    # Long after they last looked, a new message is announced again
    chat(other, ME)
    long_ago = utcnow() - timedelta(hours=2)
    for message in db.session.scalars(db.select(Message)):
        message.read_at = long_ago
        message.created_at = long_ago
    db.session.commit()
    send(signed_in, OTHER, "Four")
    assert len(outbox) == 2

    # An answer needs no email: the other side wrote a moment ago, so is in the chat
    chat(other, ME)
    send(other, ME, "Five")
    send(signed_in, OTHER, "Six")
    assert len(outbox) == 2


def test_message_is_kept_when_the_email_cannot_be_sent(signed_in, monkeypatch):
    from app import messenger

    def broken(*args):
        raise RuntimeError("smtp down")

    monkeypatch.setattr(messenger, "send_email", broken)
    add_recipient(signed_in, "ana@example.com")
    assert send(signed_in, "ana@example.com", "Hi").status_code == 201
    assert [m["body"] for m in chat(signed_in, "ana@example.com")] == ["Hi"]


def attach(client, to, body="", **ids):
    return client.post("/api/messenger/messages", json={"to": to, "body": body, **ids})


def test_files_are_sent_with_a_message(signed_in, other):
    from test_files import PNG, new_folder, uploaded

    add_recipient(signed_in, OTHER)
    doc = uploaded(signed_in, name="report.txt", content=b"the report")
    photo = uploaded(signed_in, app_name="photos", name="cat.png", content=PNG)

    sent = attach(signed_in, OTHER, "Here they are", file_ids=[doc["id"], photo["id"]])
    assert sent.status_code == 201
    message = sent.get_json()
    assert [f["name"] for f in message["files"]] == ["cat.png", "report.txt"]
    assert message["files"][1] == {
        "id": doc["id"],
        "name": "report.txt",
        "mime_type": "text/plain",
        "size": 10,
        "is_encrypted": False,
    }

    # The other side sees them in the chat and in the list of people
    (received,) = chat(other, ME)
    assert received["body"] == "Here they are" and received["files"] == message["files"]
    assert people(other)[0]["last"]["files"] == message["files"]

    # ... and opens them through the message, although the files are not theirs
    base = f"/api/messenger/messages/{message['id']}/files"
    assert other.get(f"/api/drive/files/{doc['id']}/content").status_code == 404
    opened = other.get(f"{base}/{doc['id']}")
    assert opened.status_code == 200 and opened.data == b"the report"
    assert "attachment" in other.get(f"{base}/{doc['id']}?download=1").headers["Content-Disposition"]
    assert other.get(f"{base}/{photo['id']}/thumb").status_code == 200
    assert signed_in.get(f"{base}/{doc['id']}").data == b"the report"

    # Files alone are a message too; a folder sends what is in it now
    folder = new_folder(signed_in, "Work")
    sub = new_folder(signed_in, "Old", folder["id"])
    uploaded(signed_in, name="a.txt", folder_id=folder["id"])
    uploaded(signed_in, name="b.txt", folder_id=sub["id"])
    only = attach(signed_in, OTHER, folder_ids=[folder["id"]]).get_json()
    assert only["body"] == "" and [f["name"] for f in only["files"]] == ["a.txt", "b.txt"]
    uploaded(signed_in, name="later.txt", folder_id=folder["id"])
    assert [f["name"] for f in chat(other, ME)[-1]["files"]] == ["a.txt", "b.txt"]


def test_only_the_two_sides_reach_the_files_of_a_message(app, signed_in, other, outbox):
    from test_admin import sign_in
    from test_files import uploaded

    add_recipient(signed_in, OTHER)
    doc = uploaded(signed_in, name="report.txt")
    untold = uploaded(signed_in, name="untold.txt")
    message = attach(signed_in, OTHER, file_ids=[doc["id"]]).get_json()
    base = f"/api/messenger/messages/{message['id']}/files"

    assert app.test_client().get(f"{base}/{doc['id']}").status_code == 401
    # A file that was not sent stays out of reach
    assert other.get(f"{base}/{untold['id']}").status_code == 404
    assert other.get(f"{base}/{untold['id']}/thumb").status_code == 404
    # A third person reaches nothing
    third = sign_in(app, outbox, {"email": "third@example.com", "password": "third horse 1"})
    assert third.get(f"{base}/{doc['id']}").status_code == 404
    assert third.post(f"{base}/{doc['id']}", json={}).status_code == 404

    # Nobody sends files that are not their own
    theirs = uploaded(other, name="theirs.txt")
    add_recipient(third, OTHER)
    assert attach(third, OTHER, file_ids=[doc["id"]]).status_code == 404
    assert attach(signed_in, OTHER, file_ids=[theirs["id"]]).status_code == 404
    assert attach(signed_in, OTHER, file_ids="all").status_code == 400
    assert attach(signed_in, OTHER).status_code == 400  # neither text nor files


def test_files_go_when_the_message_or_the_file_is_deleted(signed_in, other):
    from test_files import new_folder, uploaded

    add_recipient(signed_in, OTHER)
    doc = uploaded(signed_in, name="report.txt")
    kept = uploaded(signed_in, name="kept.txt")
    message = attach(signed_in, OTHER, "Two files", file_ids=[doc["id"], kept["id"]]).get_json()
    base = f"/api/messenger/messages/{message['id']}/files"

    # In the trash: gone from the chat
    assert signed_in.delete(f"/api/drive/files/{doc['id']}").status_code == 204
    assert [f["name"] for f in chat(other, ME)[0]["files"]] == ["kept.txt"]
    assert other.get(f"{base}/{doc['id']}").status_code == 404
    # Deleted for good: the message stays, with what is left
    assert signed_in.delete(f"/api/drive/files/{doc['id']}?permanent=1").status_code == 204
    assert [f["name"] for f in chat(other, ME)[0]["files"]] == ["kept.txt"]

    # Taking the message back takes the access away, and keeps the file
    assert signed_in.delete(f"/api/messenger/messages/{message['id']}").status_code == 204
    assert other.get(f"{base}/{kept['id']}").status_code == 404
    assert signed_in.get(f"/api/drive/files/{kept['id']}/content").status_code == 200

    empty = new_folder(signed_in, "Empty")
    assert attach(signed_in, OTHER, "Look", folder_ids=[empty["id"]]).status_code == 400


def test_an_encrypted_document_needs_its_password(signed_in, other):
    from test_files import PASSWORD, uploaded

    add_recipient(signed_in, OTHER)
    doc = uploaded(signed_in, name="secret.txt", content=b"the secret")
    assert signed_in.post(f"/api/drive/files/{doc['id']}/encrypt", json={"password": PASSWORD}).status_code == 200
    message = attach(signed_in, OTHER, file_ids=[doc["id"]]).get_json()
    assert message["files"][0]["is_encrypted"] is True
    url = f"/api/messenger/messages/{message['id']}/files/{doc['id']}"

    assert other.get(url).get_json()["code"] == "encrypted"
    assert other.post(url, json={"password": "not the one"}).get_json()["code"] == "wrong_password"
    assert other.post(url, json={"password": PASSWORD}).data == b"the secret"


def test_people_who_are_signed_in_show_as_online(app, signed_in, other):
    from app.models import User

    add_recipient(signed_in, OTHER, "Olga")
    add_recipient(signed_in, "nobody@example.com", "Nobody")
    online = lambda: {p["email"]: p["online"] for p in people(signed_in)}  # noqa: E731

    # Olga is signed in, but has not added this user to her recipients:
    # nothing tells whether her address has an account
    assert online() == {OTHER: False, "nobody@example.com": False}

    # Once both have each other as recipients, they see each other online
    add_recipient(other, ME, "Me")
    assert online() == {OTHER: True, "nobody@example.com": False}
    assert {p["email"]: p["online"] for p in people(other)} == {ME: True}

    # No request from her browser for a while: offline
    olga = db.session.scalar(db.select(User).where(User.email == OTHER))
    olga.last_seen_at = utcnow() - timedelta(minutes=5)
    db.session.commit()
    assert online()[OTHER] is False

    # Any request while signed in brings her back
    other.get("/api/auth/me")
    assert online()[OTHER] is True

    # Signing out takes her offline at once
    assert other.post("/api/auth/logout").status_code == 204
    assert online()[OTHER] is False
