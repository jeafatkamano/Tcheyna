"""schemas/admin.py — Décisions du back-office."""
from app.schemas import BaseCorps, Texte


class Decision(BaseCorps):
    # Décision explicite (R1) : un corps vide approuvait. Un vrai booléen
    # exigé : « "false" » valait approbation avec `bool("false")`.
    approuve: bool
    motif: Texte(1000) | None = None


class StatutCompte(BaseCorps):
    # Absent : bascule l'état actuel (comportement historique).
    is_active: bool | None = None
