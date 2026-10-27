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
    SQLALCHEMY_ENGINE_OPTIONS = {
        # Une connexion inactive est testée avant réemploi : les hébergeurs
        # mutualisés coupent les connexions dormantes sans prévenir.
        "pool_pre_ping": True,
        "pool_recycle": 280,
        # Le pool est volontairement petit : l'offre gratuite de Supabase
        # plafonne le nombre de connexions simultanées, et chaque worker
        # gunicorn possède son propre pool.
        "pool_size": 5,
        "max_overflow": 5,
    }

    # ─── JWT ────────────────────────────────────────────────
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-jwt-secret-a-changer")
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=2)
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=30)

    # ─── Limitation de débit (flask-limiter) ────────────────
    # Stockage déclaré explicitement : sans valeur, flask-limiter retombe sur
    # la mémoire en émettant un avertissement (qui ferait échouer les tests,
    # `filterwarnings = error`). Avec `memory://`, chaque worker gunicorn
    # (render.yaml : 2) tient ses propres compteurs, remis à zéro à chaque
    # redémarrage : le plafond réel de login et register va donc de 1× à 2×
    # le quota affiché. Passer à Redis (`redis://…`) ne demande que cette
    # variable et l'extra `flask-limiter[redis]`. Le quota d'envoi de SMS, qui
    # coûte de l'argent, est compté en base et ne dépend pas de ce stockage.
    RATELIMIT_STORAGE_URI = os.getenv("RATELIMIT_STORAGE_URI", "memory://")
    # Retry-After et X-RateLimit-* sur les routes limitées.
    RATELIMIT_HEADERS_ENABLED = True
    # Fenêtre glissante : une fenêtre fixe laisserait passer 2× le quota à
    # cheval sur deux périodes (10 essais à 14 min 59, 10 à 15 min 01).
    RATELIMIT_STRATEGY = "moving-window"

    # Nombre de proxys de confiance devant l'API, qui ajoutent chacun une
    # entrée à X-Forwarded-For. L'IP du client sert de clé aux limites de
    # débit : trop petit, tout le monde partage l'IP du proxy (inscriptions
    # bloquées pour tout le pays) ; trop grand, un client choisit sa clé en
    # ajoutant une fausse IP en tête de l'en-tête (force brute illimitée).
    # 1 = le répartiteur de Render ; à confirmer par la section « reseau »
    # de GET /api/admin/diagnostic.
    TRUSTED_PROXY_HOPS = int(os.getenv("TRUSTED_PROXY_HOPS", "1"))

    # ─── Codes OTP ──────────────────────────────────────────
    # Clé du HMAC qui protège les codes OTP en base. Vide : dérivée de
    # SECRET_KEY. Une clé dédiée permet de changer l'une sans l'autre ; la
    # changer invalide seulement les codes en cours (10 minutes de validité).
    OTP_HMAC_KEY = os.getenv("OTP_HMAC_KEY", "")

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

    # ─── Supabase Storage (photos et pièces justificatives) ─
    # Sans ces valeurs, les fichiers sont écrits sur le disque local — ce qui
    # convient au développement, mais pas à Render : son offre gratuite n'a
    # pas de disque persistant et efface les fichiers à chaque redémarrage.
    SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
    SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
    # Deux compartiments, et non un seul : un compartiment public rendrait
    # lisibles par leur URL les CNI et les titres de propriété qu'il
    # contiendrait, quel que soit le dossier.
    SUPABASE_BUCKET_PUBLIC = os.getenv("SUPABASE_BUCKET_PUBLIC", "tcheyna-photos")
    SUPABASE_BUCKET_PRIVE = os.getenv("SUPABASE_BUCKET_PRIVE", "tcheyna-documents")

    # ─── Conservation des pièces (décision D5) ──────────────
    # Nombre de jours au-delà duquel une pièce d'identité ou de revenus
    # restée SANS décision est supprimée par `flask donnees purger-pieces`.
    # D5 (15/10/2026) : 12 mois, comme l'annonce la politique de confidentialité ;
    # une pièce examinée est, elle, supprimée dès la décision.
    # Lue telle quelle : une valeur invalide ne doit pas empêcher l'application
    # de démarrer, c'est la purge qui la refuse (`purger_pieces_sans_decision`).
    DUREE_CONSERVATION_PIECES_JOURS = os.getenv("DUREE_CONSERVATION_PIECES_JOURS", "365").strip() or None

    # ─── Tâches nocturnes (lot 1.25, D13 révisée) ───────────
    # Jeton attendu dans l'en-tête X-Taches-Jeton par
    # POST /api/interne/taches-nocturnes, que cron-job.org appelle chaque
    # nuit. Vide : la route répond 404, la fonction est désactivée.
    TACHES_NOCTURNES_JETON = os.getenv("TACHES_NOCTURNES_JETON", "")

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


