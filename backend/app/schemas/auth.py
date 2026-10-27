"""schemas/auth.py — Inscription, connexion, mot de passe et OTP."""
import re
from typing import Annotated

from pydantic import AfterValidator
from pydantic_core import PydanticCustomError

from app.routes.geo import LOCATIONS
from app.schemas import BaseCorps, Choix, MotDePasse, MotDePasseSaisi, Texte

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$")


def _email(valeur):
    valeur = valeur.lower()
    if not EMAIL_RE.match(valeur):
        raise PydanticCustomError("email_invalide", "Adresse e-mail invalide")
    return valeur


Email = Annotated[Texte(120, 1), AfterValidator(_email)]
# Le numéro est normalisé puis contrôlé par la route (`normaliser_phone`,
# `PHONE_RE`) : seule la saisie brute est bornée ici.
TelephoneSaisi = Texte(30)


class Inscription(BaseCorps):
    email: Email
    password: MotDePasse
    full_name: Texte(100, 1)
    role: Choix(("tenant", "landlord", "agency"))
    phone: TelephoneSaisi | None = None
    # Un utilisateur peut résider hors des marchés ouverts (diaspora, futur
    # marché) : seul le référentiel est imposé, pas `MARCHES_OUVERTS`.
    pays: Choix(LOCATIONS) = "Guinée"
    ville: Texte(50, 1) = "Conakry"
    quartier: Texte(100) | None = None
    preferred_lang: Choix(("fr", "en")) = "fr"


class Connexion(BaseCorps):
    # Identifiant saisi : adresse e-mail, ou numéro de téléphone vérifié
    # (lot 3.8). Le champ garde son nom `email` pour rester compatible avec
    # les clients existants. Pas de contrôle de format : un refus doit rester
    # « Identifiants incorrects », sans dire ce qui cloche.
    email: Texte(120, 1)
    password: MotDePasseSaisi


class ChangementMotDePasse(BaseCorps):
    ancien_mot_de_passe: MotDePasseSaisi
    nouveau_mot_de_passe: MotDePasse


class EnvoiOTP(BaseCorps):
    phone: TelephoneSaisi | None = None


def _code(valeur):
    if not (len(valeur) == 6 and valeur.isascii() and valeur.isdigit()):
        raise PydanticCustomError("code_invalide", "Le code doit comporter 6 chiffres")
    return valeur


CodeOTP = Annotated[Texte(6, 1), AfterValidator(_code)]


class VerificationOTP(BaseCorps):
    code: CodeOTP


# ─── Mot de passe oublié (lot 3.8) ───────────────────────────
# Numéro requis ; normalisé puis contrôlé par la route, comme ailleurs.

class DemandeReinitialisation(BaseCorps):
    phone: Texte(30, 1)


class ConfirmationReinitialisation(BaseCorps):
    phone: Texte(30, 1)
    code: CodeOTP
    # Même politique qu'à l'inscription et au changement de mot de passe.
    nouveau_mot_de_passe: MotDePasse
