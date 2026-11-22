import os

from dotenv import load_dotenv

# Must run before Config is defined: the class reads the environment at import time.
load_dotenv()


def _bool(name, default):
    return os.environ.get(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


def _database_uri():
    uri = os.environ.get("DATABASE_URL") or (
        "postgresql+psycopg://postgres:postgres@localhost:5432/thebox"
    )
    # Hosts such as Render give a plain postgres:// or postgresql:// URL;
    # point SQLAlchemy at the psycopg 3 driver that is installed.
    for prefix in ("postgres://", "postgresql://"):
        if uri.startswith(prefix):
            return "postgresql+psycopg://" + uri[len(prefix):]
    return uri


def _frontend_url():
    # On Render, RENDER_EXTERNAL_URL is the service's public https URL.
    url = (
        os.environ.get("FRONTEND_URL")
        or os.environ.get("RENDER_EXTERNAL_URL")
        or "http://localhost:5173"
    )
    return url.rstrip("/")


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY") or "dev"
    SQLALCHEMY_DATABASE_URI = _database_uri()
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = (
        {"connect_args": {"connect_timeout": 5}}
        if SQLALCHEMY_DATABASE_URI.startswith("postgresql")
        else {}
    )
    CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")

    # Session cookie
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = _bool("SESSION_COOKIE_SECURE", False)

    # Email confirmation
    FRONTEND_URL = _frontend_url()
    CONFIRM_TOKEN_MAX_AGE = int(os.environ.get("CONFIRM_TOKEN_MAX_AGE") or 60 * 60 * 24)

    # Folder with the built frontend (frontend/dist). When set, Flask serves it,
    # so the app and the API share one origin. Unset in local development.
    FRONTEND_DIST = os.environ.get("FRONTEND_DIST", "")

    # Uploads (Drive and Photos). Files are stored in the database.
    MAX_CONTENT_LENGTH = int(os.environ.get("MAX_UPLOAD_MB") or 25) * 1024 * 1024
    # Days a shared link stays valid; 0 means it never expires.
    SHARE_MAX_AGE_DAYS = int(os.environ.get("SHARE_MAX_AGE_DAYS") or 30)

    # How often the web process checks for calendar reminders to email.
    # 0 turns the background check off (use `flask send-reminders` from cron instead).
    REMINDER_INTERVAL_SECONDS = int(os.environ.get("REMINDER_INTERVAL_SECONDS") or 60)

    # SMTP. If SMTP_HOST is empty, emails are written to the log instead of sent.
    SMTP_HOST = os.environ.get("SMTP_HOST", "")
    SMTP_PORT = int(os.environ.get("SMTP_PORT") or 587)
    SMTP_USERNAME = os.environ.get("SMTP_USERNAME", "")
    SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
    SMTP_USE_TLS = _bool("SMTP_USE_TLS", True)  # STARTTLS (port 587)
    SMTP_USE_SSL = _bool("SMTP_USE_SSL", False)  # implicit TLS (port 465)
    MAIL_FROM = os.environ.get("MAIL_FROM") or "TheBOX <no-reply@localhost>"
