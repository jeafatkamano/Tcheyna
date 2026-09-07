"""
app/__init__.py — Fabrique d'application Flask pour l'API Tcheyna.
"""
import os

from flask import Flask, jsonify, send_from_directory
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from flask_migrate import Migrate
from flask_sqlalchemy import SQLAlchemy

from config import Config

db = SQLAlchemy()
jwt = JWTManager()
migrate = Migrate()


def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)

    # ─── Extensions ─────────────────────────────────────────
    db.init_app(app)
    jwt.init_app(app)
    migrate.init_app(app, db)
    CORS(
        app,
        origins=app.config["CORS_ORIGINS"],
        supports_credentials=True,
        allow_headers=["Content-Type", "Authorization"],
    )

    # ─── Blueprints ─────────────────────────────────────────
    from app.routes.admin import admin_bp
    from app.routes.auth import auth_bp
    from app.routes.favorites import favorites_bp
    from app.routes.geo import geo_bp
    from app.routes.listings import listings_bp
    from app.routes.matches import matches_bp
    from app.routes.messages import messages_bp
    from app.routes.notifications import notifications_bp
    from app.routes.passport import passport_bp
    from app.routes.payments import payments_bp
    from app.routes.reviews import reviews_bp
    from app.routes.users import users_bp

    app.register_blueprint(auth_bp,          url_prefix="/api/auth")
    app.register_blueprint(users_bp,         url_prefix="/api/users")
    app.register_blueprint(listings_bp,      url_prefix="/api/listings")
    app.register_blueprint(matches_bp,       url_prefix="/api/matches")
    app.register_blueprint(passport_bp,      url_prefix="/api/passport")
    app.register_blueprint(messages_bp,      url_prefix="/api/messages")
    app.register_blueprint(favorites_bp,     url_prefix="/api/favorites")
    app.register_blueprint(notifications_bp, url_prefix="/api/notifications")
    app.register_blueprint(reviews_bp,       url_prefix="/api/reviews")
    app.register_blueprint(payments_bp,      url_prefix="/api/payments")
    app.register_blueprint(geo_bp,           url_prefix="/api/geo")
    app.register_blueprint(admin_bp,         url_prefix="/api/admin")

    # ─── Fichiers uploadés (CNI, justificatifs, photos) ──────
    @app.route("/uploads/<path:filename>")
    def uploaded_file(filename):
        upload_dir = os.path.abspath(app.config["UPLOAD_FOLDER"])
        return send_from_directory(upload_dir, filename)

    # ─── Santé (health check Render / UptimeRobot) ───────────
    @app.route("/health")
    def health():
        return {"status": "ok", "app": "tcheyna-api", "version": "1.1.0"}, 200

    # ─── Erreurs renvoyées en JSON, jamais en HTML ───────────
    @app.errorhandler(404)
    def not_found(_):
        return jsonify({"error": "Ressource introuvable"}), 404

    @app.errorhandler(413)
    def too_large(_):
        return jsonify({"error": "Fichier trop volumineux (10 Mo maximum)"}), 413

    @app.errorhandler(500)
    def server_error(err):
        db.session.rollback()
        app.logger.exception("Erreur serveur : %s", err)
        return jsonify({"error": "Erreur interne du serveur"}), 500

    @jwt.expired_token_loader
    def expired_token(_header, _payload):
        return jsonify({"error": "Session expirée"}), 401

    @jwt.invalid_token_loader
    def invalid_token(_reason):
        return jsonify({"error": "Jeton invalide"}), 401

    @jwt.unauthorized_loader
    def missing_token(_reason):
        return jsonify({"error": "Authentification requise"}), 401

    return app
