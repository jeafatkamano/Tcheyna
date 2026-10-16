"""schemas/payments.py — Paiements Mobile Money."""
from typing import Annotated

from pydantic import BeforeValidator, ConfigDict
from pydantic_core import PydanticCustomError

from app.models import PAYMENT_TYPES
from app.schemas import BaseCorps, Choix, Texte
from app.schemas.matches import Identifiant

METHODES = ("orange_money", "mtn_momo", "wave", "moov", "carte")

# Caution et premier loyer ne passent plus par la plateforme (décision D2 = A,
# PRD §8.2) : Tcheyna n'a pas d'agrément pour détenir des fonds de tiers. Ces
# types restent dans PAYMENT_TYPES pour afficher les paiements déjà enregistrés.
PAIEMENTS_HORS_PLATEFORME = ("caution", "premier_loyer")
MESSAGE_HORS_PLATEFORME = ("La caution et le loyer ne se paient pas via Tcheyna : ils se "
                           "règlent directement entre le bailleur et le locataire.")
# Encaissé par CinetPay mais non dû (caution, loyer, doublon) : jamais
# confirmé. Un admin rembourse à la main puis passe le paiement à REMBOURSE.
A_REMBOURSER = "a_rembourser"
REMBOURSE = "rembourse"

TYPES_PAYABLES = tuple(t for t in PAYMENT_TYPES if t not in PAIEMENTS_HORS_PLATEFORME)


def _payable_via_tcheyna(valeur):
    if isinstance(valeur, str) and valeur.strip() in PAIEMENTS_HORS_PLATEFORME:
        raise PydanticCustomError("hors_plateforme", MESSAGE_HORS_PLATEFORME)
    return valeur


class InitierPaiement(BaseCorps):
    """Le montant et la devise sont toujours fixés par le serveur : `devise`
    est refusée comme tout champ inconnu."""
    type_paiement: Annotated[Choix(TYPES_PAYABLES), BeforeValidator(_payable_via_tcheyna)]
    methode: Choix(METHODES) | None = None
    match_id: Identifiant | None = None
    listing_id: Identifiant | None = None


class CallbackCinetPay(BaseCorps):
    # CinetPay envoie bien d'autres champs (cpm_site_id, signature…) que
    # nous n'utilisons pas : seul l'identifiant de transaction est lu, le
    # statut étant toujours revérifié auprès de CinetPay.
    model_config = ConfigDict(extra="ignore")

    cpm_trans_id: Texte(100, 1)
