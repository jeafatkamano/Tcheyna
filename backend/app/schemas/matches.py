"""schemas/matches.py — Candidatures et visites."""
from datetime import UTC, datetime, timedelta
from typing import Annotated

from pydantic import AfterValidator
from pydantic_core import PydanticCustomError

from app.schemas import BaseCorps, Choix, DateHeure, Texte

Identifiant = Texte(36, 1)

# Garde-fou technique, et non règle métier : une visite à plus d'un an trahit
# presque toujours une faute de frappe sur l'année (2062 pour 2026). Borne à
# confirmer par Kamano (question posée dans la PR du lot 2.7).
VISITE_HORIZON_MAX = timedelta(days=365)


def _visite_a_venir(valeur):
    """Ramène la date en UTC naïf, comme toutes les dates de la base, puis
    exige qu'elle soit à venir.

    Le web envoie la valeur d'un champ datetime-local, sans fuseau : l'heure
    murale de Conakry, qui est l'heure UTC (UTC+0 toute l'année, sans heure
    d'été). Une date avec fuseau (« …T14:30:00+01:00 ») est convertie : avant
    ce lot, PostgreSQL ignorait silencieusement le fuseau d'une colonne
    `timestamp without time zone`, et 14:30+01:00 devenait 14:30 UTC.
    """
    if valeur.tzinfo is not None:
        valeur = valeur.astimezone(UTC).replace(tzinfo=None)
    maintenant = datetime.utcnow()
    if valeur <= maintenant:
        raise PydanticCustomError("date_passee", "La visite doit être fixée à une date future")
    if valeur > maintenant + VISITE_HORIZON_MAX:
        raise PydanticCustomError("date_trop_lointaine",
                                  "La visite doit être fixée dans les 12 prochains mois")
    return valeur


class Candidature(BaseCorps):
    listing_id: Identifiant
    message: Texte(1000) | None = None


class DecisionCandidature(BaseCorps):
    statut: Choix(("accepted", "rejected"))


class Visite(BaseCorps):
    # « 2026-09-15T14:30 » (champ datetime-local, sans fuseau) ou ISO 8601
    # complet ; voir `_visite_a_venir` pour le traitement du fuseau.
    visite_date: Annotated[DateHeure, AfterValidator(_visite_a_venir)]
