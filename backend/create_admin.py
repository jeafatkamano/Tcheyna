"""
create_admin.py — Crée (ou promeut) un compte administrateur.

Usage : python create_admin.py
"""
import getpass
import sys

from dotenv import load_dotenv

load_dotenv()

from werkzeug.security import generate_password_hash  # noqa: E402

from app import db  # noqa: E402
from app.models import User  # noqa: E402
from run import app  # noqa: E402


def main():
    with app.app_context():
        db.create_all()

        email = input("E-mail de l'administrateur : ").strip().lower()
        if not email:
            sys.exit("E-mail requis.")

        existant = User.query.filter_by(email=email).first()
        if existant:
            if existant.role == "admin":
                sys.exit(f"{email} est déjà administrateur.")
            if input(f"{email} existe ({existant.role}). Le promouvoir admin ? [o/N] ").lower() != "o":
                sys.exit("Annulé.")
            existant.role = "admin"
            db.session.commit()
            print(f"✅ {email} est maintenant administrateur.")
            return

        nom = input("Nom complet : ").strip() or "Administrateur Tcheyna"
        mot_de_passe = getpass.getpass("Mot de passe (8 caractères minimum) : ")
        if len(mot_de_passe) < 8:
            sys.exit("Mot de passe trop court.")
        if mot_de_passe != getpass.getpass("Confirmer le mot de passe : "):
            sys.exit("Les mots de passe ne correspondent pas.")

        db.session.add(User(
            email=email,
            password_hash=generate_password_hash(mot_de_passe),
            full_name=nom,
            role="admin",
            pays="Guinée",
            ville="Conakry",
            trust_level=4,
            phone_verified=True,
            cni_verified=True,
            income_verified=True,
        ))
        db.session.commit()
        print(f"✅ Administrateur créé : {email}")


if __name__ == "__main__":
    main()
