"""schemas/matches.py — Candidatures et visites."""
from app.schemas import BaseCorps, Choix, DateHeure, Texte

Identifiant = Texte(36, 1)


class Candidature(BaseCorps):
    listing_id: Identifiant
    message: Texte(1000) | None = None


class DecisionCandidature(BaseCorps):
    statut: Choix(("accepted", "rejected"))


class Visite(BaseCorps):
    # « 2026-09-15T14:30 » (champ datetime-local, sans fuseau) ou ISO 8601
    # complet ; un fuseau éventuel est conservé, comme avant.
    visite_date: DateHeure