LONGUEUR_MIN_SECRET = 32

# Valeurs de repli de Config, ou d'exemple de .env.example. Le dépôt est
# public : une clé connue de tous permet de signer soi-même un JWT
# administrateur, ou de recalculer le HMAC des codes OTP.
SECRETS_CONNUS = frozenset({
    "dev-secret-a-changer-en-production",
    "dev-jwt-secret-a-changer",
    "changez-moi-en-production",
    "changez-moi-aussi-en-production",
})


def _secret_valide(valeur: str) -> bool:
    return len(valeur) >= LONGUEUR_MIN_SECRET and valeur not in SECRETS_CONNUS


class ProductionConfig(Config):
    DEBUG = False

    def __init__(self):
        # Sans DATABASE_URL, la classe de base retombe sur SQLite. En
        # production, cela écrirait sur un disque éphémère : les comptes et
        # les paiements disparaîtraient au premier redémarrage, sans erreur
        # visible. Mieux vaut refuser de démarrer.
        if not os.getenv("DATABASE_URL"):
            raise RuntimeError(
                "DATABASE_URL est absent. En production, la base PostgreSQL "
                "est obligatoire : le repli SQLite perdrait les données à "
                "chaque redémarrage."
            )

        # Même logique pour les secrets : la classe de base retombe sur des
        # valeurs publiques. Les valeurs sont relues ici et posées sur
        # l'instance, pour que la clé contrôlée soit celle qu'emploie Flask
        # (`from_object` lit les attributs de l'instance). Le message ne cite
        # jamais la valeur reçue.
        for cle in ("SECRET_KEY", "JWT_SECRET_KEY"):
            valeur = os.getenv(cle, "")
            if not _secret_valide(valeur):
                raise RuntimeError(
                    f"{cle} est absent, trop court (moins de "
                    f"{LONGUEUR_MIN_SECRET} caractères) ou égal à une valeur "
                    "d'exemple publique. Générez-en un avec : "
                    'python -c "import secrets; print(secrets.token_urlsafe(48))"'
                )
            setattr(self, cle, valeur)

        # OTP_HMAC_KEY reste facultatif (dérivé de SECRET_KEY s'il est vide),
        # mais une clé fournie doit être aussi forte que les autres.
        otp = os.getenv("OTP_HMAC_KEY", "")
        if otp and not _secret_valide(otp):
            raise RuntimeError(
                f"OTP_HMAC_KEY est trop court (moins de {LONGUEUR_MIN_SECRET} "
                "caractères) ou égal à une valeur d'exemple publique. "
                "Laissez-le vide pour le dériver de SECRET_KEY."
            )
        self.OTP_HMAC_KEY = otp

        # Jeton des tâches nocturnes : facultatif (absent, la route est
        # désactivée) ; fourni, aussi fort que les autres secrets.
        jeton = os.getenv("TACHES_NOCTURNES_JETON", "")
        if jeton and not _secret_valide(jeton):
            raise RuntimeError(
                f"TACHES_NOCTURNES_JETON est trop court (moins de {LONGUEUR_MIN_SECRET} "
                "caractères) ou égal à une valeur d'exemple publique. Générez-en un avec : "
                'python -c "import secrets; print(secrets.token_urlsafe(48))"'
            )
        # Le jeton sort de Render (il est saisi chez cron-job.org) : identique
        # à une autre clé, il en livrerait une copie (JWT_SECRET_KEY permet de
        # signer un jeton administrateur).
        if jeton and jeton in {self.SECRET_KEY, self.JWT_SECRET_KEY, self.OTP_HMAC_KEY}:
            raise RuntimeError(
                "TACHES_NOCTURNES_JETON doit être distinct de SECRET_KEY, "
                "JWT_SECRET_KEY et OTP_HMAC_KEY : générez-en un à part."
            )
        self.TACHES_NOCTURNES_JETON = jeton


class TestingConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    # Une base SQLite en mémoire n'a qu'une connexion, partagée : les options
    # de pool pensées pour PostgreSQL y sont refusées dès le démarrage.
    SQLALCHEMY_ENGINE_OPTIONS = {}


CONFIGS = {
    "development": DevelopmentConfig,
    "production": ProductionConfig,
    "testing": TestingConfig,
}


def get_config():
    """Sélectionne la configuration via FLASK_ENV (défaut : production).

    Retourne une instance et non la classe : ProductionConfig valide sa
    configuration dans son __init__. `Flask.config.from_object` accepte
    indifféremment une classe ou une instance.
    """
    return CONFIGS.get(os.getenv("FLASK_ENV", "production"), ProductionConfig)()
