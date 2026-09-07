"""
run.py — Point d'entrée de l'API Tcheyna.

Développement : python run.py          (http://localhost:5000)
Production    : gunicorn run:app
"""
import os

from app import create_app, db
from app.models import (
    Conversation,
    Favorite,
    Listing,
    Match,
    Message,
    Notification,
    OTPCode,
    Payment,
    Review,
    TenantPassport,
    User,
)
from config import get_config

app = create_app(get_config())


@app.shell_context_processor
def make_shell_context():
    """Objets disponibles dans `flask shell`."""
    return {
        "db": db,
        "User": User, "Listing": Listing, "Match": Match,
        "TenantPassport": TenantPassport, "Review": Review,
        "Payment": Payment, "OTPCode": OTPCode,
        "Conversation": Conversation, "Message": Message,
        "Favorite": Favorite, "Notification": Notification,
    }


@app.cli.command("init-db")
def init_db():
    """Crée les tables (à défaut de migrations Alembic) : flask init-db."""
    with app.app_context():
        db.create_all()
    print("✅ Tables créées")


if __name__ == "__main__":
    # 0.0.0.0 pour rester joignable depuis un téléphone sur le même réseau.
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=app.config.get("DEBUG", False))
