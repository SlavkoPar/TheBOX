import os

from flask import Flask, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException
from werkzeug.utils import safe_join

from .config import Config
from .extensions import cors, db, migrate


def create_app(config_object=Config):
    app = Flask(__name__)
    app.config.from_object(config_object)

    db.init_app(app)
    migrate.init_app(app, db)
    cors.init_app(
        app,
        resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}},
        supports_credentials=True,
    )

    from . import models  # noqa: F401  (register models for migrations)
    from . import reminders
    from .admin import admin
    from .auth import auth
    from .common import ApiError
    from .events import events
    from .files import files_blueprint, shared, storage
    from .messenger import messenger
    from .packages import packages
    from .recipients import recipients
    from .routes import api
    from .tasks import task_lists, tasks

    app.register_blueprint(api, url_prefix="/api")
    app.register_blueprint(auth, url_prefix="/api/auth")
    app.register_blueprint(admin, url_prefix="/api/admin")
    app.register_blueprint(recipients, url_prefix="/api/recipients")
    app.register_blueprint(tasks, url_prefix="/api/tasks")
    app.register_blueprint(task_lists, url_prefix="/api/task-lists")
    app.register_blueprint(events, url_prefix="/api/events")
    app.register_blueprint(files_blueprint("drive"), url_prefix="/api/drive")
    app.register_blueprint(files_blueprint("photos"), url_prefix="/api/photos")
    app.register_blueprint(packages, url_prefix="/api/packages")
    app.register_blueprint(messenger, url_prefix="/api/messenger")
    app.register_blueprint(shared, url_prefix="/api/shared")
    app.register_blueprint(storage, url_prefix="/api/storage")

    @app.errorhandler(ApiError)
    def handle_api_error(err):
        db.session.rollback()
        return err.to_response()

    @app.errorhandler(HTTPException)
    def handle_http_error(err):
        # API clients always get JSON, including for 404, 405 and 413.
        if request.path.startswith("/api/"):
            message = (
                "The upload is too large."
                if err.code == 413
                else err.description or err.name
            )
            return jsonify(error=message), err.code
        return err

    reminders.register_cli(app)
    if app.config["REMINDER_INTERVAL_SECONDS"] > 0 and not app.config.get("TESTING"):
        reminders.start_scheduler(app)

    if app.config.get("FRONTEND_DIST"):
        _serve_frontend(app, app.config["FRONTEND_DIST"])

    return app


def _serve_frontend(app, dist):
    """Serve the built single-page app; unknown paths fall back to index.html."""

    @app.get("/", defaults={"path": ""})
    @app.get("/<path:path>")
    def frontend(path):
        if path == "api" or path.startswith("api/"):
            return jsonify(error="Not found."), 404
        if path and os.path.isfile(safe_join(dist, path) or ""):
            return send_from_directory(dist, path)
        response = send_from_directory(dist, "index.html")
        response.headers["Cache-Control"] = "no-cache"
        return response
