"""schemas/payments.py — Paiements Mobile Money."""
from pydantic import ConfigDict

from app.models import PAYMENT_TYPES
from app.schemas import BaseCorps, Choix, Texte
from app.schemas.matches import Identifiant

METHODES = ("orange_money", "mtn_momo", "wave", "moov", "carte")


class InitierPaiement(BaseCorps):
    """Le montant et la devise sont toujours fixés par le serveur : `devise`
    est refusée comme tout champ inconnu."""
    type_paiement: Choix(PAYMENT_TYPES) = "caution"
    methode: Choix(METHODES) | None = None
    match_id: Identifiant | None = None
    listing_id: Identifiant | None = None


class CallbackCinetPay(BaseCorps):
    # CinetPay envoie bien d'autres champs (cpm_site_id, signature…) que
    # nous n'utilisons pas : seul l'identifiant de transaction est lu, le
    # statut étant toujours revérifié auprès de CinetPay.
    model_config = ConfigDict(extra="ignore")

    cpm_trans_id: Texte(100, 1)
