"""
app/__init__.py — Fabrique d'application Flask pour l'API Tcheyna.
"""
import math
import os
import time

from flask import Flask, g, jsonify, send_from_directory
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_migrate import Migrate
from flask_sqlalchemy import SQLAlchemy
from werkzeug.middleware.proxy_fix import ProxyFix

from config import Config

db = SQLAlchemy()
jwt = JWTManager()
migrate = Migrate()
# Aucune limite par défaut : seules les routes décorées sont limitées. La clé
# par défaut est l'IP du client, rendue fiable par ProxyFix (voir
# create_app) ; le stockage vient de RATELIMIT_STORAGE_URI.
limiter = Limiter(key_func=get_remote_address)


def reponse_trop_de_requetes(message, reessayer_dans):
    """429 au format d'erreur commun, avec le délai dans le corps : le front,
    servi depuis une autre origine, ne peut pas lire `Retry-After` (en-tête
    non exposé par CORS)."""
    reessayer_dans = max(1, int(math.ceil(reessayer_dans)))
    reponse = jsonify({"error": message, "details": [], "reessayer_dans": reessayer_dans})
    reponse.status_code = 429
    reponse.headers["Retry-After"] = str(reessayer_dans)
    return reponse


def _arrondi(valeur):
    # Arrondi au plus proche, demi vers le haut (`round` arrondit au pair).
    return int(valeur + 0.5)


def formater_delai(secondes):
    """« 40 secondes », « 15 minutes », « 3 heures ». Sous la minute, arrondi
    au-dessus ; au-delà, au plus proche : un délai de 900 s affiché « 16
    minutes » surprendrait, et `reessayer_dans` donne la valeur exacte."""
    secondes = max(1, int(math.ceil(secondes)))
    if secondes < 60:
        return f"{secondes} seconde{'s' if secondes > 1 else ''}"
    minutes = max(1, _arrondi(secondes / 60))
    if minutes < 60:
        return f"{minutes} minute{'s' if minutes > 1 else ''}"
    heures = max(1, _arrondi(minutes / 60))
    return f"{heures} heure{'s' if heures > 1 else ''}"


# Préfixes des fichiers servis par /uploads en développement : ceux que
# services/stockage.py écrit pour les photos d'annonce et de profil (voir
# routes/listings.py et routes/users.py). Tout autre fichier est privé.
PREFIXES_UPLOADS_PUBLICS = ("annonce-", "profil-")


