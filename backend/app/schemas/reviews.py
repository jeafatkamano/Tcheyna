"""schemas/reviews.py — Avis croisés."""
from app.schemas import BaseCorps, Entier, Texte
from app.schemas.matches import Identifiant


class Avis(BaseCorps):
    match_id: Identifiant
    note: Entier(1, 5)
    commentaire: Texte(1000) | None = None
