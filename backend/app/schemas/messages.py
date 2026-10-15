"""schemas/messages.py — Messagerie."""
from app.schemas import BaseCorps, Texte

LONGUEUR_MAX = 2000


class NouveauMessage(BaseCorps):
    contenu: Texte(LONGUEUR_MAX, 1)
