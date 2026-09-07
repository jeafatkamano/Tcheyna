"""
config.py — Configuration de l'API Tcheyna.

Toutes les valeurs sensibles proviennent de l'environnement (.env en local,
variables Render en production). Les valeurs par défaut sont conçues pour un
poste de développement, jamais pour la production.
"""
import os
from datetime import timedelta

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = os.path.abspath(os.path.dirname(__file__))


class Config:
    # ─── Application ────────────────────────────────────────
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-a-changer-en-production")
    DEBUG = os.getenv("FLASK_DEBUG", "false").lower() == "true"

    # ─── Base de données ────────────────────────────────────
    # En local, SQLite suffit ; en production, PostgreSQL (Supabase).
    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL",
        f"sqlite:///{os.path.join(BASE_DIR, 'tcheyna.sqlite')}",
    )
    # Render et Heroku fournissent des URLs `postgres://`, que SQLAlchemy 2 refuse.
    if SQLALCHEMY_DATABASE_URI.startswith("postgres://"):
        SQLALCHEMY_DATABASE_URI = SQLALCHEMY_DATABASE_URI.replace(
            "postgres://", "postgresql://", 1
        )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {"pool_pre_ping": True, "pool_recycle": 280}

    # ─── JWT ────────────────────────────────────────────────
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-jwt-secret-a-changer")
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=2)
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=30)

    # ─── CORS ───────────────────────────────────────────────
    CORS_ORIGINS = [
        origine.strip()
        for origine in os.getenv(
            "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(",")
        if origine.strip()
    ]

    # ─── Fichiers téléversés (CNI, justificatifs, documents) ─
    UPLOAD_FOLDER = os.getenv("UPLOAD_FOLDER", os.path.join(BASE_DIR, "uploads"))
    MAX_CONTENT_LENGTH = 10 * 1024 * 1024  # 10 Mo
    ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "pdf"}

    # ─── Africa's Talking (OTP SMS) ─────────────────────────
    AT_API_KEY = os.getenv("AT_API_KEY", "")
    AT_USERNAME = os.getenv("AT_USERNAME", "sandbox")
    AT_SENDER_ID = os.getenv("AT_SENDER_ID", "TCHEYNA")

    # ─── CinetPay (Mobile Money) ────────────────────────────
    CINETPAY_API_KEY = os.getenv("CINETPAY_API_KEY", "")
    CINETPAY_SITE_ID = os.getenv("CINETPAY_SITE_ID", "")
    CINETPAY_NOTIFY_URL = os.getenv("CINETPAY_NOTIFY_URL", "")
    CINETPAY_RETURN_URL = os.getenv("CINETPAY_RETURN_URL", "")


class DevelopmentConfig(Config):
    DEBUG = True


class ProductionConfig(Config):
    DEBUG = False


class TestingConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"


CONFIGS = {
    "development": DevelopmentConfig,
    "production": ProductionConfig,
    "testing": TestingConfig,
}


def get_config():
    """Sélectionne la configuration via FLASK_ENV (défaut : production)."""
    return CONFIGS.get(os.getenv("FLASK_ENV", "production"), ProductionConfig)
