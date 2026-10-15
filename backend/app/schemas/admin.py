"""schemas/admin.py — Décisions du back-office."""
from app.schemas import BaseCorps, Texte


class Decision(BaseCorps):
    # `approuve` vaut encore True par défaut : l'exiger explicitement est la
    # correction de R1, prévue au lot 1.4 avec le contrôle « pièce déposée ».
    # Ce lot garantit seulement qu'il s'agit d'un vrai booléen : « "false" »
    # ne vaut plus approbation, comme le faisait `bool("false")`.
    approuve: bool = True
    motif: Texte(1000) | None = None


class StatutCompte(BaseCorps):
    # Absent : bascule l'état actuel (comportement historique).
    is_active: bool | None = None
