import os

from flask import Flask, jsonify, send_from_directory
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
    from .auth import auth
    from .routes import api

    app.register_blueprint(api, url_prefix="/api")
    app.register_blueprint(auth, url_prefix="/api/auth")

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
