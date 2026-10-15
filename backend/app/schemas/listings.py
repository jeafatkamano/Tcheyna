"""schemas/listings.py — Annonces, photos et documents.

`status`, `is_visible` et `images` ne figurent dans aucun schéma, donc sont
refusés (422) : le cycle de vie d'une annonce passe par des actions dédiées
(retrait : DELETE /listings/<id>), et ses photos par les routes `/photos`,
qui n'acceptent que des fichiers téléversés sur notre stockage — jamais une
URL externe (pixel de suivi, image tierce affichée comme photo du bien).
`devise` découle du pays, côté serveur. Elle reste tolérée en entrée si
elle vaut cette devise (contrôlé par la route, qui connaît le pays final) :
un ancien bundle front en cache l'envoie encore. Elle n'est jamais écrite.
"""
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_core import PydanticCustomError

from app.models import TYPES_BIEN, TYPES_TRANSACTION
from app.routes.geo import LOCATIONS, MARCHES_OUVERTS
from app.schemas import BaseCorps, Choix, DateVide, Entier, Entier32, Superficie, Texte

MAX_IMAGES = 10

# `listings.prix` est un BIGINT : un prix de vente dépasse vite 2^31 GNF
# (≈ 250 000 $). La borne arrête une saisie absurde, pas une vraie vente.
PRIX_MAX = 10**12
# Un loyer, ses charges et sa caution sont réglés par `payments.montant`,
# encore en INTEGER : loyer + charges doit y tenir (premier loyer).
LOYER_MAX = 1_000_000_000

Prix = Entier(1, PRIX_MAX)
Charges = Entier(0, LOYER_MAX)
Pieces = Entier(1, 50)
Etage = Entier(-5, 200)
Url = Texte(1000, 1)


def verifier_lieu(pays, ville):
    """La ville doit appartenir au pays : la recherche filtre sur une
    égalité exacte, une ville mal orthographiée rendrait l'annonce
    introuvable."""
    villes = LOCATIONS.get(pays, {})
    if ville not in villes:
        raise PydanticCustomError("lieu_invalide", "Ville inconnue pour {pays} : {ville}",
                                  {"pays": pays, "ville": ville})


class CreationAnnonce(BaseCorps):
    title_fr: Texte(200, 1)
    title_en: Texte(200) | None = None
    description_fr: Texte(5000, 1)
    description_en: Texte(5000) | None = None
    pays: Choix(MARCHES_OUVERTS)
    ville: Texte(50, 1)
    quartier: Texte(100) | None = None
    adresse: Texte(300) | None = None
    type_transaction: Choix(TYPES_TRANSACTION) = "location"
    type_bien: Choix(TYPES_BIEN)
    prix: Prix
    charges: Charges | None = 0
    caution: Entier32 | None = None
    nb_pieces: Pieces | None = 1
    superficie: Superficie | None = None
    etage: Etage | None = None
    meuble: bool = False
    disponible_a_partir: DateVide = None
    has_generator: bool = False
    has_water: bool = False
    has_wifi: bool = False
    is_secured: bool = False
    has_parking: bool = False
    has_ac: bool = False
    devise: Texte(10) | None = None  # tolérée, voir l'en-tête du module

    @field_validator("ville")
    @classmethod
    def _ville_du_pays(cls, ville, info):
        # `pays` est validé avant `ville` (ordre de déclaration) ; s'il est
        # invalide, son erreur suffit.
        if "pays" in info.data:
            verifier_lieu(info.data["pays"], ville)
        return ville


class MajAnnonce(BaseCorps):
    """Mise à jour partielle. Les champs obligatoires de l'annonce ont pour
    défaut `None` sans l'accepter en entrée : absent = inchangé, `null` = 422
    (il violerait la contrainte NOT NULL, donc un 500)."""
    title_fr: Texte(200, 1) = None
    title_en: Texte(200) | None = None
    description_fr: Texte(5000, 1) = None
    description_en: Texte(5000) | None = None
    pays: Choix(MARCHES_OUVERTS) = None
    ville: Texte(50, 1) = None
    quartier: Texte(100) | None = None
    adresse: Texte(300) | None = None
    type_transaction: Choix(TYPES_TRANSACTION) = None
    type_bien: Choix(TYPES_BIEN) = None
    prix: Prix = None
    charges: Charges | None = None
    caution: Entier32 | None = None
    nb_pieces: Pieces | None = None
    superficie: Superficie | None = None
    etage: Etage | None = None
    meuble: bool = None
    disponible_a_partir: DateVide = None
    has_generator: bool = None
    has_water: bool = None
    has_wifi: bool = None
    is_secured: bool = None
    has_parking: bool = None
    has_ac: bool = None
    devise: Texte(10) | None = None  # tolérée, voir l'en-tête du module


class UrlFichier(BaseCorps):
    url: Url


class OrdrePhotos(BaseCorps):
    images: Annotated[list[Url], Field(max_length=MAX_IMAGES)]
