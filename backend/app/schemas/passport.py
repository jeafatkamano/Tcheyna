"""schemas/passport.py — Passeport Locataire : situation et critères."""
from typing import Annotated

from pydantic import BeforeValidator, Field

from app.models import TYPES_BIEN
from app.routes.geo import CURRENCIES, LOCATIONS, MARCHES_OUVERTS
from app.schemas import BaseCorps, Choix, DateVide, Entier, Entier32, Texte

SITUATIONS_PRO = ("salarié", "indépendant", "étudiant", "commerçant", "fonctionnaire", "autre")
DEVISES_OUVERTES = tuple(dict.fromkeys(CURRENCIES[p]["code"] for p in MARCHES_OUVERTS))
VILLES_OUVERTES = tuple(v for p in MARCHES_OUVERTS for v in LOCATIONS[p])
MAX_QUARTIERS = 40


class MajPasseport(BaseCorps):
    revenu_mensuel: Entier32 | None = None
    devise: Choix(DEVISES_OUVERTES) = None
    employeur: Texte(100) | None = None
    situation_pro: Choix(SITUATIONS_PRO) | None = None
    a_un_garant: bool = None
    garant_nom: Texte(100) | None = None
    garant_revenu: Entier32 | None = None


def _liste_de_quartiers(valeur):
    # Compatibilité : les premières versions du front envoyaient une chaîne
    # « Kipé,Nongo ». Les entrées vides sont ignorées, comme avant.
    if isinstance(valeur, str):
        valeur = valeur.split(",")
    if isinstance(valeur, list):
        return [q for q in valeur if not (isinstance(q, str) and not q.strip())]
    return valeur


Quartiers = Annotated[list[Texte(100, 1)], BeforeValidator(_liste_de_quartiers),
                      Field(max_length=MAX_QUARTIERS)]


class Criteres(BaseCorps):
    budget_min: Entier32 | None = None
    budget_max: Entier32 | None = None
    ville_souhaitee: Choix(VILLES_OUVERTES) | None = None
    quartiers_souhaites: Quartiers | None = None
    type_bien_souhaite: Choix(TYPES_BIEN) | None = None
    nb_pieces_min: Entier(1, 50) | None = None
    nb_occupants: Entier(1, 30) | None = None
    date_emmenagement: DateVide = None
