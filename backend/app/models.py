from datetime import datetime, timezone

from werkzeug.security import check_password_hash, generate_password_hash

from .extensions import db


def utcnow():
    return datetime.now(timezone.utc)


def iso(value):
    if value is None:
        return None
    if value.tzinfo is None:  # SQLite returns naive datetimes
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(254), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    is_confirmed = db.Column(db.Boolean, nullable=False, default=False)
    confirmed_at = db.Column(db.DateTime(timezone=True))
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def to_dict(self):
        return {"id": self.id, "email": self.email, "is_confirmed": self.is_confirmed}


class OwnedMixin:
    """Columns every app's rows share: id, owner and creation time."""

    id = db.Column(db.Integer, primary_key=True)

    @db.declared_attr
    def user_id(cls):
        return db.Column(
            db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
        )

    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utcnow)


# --- Recipients ---------------------------------------------------------------


class Recipient(OwnedMixin, db.Model):
    __tablename__ = "recipients"

    first_name = db.Column(db.String(100), nullable=False)
    last_name = db.Column(db.String(100), nullable=False, default="")
    email = db.Column(db.String(254), nullable=False)
    address = db.Column(db.String(255), nullable=False, default="")
    country = db.Column(db.String(100), nullable=False, default="")
    mobile = db.Column(db.String(40), nullable=False, default="")

    __table_args__ = (db.UniqueConstraint("user_id", "email", name="uq_recipients_user_email"),)

    @property
    def full_name(self):
        return f"{self.first_name} {self.last_name}".strip()

    def to_dict(self):
        return {
            "id": self.id,
            "first_name": self.first_name,
            "last_name": self.last_name,
            "email": self.email,
            "address": self.address,
            "country": self.country,
            "mobile": self.mobile,
        }


# --- Tasks --------------------------------------------------------------------


class Task(OwnedMixin, db.Model):
    __tablename__ = "tasks"

    title = db.Column(db.String(255), nullable=False)
    notes = db.Column(db.Text, nullable=False, default="")
    due_date = db.Column(db.Date)
    is_done = db.Column(db.Boolean, nullable=False, default=False)
    completed_at = db.Column(db.DateTime(timezone=True))

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "notes": self.notes,
            "due_date": self.due_date.isoformat() if self.due_date else None,
            "is_done": self.is_done,
            "completed_at": iso(self.completed_at),
            "created_at": iso(self.created_at),
        }


# --- Calendar -----------------------------------------------------------------


class Event(OwnedMixin, db.Model):
    __tablename__ = "events"

    title = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, nullable=False, default="")
    location = db.Column(db.String(255), nullable=False, default="")
    starts_at = db.Column(db.DateTime(timezone=True), nullable=False, index=True)
    ends_at = db.Column(db.DateTime(timezone=True), nullable=False)
    all_day = db.Column(db.Boolean, nullable=False, default=False)
    # IANA time zone of the browser that saved the event; used to format emails.
    timezone = db.Column(db.String(64), nullable=False, default="UTC")
    # Minutes before starts_at to email a reminder; NULL means no reminder.
    reminder_minutes = db.Column(db.Integer)
    reminder_sent_at = db.Column(db.DateTime(timezone=True))

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "location": self.location,
            "starts_at": iso(self.starts_at),
            "ends_at": iso(self.ends_at),
            "all_day": self.all_day,
            "timezone": self.timezone,
            "reminder_minutes": self.reminder_minutes,
            "reminder_sent_at": iso(self.reminder_sent_at),
        }


# --- Drive and Photos (shared tables, separated by the `app` column) ------------

FILE_APPS = ("drive", "photos")

share_files = db.Table(
    "share_files",
    db.Column("share_id", db.ForeignKey("shares.id", ondelete="CASCADE"), primary_key=True),
    db.Column("file_id", db.ForeignKey("files.id", ondelete="CASCADE"), primary_key=True),
)

share_recipients = db.Table(
    "share_recipients",
    db.Column("share_id", db.ForeignKey("shares.id", ondelete="CASCADE"), primary_key=True),
    db.Column(
        "recipient_id", db.ForeignKey("recipients.id", ondelete="CASCADE"), primary_key=True
    ),
)


class Folder(OwnedMixin, db.Model):
    __tablename__ = "folders"

    app = db.Column(db.String(16), nullable=False)
    parent_id = db.Column(db.Integer, db.ForeignKey("folders.id", ondelete="CASCADE"), index=True)
    name = db.Column(db.String(255), nullable=False)

    parent = db.relationship("Folder", remote_side="Folder.id", back_populates="children")
    children = db.relationship(
        "Folder", back_populates="parent", cascade="all, delete-orphan"
    )
    files = db.relationship(
        "File", back_populates="folder", cascade="all, delete-orphan"
    )

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "parent_id": self.parent_id,
            "created_at": iso(self.created_at),
        }


class File(OwnedMixin, db.Model):
    __tablename__ = "files"

    app = db.Column(db.String(16), nullable=False)
    folder_id = db.Column(db.Integer, db.ForeignKey("folders.id", ondelete="CASCADE"), index=True)
    name = db.Column(db.String(255), nullable=False)
    mime_type = db.Column(db.String(127), nullable=False, default="application/octet-stream")
    size = db.Column(db.BigInteger, nullable=False, default=0)  # size of the original content
    updated_at = db.Column(
        db.DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow
    )

    # Password-based encryption (Drive only). When set, `data` holds ciphertext.
    is_encrypted = db.Column(db.Boolean, nullable=False, default=False)
    enc_salt = db.Column(db.LargeBinary)
    enc_nonce = db.Column(db.LargeBinary)

    # File content lives in the database; loaded only when accessed.
    data = db.deferred(db.Column(db.LargeBinary, nullable=False))

    folder = db.relationship("Folder", back_populates="files")
    shares = db.relationship("Share", secondary=share_files, back_populates="files")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "folder_id": self.folder_id,
            "mime_type": self.mime_type,
            "size": self.size,
            "is_encrypted": self.is_encrypted,
            "created_at": iso(self.created_at),
            "updated_at": iso(self.updated_at),
        }


class Share(OwnedMixin, db.Model):
    """A set of files made available through a secret link emailed to recipients."""

    __tablename__ = "shares"

    app = db.Column(db.String(16), nullable=False)
    token = db.Column(db.String(64), nullable=False, unique=True, index=True)
    message = db.Column(db.Text, nullable=False, default="")
    expires_at = db.Column(db.DateTime(timezone=True))

    owner = db.relationship("User")
    files = db.relationship("File", secondary=share_files, back_populates="shares")
    recipients = db.relationship("Recipient", secondary=share_recipients, backref="shares")

    def to_dict(self):
        return {
            "id": self.id,
            "token": self.token,
            "message": self.message,
            "created_at": iso(self.created_at),
            "expires_at": iso(self.expires_at),
            "files": [f.to_dict() for f in self.files],
            "recipients": [r.to_dict() for r in self.recipients],
        }
