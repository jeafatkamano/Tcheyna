"""schemas/users.py — Édition du profil."""
from app.routes.geo import LOCATIONS
from app.schemas import BaseCorps, Choix, Texte


class MajProfil(BaseCorps):
    """Mise à jour partielle : un champ absent reste inchangé, `null` efface
    un champ facultatif et est refusé sur un champ obligatoire.

    `avatar_url` n'en fait pas partie : la photo se change par téléversement
    (POST /api/users/me/avatar), jamais en soumettant une URL arbitraire.
    """
    full_name: Texte(100, 1) = None
    pays: Choix(LOCATIONS) = None
    ville: Texte(50, 1) = None
    quartier: Texte(100) | None = None
    preferred_lang: Choix(("fr", "en")) = None
    bio: Texte(1000) | None = None
