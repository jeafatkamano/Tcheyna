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
# Encaissé par CinetPay mais non dû (caution, loyer, doublon, frais d'une
# candidature retirée ou refusée pendant le paiement) : jamais
# confirmé. Un admin rembourse à la main puis passe le paiement à REMBOURSE.
A_REMBOURSER = "a_rembourser"
REMBOURSE = "rembourse"

# La commission de 6 % est remplacée par les frais fixes de mise en relation
# (décision D1, 20/10/2026). Le type reste dans PAYMENT_TYPES pour relire les
# commissions déjà enregistrées (reçus, historique, admin).
TYPES_RETIRES = ("commission",)
MESSAGE_TYPE_RETIRE = ("La commission de 6 % n'existe plus : Tcheyna facture des frais de "
                       "mise en relation fixes, réglés quand vous acceptez une candidature "
                       "de location.")

TYPES_PAYABLES = tuple(t for t in PAYMENT_TYPES
                       if t not in PAIEMENTS_HORS_PLATEFORME and t not in TYPES_RETIRES)


def _payable_via_tcheyna(valeur):
    if isinstance(valeur, str) and valeur.strip() in PAIEMENTS_HORS_PLATEFORME:
        raise PydanticCustomError("hors_plateforme", MESSAGE_HORS_PLATEFORME)
    if isinstance(valeur, str) and valeur.strip() in TYPES_RETIRES:
        raise PydanticCustomError("type_retire", MESSAGE_TYPE_RETIRE)
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