def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)

    # Derrière le répartiteur de Render, REMOTE_ADDR est l'IP du proxy :
    # ProxyFix la remplace par l'entrée de X-Forwarded-For posée par le
    # dernier proxy de confiance. Les entrées plus à gauche, écrites par le
    # client, sont ignorées : elles sont falsifiables.
    sauts = app.config.get("TRUSTED_PROXY_HOPS", 0)
    if sauts > 0:
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=sauts, x_proto=0, x_host=0,
                                x_port=0, x_prefix=0)

    # ─── Extensions ─────────────────────────────────────────
    db.init_app(app)
    jwt.init_app(app)
    migrate.init_app(app, db)
    # Chaque `init_app` repart d'un stockage neuf : les compteurs ne fuient
    # pas d'une application (ou d'un test) à l'autre.
    limiter.init_app(app)
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
    from app.schemas import ErreurValidation, reponse_422

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

    from app.commandes import donnees_cli
    app.cli.add_command(donnees_cli)

    # ─── Fichiers téléversés sur disque (développement) ──────
    # Le stockage disque n'existe qu'en développement et en test (voir
    # services/stockage.py) : en production, les fichiers sont sur Supabase et
    # cette route n'est pas enregistrée. Même en développement, elle ne sert
    # que les fichiers publics par nature (photos d'annonce, photos de
    # profil) : CNI, justificatifs de revenus et titres de propriété partagent
    # le même dossier, et répondent 404.
    if app.config.get("DEBUG") or app.config.get("TESTING"):
        @app.route("/uploads/<path:filename>")
        def uploaded_file(filename):
            if not filename.startswith(PREFIXES_UPLOADS_PUBLICS) or "/" in filename:
                return jsonify({"error": "Ressource introuvable", "details": []}), 404
            upload_dir = os.path.abspath(app.config["UPLOAD_FOLDER"])
            return send_from_directory(upload_dir, filename)

    # ─── Santé (health check Render / UptimeRobot) ───────────
    @app.route("/health")
    def health():
        return {"status": "ok", "app": "tcheyna-api", "version": "1.1.0"}, 200

    # ─── Erreurs renvoyées en JSON, jamais en HTML ───────────
    @app.errorhandler(404)
    def not_found(_):
        return jsonify({"error": "Ressource introuvable", "details": []}), 404

    # Flask répond en HTML à une requête mal formée ; le front, qui lit
    # `error`, n'afficherait alors qu'un message générique.
    @app.errorhandler(400)
    def bad_request(_):
        return jsonify({"error": "Requête invalide", "details": []}), 400

    @app.errorhandler(405)
    def method_not_allowed(_):
        return jsonify({"error": "Méthode non autorisée", "details": []}), 405

    @app.errorhandler(415)
    def unsupported_media_type(_):
        return jsonify({"error": "Format non pris en charge : JSON attendu", "details": []}), 415

    # Contrôle levé par une route après validation du corps (état en base) :
    # même réponse 422 qu'un schéma.
    @app.errorhandler(ErreurValidation)
    def validation_error(exc):
        db.session.rollback()
        return reponse_422(exc.validation)

    # Limite de flask-limiter dépassée (connexion, inscription). Sans ce
    # gestionnaire, la réponse serait une page HTML en anglais.
    @app.errorhandler(429)
    def too_many_requests(_exc):
        # `current_limit` désigne la limite franchie ; `reset_at` est l'instant
        # où sa fenêtre libère une place.
        limite = limiter.current_limit
        reessayer_dans = (limite.reset_at - time.time()) if limite else 60
        return reponse_trop_de_requetes(
            f"Trop de tentatives. Réessayez dans {formater_delai(reessayer_dans)}.",
            reessayer_dans,
        )

    @app.errorhandler(413)
    def too_large(_):
        return jsonify({"error": "Fichier trop volumineux (10 Mo maximum)", "details": []}), 413

    @app.errorhandler(500)
    def server_error(err):
        db.session.rollback()
        app.logger.exception("Erreur serveur : %s", err)
        return jsonify({"error": "Erreur interne du serveur", "details": []}), 500

    @jwt.expired_token_loader
    def expired_token(_header, _payload):
        return jsonify({"error": "Session expirée", "details": []}), 401

    @jwt.invalid_token_loader
    def invalid_token(_reason):
        return jsonify({"error": "Jeton invalide", "details": []}), 401

    @jwt.unauthorized_loader
    def missing_token(_reason):
        return jsonify({"error": "Authentification requise", "details": []}), 401

    # Révocation des jetons : chaque jeton porte la version des jetons de son
    # compte (claim `tv`) au moment de son émission. Changer de mot de passe
    # ou être désactivé incrémente la version, ce qui invalide d'un coup tous
    # les jetons émis avant, accès comme rafraîchissement, sur tous les
    # appareils. Ce chargeur couvre toutes les routes protégées, y compris
    # `/auth/refresh` et l'identification facultative de la recherche.
    @jwt.token_in_blocklist_loader
    def jeton_revoque(_header, payload):
        from app.models import User

        # Lecture par clé primaire : `role_required` relit ensuite le même
        # utilisateur depuis l'identity map, sans seconde requête SQL. L'identity
        # map ne garde que des références faibles : sans celle posée dans `g`,
        # l'objet serait libéré dès la sortie de cette fonction et relu.
        user = db.session.get(User, payload.get("sub"))
        g.utilisateur_jwt = user
        # Un jeton émis avant ce lot n'a pas de claim : il vaut la version 0,
        # celle de tous les comptes existants au déploiement.
        return user is None or payload.get("tv", 0) != user.token_version

    @jwt.revoked_token_loader
    def revoked_token(_header, _payload):
        return jsonify({"error": "Session révoquée, veuillez vous reconnecter", "details": []}), 401

    return app
