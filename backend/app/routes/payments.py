"""
routes/payments.py — Paiements Mobile Money via CinetPay.

Couvre les services Tcheyna : frais de mise en relation, certification
d'annonce et mise en avant (payés par le propriétaire), abonnement Passeport
(locataire).

Frais de mise en relation (décision D1, 20/10/2026) : un montant fixe, payé
par le bailleur quand il accepte une candidature de location. L'acceptation
ne prend effet qu'à la confirmation du paiement (`_confirmer`), si bien que
rien de ce qu'elle débloque (adresse exacte, messagerie, notification du
locataire) ne sort avant. Une vente reste gratuite. Ils remplacent la
commission de 6 % du premier loyer, qu'on ne peut plus initier ; les
commissions déjà enregistrées restent lisibles (historique, reçus, admin).

Caution et premier loyer ne passent plus par la plateforme (décision D2 = A,
PRD §8.2) : Tcheyna n'a pas d'agrément pour détenir des fonds de tiers. Les
paiements de ces types déjà enregistrés restent lisibles (historique, reçus) ;
leur refus à l'initiation est porté par `schemas.payments.InitierPaiement`.

Chaque paiement réussi produit un reçu numérique consultable par les deux
parties — la traçabilité promise dans le business plan.
"""
import uuid
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation

import requests
from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request
from flask_limiter.util import get_remote_address
from sqlalchemy import select

from app import db, limiter
from app.models import (
    PAYMENT_TYPES,
    Listing,
    Match,
    Payment,
    User,
    abonnements_passeport,
)
from app.routes import current_user_required
from app.schemas import valider_corps
from app.schemas.payments import (
    A_REMBOURSER,
    PAIEMENTS_HORS_PLATEFORME,
    CallbackCinetPay,
    InitierPaiement,
)
from app.services import notifications as notify
from app.services.acces import peut_voir_adresse

payments_bp = Blueprint("payments", __name__)

CINETPAY_INIT_URL = "https://api-checkout.cinetpay.com/v2/payment"
CINETPAY_CHECK_URL = "https://api-checkout.cinetpay.com/v2/payment/check"

# Frais fixes de mise en relation (D1) : payés par le bailleur à
# l'acceptation d'une candidature de location.
FRAIS_MISE_EN_RELATION = "frais_mise_en_relation"
FRAIS_MISE_EN_RELATION_GNF = 250_000

# Tarifs des services Tcheyna, en GNF (base : Conakry). Ouvrir un marché
# dans une autre devise demandera une grille par devise : aucun montant n'est
# encore fixé en XOF, GHS ou NGN.
DEVISE_TARIFS = "GNF"
TARIFS_GNF = {
    "certification":        250_000,
    "abonnement_passeport": 150_000,
    "mise_en_avant":        200_000,
    FRAIS_MISE_EN_RELATION: FRAIS_MISE_EN_RELATION_GNF,
}
DUREE_MISE_EN_AVANT = timedelta(days=30)

# Issues possibles d'une vérification auprès de CinetPay. « Inconnu » couvre
# tout ce qui n'est ni un succès ni un refus explicite (panne réseau, réponse
# illisible, transaction encore en cours, montant non conforme) : le paiement
# reste alors en attente, car un client a peut-être déjà été débité.
ACCEPTE, REFUSE, INCONNU = "accepte", "refuse", "inconnu"

# Services rattachés à une candidature : l'ancienne commission (lecture et
# confirmation des paiements déjà initiés) et les frais de mise en relation.
SERVICES_PAR_CANDIDATURE = ("commission", FRAIS_MISE_EN_RELATION)

# Les frais s'acquittent avant que l'acceptation ne prenne effet : seule une
# candidature encore en attente de décision peut les porter.
CANDIDATURE_EN_ATTENTE = "pending"

# Un paiement resté en attente (callback perdu, réseau coupé) bloque un
# nouveau paiement du même service pendant ce délai : le client a peut-être
# déjà été débité. Au-delà, on le laisse recommencer ; si l'ancien est accepté
# plus tard, il passe « à rembourser » au lieu de faire payer deux fois.
DELAI_REPRISE_PAIEMENT = timedelta(minutes=30)

# Reprise bornée : au plus ce nombre de paiements en attente revérifiés, et
# seulement ceux de moins d'un jour. Chaque vérification peut prendre 15 s
# sur un serveur à deux workers ; les plus anciens relèvent d'une
# réconciliation à part.
REPRISE_MAX_VERIFICATIONS = 3
REPRISE_FENETRE = timedelta(days=1)

# Chaque initiation crée une ligne et appelle CinetPay : plafond par compte.
LIMITE_INITIATION = "10 per minute"


def _reference():
    """Référence de reçu lisible : TCH-XXXXXXXX."""
    return f"TCH-{uuid.uuid4().hex[:8].upper()}"


def _montant_attendu(type_paiement, user, match, listing):
    """Détermine le montant à payer et son libellé.

    Le montant vient toujours du serveur : le client ne choisit jamais combien
    il paie, sauf pour les paiements libres entre parties.
    """
    # Les frais découlent d'un bail : une vente est gratuite, son acceptation
    # libre, et la cession se règle par acte notarié hors plateforme.
    vente = bool(match and match.listing and match.listing.est_vente)
    if vente and type_paiement == FRAIS_MISE_EN_RELATION:
        return None, None, ("Aucun frais ne s'applique à une vente : acceptez la "
                            "candidature directement. La cession se règle devant "
                            "notaire, hors plateforme.")

    if type_paiement == FRAIS_MISE_EN_RELATION:
        if not match or not match.listing:
            return None, None, "match_id requis pour les frais de mise en relation"
        if listing and listing.id != match.listing_id:
            return None, None, "Cette candidature ne porte pas sur cette annonce"
        if match.status != CANDIDATURE_EN_ATTENTE:
            return None, None, ("Seule une candidature en attente de votre décision "
                                "peut être acceptée")
        return (FRAIS_MISE_EN_RELATION_GNF,
                f"Frais de mise en relation — {match.listing.title_fr}", None)

    if type_paiement == "certification":
        if not listing:
            return None, None, "listing_id requis pour une certification"
        return TARIFS_GNF["certification"], f"Certification — {listing.title_fr}", None

    if type_paiement == "mise_en_avant":
        if not listing:
            return None, None, "listing_id requis pour une mise en avant"
        return TARIFS_GNF["mise_en_avant"], f"Mise en avant 30 jours — {listing.title_fr}", None

    if type_paiement == "abonnement_passeport":
        if user.role != "tenant":
            return None, None, "L'abonnement Passeport est réservé aux locataires"
        # Payer une seconde fois pendant l'abonnement n'apporterait rien.
        fin = abonnements_passeport([user.id]).get(user.id)
        if fin:
            return None, None, f"Votre abonnement Passeport court déjà jusqu'au {fin:%d/%m/%Y}"
        return TARIFS_GNF["abonnement_passeport"], "Abonnement Passeport Locataire (1 an)", None

    return None, None, f"Type de paiement inconnu : {type_paiement}"


def _filtre_service(type_paiement, user_id, match_id, listing_id):
    """Critères qui identifient « le même service » qu'un paiement règle.

    Frais de mise en relation (et ancienne commission) se rattachent à la
    candidature, certification et mise en avant à l'annonce, l'abonnement
    Passeport au seul locataire.
    """
    criteres = [Payment.type_paiement == type_paiement, Payment.user_id == user_id]
    if type_paiement in SERVICES_PAR_CANDIDATURE:
        criteres.append(Payment.match_id == match_id)
    elif type_paiement in ("certification", "mise_en_avant"):
        criteres.append(Payment.listing_id == listing_id)
    return criteres


def _service_deja_regle(type_paiement, user_id, match_id, listing, exclure_id=None):
    """Le service est-il déjà payé, si bien qu'un nouveau paiement ferait double emploi ?

    Frais de mise en relation : un seul paiement réussi par candidature.
    Certification : un seul paiement par annonce, comme l'exige déjà
    `listings.demander_certification`, qui accepte toute nouvelle demande
    (après un refus par exemple) dès qu'un paiement réussi existe.
    La mise en avant n'est jamais un doublon : chaque achat prolonge de 30 jours.
    """
    if type_paiement in (*SERVICES_PAR_CANDIDATURE, "certification"):
        if type_paiement == "certification" and not listing:
            return False
        requete = Payment.query.filter(
            *_filtre_service(type_paiement, user_id, match_id,
                             listing.id if listing else None),
            Payment.statut == "success")
        if exclure_id:
            requete = requete.filter(Payment.id != exclure_id)
        return requete.first() is not None
    if type_paiement == "abonnement_passeport":
        return user_id in abonnements_passeport([user_id])
    return False


def _cle_payeur():
    """Clé de limitation de /initier : le compte, sinon l'adresse IP.

    À Conakry, beaucoup d'abonnés mobiles sortent par la même IP (CGNAT) :
    une limite par IP bloquerait des inconnus entre eux.
    """
    try:
        verify_jwt_in_request(optional=True)
        identite = get_jwt_identity()
    except Exception:  # noqa: BLE001 — le jeton est validé ensuite par la route
        identite = None
    return f"compte:{identite}" if identite else get_remote_address()


def _reprendre_paiement_en_attente(type_paiement, user_id, match_id, listing_id):
    """Revérifie les paiements en attente du même service avant d'en créer un.

    Renvoie `(confirme, en_cours)` : le paiement que cette reprise vient de
    confirmer, et celui encore en attente trop récent pour être abandonné.
    Les deux à None : on peut en initier un nouveau. Les vérifications ont
    lieu hors de toute transaction, puis s'appliquent sous verrou comme un
    callback.
    """
    maintenant = datetime.utcnow()
    en_attente = (Payment.query
                  .filter(*_filtre_service(type_paiement, user_id, match_id, listing_id),
                          Payment.statut == "pending",
                          Payment.created_at > maintenant - REPRISE_FENETRE)
                  .order_by(Payment.created_at.desc())
                  .limit(REPRISE_MAX_VERIFICATIONS).all())
    a_verifier = [(p.id, p.cinetpay_transaction_id) for p in en_attente]
    if a_verifier:
        db.session.rollback()  # pas de transaction ouverte pendant les appels sortants

    confirme = en_cours = None
    limite = maintenant - DELAI_REPRISE_PAIEMENT
    for paiement_id, transaction_id in a_verifier:
        issue, donnees = _verifier_aupres_de_cinetpay(transaction_id)
        paiement = _appliquer_verification(paiement_id, issue, donnees)
        if paiement.statut == "success" and confirme is None:
            confirme = paiement
        elif paiement.statut == "pending" and paiement.created_at > limite and en_cours is None:
            en_cours = paiement
    return confirme, en_cours


def frais_mise_en_relation_a_regler(match):
    """L'acceptation de `match` attend-elle le paiement des frais (D1) ?

    Oui pour une candidature de location encore en attente dont les frais ne
    sont pas déjà réglés. Une vente reste libre, comme une candidature déjà
    acceptée (avant D1, ou par la confirmation d'un paiement).
    """
    if not match or not match.listing or match.listing.est_vente:
        return False
    if match.status != CANDIDATURE_EN_ATTENTE:
        return False
    return not _service_deja_regle(FRAIS_MISE_EN_RELATION, match.listing.landlord_id,
                                   match.id, None)


def refus_acceptation_sans_frais(match):
    """Réponse `(corps, code)` à renvoyer au bailleur qui accepte une
    candidature de location sans avoir réglé les frais, ou None.

    La candidature reste en attente : c'est la confirmation du paiement
    (`_confirmer`) qui l'accepte. Hors GNF, aucun montant n'est fixé : le
    service n'est pas proposé, comme les autres tarifs.
    """
    if not frais_mise_en_relation_a_regler(match):
        return None
    if match.listing.devise != DEVISE_TARIFS:
        return {"error": f"Les frais de mise en relation ne sont proposés qu'en "
                         f"{DEVISE_TARIFS} pour le moment : cette candidature ne peut "
                         "pas encore être acceptée."}, 400
    montant = f"{FRAIS_MISE_EN_RELATION_GNF:,}".replace(",", " ")
    return {
        "error": f"Pour accepter cette candidature, réglez les frais de mise en relation "
                 f"({montant} {DEVISE_TARIFS}). L'acceptation prendra effet dès la "
                 "confirmation du paiement.",
        "action_requise": "payer_frais_mise_en_relation",
        "paiement": {
            "type_paiement": FRAIS_MISE_EN_RELATION,
            "match_id":      match.id,
            "montant":       FRAIS_MISE_EN_RELATION_GNF,
            "devise":        DEVISE_TARIFS,
        },
    }, 402


# ─── GET /api/payments/tarifs ────────────────────────────────

@payments_bp.route("/tarifs", methods=["GET"])
def tarifs():
    """Grille tarifaire publique."""
    return jsonify({
        "devise": DEVISE_TARIFS,
        "services": [
            {"type": FRAIS_MISE_EN_RELATION, "libelle": PAYMENT_TYPES[FRAIS_MISE_EN_RELATION],
             "montant": FRAIS_MISE_EN_RELATION_GNF, "payeur": "Propriétaire",
             "moment": "À l'acceptation d'une candidature de location",
             "description": "Dus par le propriétaire ou l'agence quand il accepte une "
                            "candidature de location : l'acceptation prend effet à la "
                            "confirmation du paiement. Aucun frais sur une vente."},
            {"type": "certification", "libelle": PAYMENT_TYPES["certification"],
             "montant": TARIFS_GNF["certification"], "payeur": "Propriétaire",
             "description": "Vérification des documents de propriété et badge Annonce Certifiée"},
            {"type": "mise_en_avant", "libelle": PAYMENT_TYPES["mise_en_avant"],
             "montant": TARIFS_GNF["mise_en_avant"], "payeur": "Propriétaire",
             "description": "Positionnement prioritaire pendant 30 jours"},
            {"type": "abonnement_passeport", "libelle": PAYMENT_TYPES["abonnement_passeport"],
             "montant": TARIFS_GNF["abonnement_passeport"], "payeur": "Locataire",
             "description": "Profil vérifié et mis en avant auprès des propriétaires (1 an)"},
        ],
    }), 200


# ─── POST /api/payments/initier ──────────────────────────────

@payments_bp.route("/initier", methods=["POST"])
@limiter.limit(LIMITE_INITIATION, key_func=_cle_payeur)
@current_user_required
@valider_corps(InitierPaiement)
def initier_paiement(current_user, corps):
    type_paiement, methode = corps.type_paiement, corps.methode
    match = Match.query.get(corps.match_id) if corps.match_id else None
    listing = Listing.query.get(corps.listing_id) if corps.listing_id else None

    # Contrôles d'accès : on ne paie que pour ses propres opérations.
    if match and current_user.id not in (match.tenant_id, match.listing.landlord_id):
        return jsonify({"error": "Cette mise en relation ne vous concerne pas"}), 403
    if listing and listing.landlord_id != current_user.id:
        return jsonify({"error": "Cette annonce ne vous appartient pas"}), 403
    # Les frais de mise en relation reviennent au bailleur (D1) : l'autre
    # partie de la candidature ne peut pas les régler à sa place.
    # Certification et mise en avant sont déjà réservées au propriétaire de
    # l'annonce, l'abonnement au locataire.
    if (type_paiement == FRAIS_MISE_EN_RELATION and match
            and current_user.id != match.listing.landlord_id):
        return jsonify({"error": "Les frais de mise en relation sont réglés par "
                                 "le propriétaire de l'annonce"}), 403

    montant, description, erreur = _montant_attendu(type_paiement, current_user, match, listing)
    if erreur:
        return jsonify({"error": erreur}), 400

    # Callback perdu, réseau coupé : le client a peut-être déjà payé ce
    # service. On le revérifie avant de lui faire payer une seconde fois.
    match_id = match.id if match else None
    listing_id = listing.id if listing else (match.listing_id if match else None)
    user_id = current_user.id
    confirme, en_cours = _reprendre_paiement_en_attente(type_paiement, user_id, match_id,
                                                        listing_id)
    if confirme:
        # Vaut aussi pour la mise en avant : le client vient d'être débité, il
        # doit le voir avant de décider d'en racheter une.
        return jsonify({
            "error": "Votre paiement précédent pour ce service vient d'être confirmé.",
            "paiement": confirme.to_dict(),
        }), 409
    if en_cours:
        return jsonify({
            "error": "Un paiement pour ce service attend encore la confirmation de "
                     "l'opérateur. Ouvrez son reçu pour le vérifier avant d'en refaire un.",
            "paiement": en_cours.to_dict(),
        }), 409
    # Les vérifications ont pu clore la transaction : on relit les objets.
    current_user = db.session.get(User, user_id)
    match = db.session.get(Match, match_id) if match_id else None
    listing = db.session.get(Listing, corps.listing_id) if corps.listing_id else None

    if _service_deja_regle(type_paiement, user_id, match_id,
                           listing or (match.listing if match else None)):
        return jsonify({"error": "Ce service est déjà réglé"}), 409
    if not montant or montant <= 0:
        return jsonify({"error": "Montant à payer indéterminé"}), 400

    # La devise n'est jamais choisie par le client : celle de l'annonce, ou,
    # pour un service sans annonce (abonnement Passeport), celle des tarifs.
    devise = (match.listing.devise if match and match.listing
              else listing.devise if listing
              else DEVISE_TARIFS)

    # Les tarifs fixes n'existent qu'en GNF : appliqués à une annonce dans une
    # autre devise, ils factureraient 250 000 XOF au lieu de 250 000 GNF.
    if type_paiement in TARIFS_GNF and devise != DEVISE_TARIFS:
        return jsonify({"error": f"Ce service n'est proposé qu'en {DEVISE_TARIFS} pour le moment"}), 400

    transaction_id = uuid.uuid4().hex[:20].upper()

    paiement = Payment(
        user_id=current_user.id,
        match_id=match_id,
        listing_id=listing_id,
        reference=_reference(),
        type_paiement=type_paiement,
        description=description,
        montant=montant,
        devise=devise,
        methode=methode,
        cinetpay_transaction_id=transaction_id,
        statut="pending",
    )
    db.session.add(paiement)
    db.session.commit()

    if not current_app.config.get("CINETPAY_API_KEY"):
        # Sans clé configurée, on renvoie le paiement en attente plutôt que
        # d'échouer : le parcours reste testable en développement.
        return jsonify({
            "message": "Paiement enregistré. Passerelle Mobile Money non configurée.",
            "paiement": paiement.to_dict(),
            "payment_url": None,
            "mode": "hors_ligne",
        }), 200

    payload = {
        "apikey":         current_app.config["CINETPAY_API_KEY"],
        "site_id":        current_app.config["CINETPAY_SITE_ID"],
        "transaction_id": transaction_id,
        "amount":         montant,
        "currency":       devise,
        "description":    description[:255],
        "notify_url":     current_app.config["CINETPAY_NOTIFY_URL"],
        "return_url":     current_app.config["CINETPAY_RETURN_URL"],
        "customer_name":  current_user.full_name,
        "customer_email": current_user.email,
        "customer_phone_number": current_user.phone or "",
        "channels":       "ALL",
        "lang":           (current_user.preferred_lang or "fr").upper(),
        "metadata":       paiement.id,
    }

    try:
        reponse = requests.post(CINETPAY_INIT_URL, json=payload, timeout=15)
        resultat = reponse.json()
    except requests.RequestException as exc:
        current_app.logger.error("CinetPay injoignable : %s", exc)
        return jsonify({"error": "Service de paiement momentanément indisponible"}), 503
    except ValueError:
        current_app.logger.error("Réponse CinetPay illisible")
        return jsonify({"error": "Réponse invalide du service de paiement"}), 502

    if str(resultat.get("code")) != "201":
        current_app.logger.error("CinetPay a refusé l'initiation : %s", resultat)
        return jsonify({"error": "Le paiement n'a pas pu être initié",
                        "details": resultat.get("description")}), 400

    paiement.cinetpay_token = resultat["data"]["payment_token"]
    db.session.commit()

    return jsonify({
        "message":        "Paiement initié",
        "payment_url":    resultat["data"]["payment_url"],
        "transaction_id": transaction_id,
        "paiement":       paiement.to_dict(),
    }), 200


# ─── POST /api/payments/callback ─────────────────────────────

# Chaque appel déclenche une vérification sortante (jusqu'à 15 s) sur un
# serveur à deux workers : sans plafond, un rejeu massif le bloquerait.
# Large pour ne pas gêner les relances légitimes de CinetPay.
LIMITE_CALLBACK = "60 per minute"
LIMITE_VERIFICATION = "10 per minute"


@payments_bp.route("/callback", methods=["POST"])
@limiter.limit(LIMITE_CALLBACK)
@valider_corps(CallbackCinetPay, source="json_ou_form")
def cinetpay_callback(corps):
    """Webhook CinetPay.

    Le statut n'est jamais lu depuis le corps de la requête : on rappelle
    CinetPay pour le vérifier, sinon n'importe qui pourrait valider un paiement.
    """
    transaction_id = corps.cpm_trans_id

    paiement = Payment.query.filter_by(cinetpay_transaction_id=transaction_id).first()
    if not paiement:
        current_app.logger.warning("Callback pour une transaction inconnue : %s", transaction_id)
        return jsonify({"message": "Transaction inconnue"}), 200

    if paiement.statut != "pending":
        return jsonify({"message": "Déjà traité"}), 200

    paiement_id = paiement.id
    # Ne pas garder une transaction ouverte pendant l'appel sortant.
    db.session.rollback()
    issue, donnees = _verifier_aupres_de_cinetpay(transaction_id)
    _appliquer_verification(paiement_id, issue, donnees)

    return jsonify({"message": "OK"}), 200


def _verifier_aupres_de_cinetpay(transaction_id):
    """Interroge CinetPay pour connaître le statut réel de la transaction.

    Renvoie `(issue, donnees)` : `issue` vaut ACCEPTE, REFUSE ou INCONNU,
    `donnees` est le bloc `data` de la réponse (montant, devise…), à contrôler
    contre le paiement avant tout succès.
    """
    if not current_app.config.get("CINETPAY_API_KEY"):
        return INCONNU, {}
    try:
        reponse = requests.post(CINETPAY_CHECK_URL, json={
            "apikey":         current_app.config["CINETPAY_API_KEY"],
            "site_id":        current_app.config["CINETPAY_SITE_ID"],
            "transaction_id": transaction_id,
        }, timeout=15)
        resultat = reponse.json()
    except (requests.RequestException, ValueError) as exc:
        current_app.logger.error("Vérification CinetPay impossible (%s) : %s", transaction_id, exc)
        return INCONNU, {}

    donnees = resultat.get("data") if isinstance(resultat, dict) else None
    if not isinstance(donnees, dict):
        current_app.logger.error("Réponse CinetPay inexploitable (%s) : %r", transaction_id, resultat)
        return INCONNU, {}

    statut = donnees.get("status")
    if str(resultat.get("code")) == "00" and statut == "ACCEPTED":
        return ACCEPTE, donnees
    # Seul un refus explicite clôt le paiement. Tout autre statut (attente du
    # client, code inattendu) laisse la porte ouverte à un succès ultérieur.
    if statut == "REFUSED":
        return REFUSE, donnees
    current_app.logger.info("Transaction CinetPay %s non conclue : %s", transaction_id, resultat)
    return INCONNU, donnees


def _montant_conforme(paiement, donnees):
    """Le montant et la devise encaissés sont-ils ceux du paiement ?

    Un statut ACCEPTED ne suffit pas : il faut que CinetPay ait encaissé ce
    que Tcheyna a facturé, pas un montant modifié en cours de route.
    """
    try:
        montant = Decimal(str(donnees.get("amount")))
    except InvalidOperation:
        montant = None
    if montant is not None and not montant.is_finite():
        montant = None  # « NaN » ou « Infinity » renvoyés tels quels
    devise = str(donnees.get("currency") or "").strip().upper()
    if montant == paiement.montant and devise == (paiement.devise or "").upper():
        return True
    current_app.logger.error(
        "Paiement %s accepté par CinetPay avec un écart : attendu %s %s, reçu %r %r",
        paiement.id, paiement.montant, paiement.devise,
        donnees.get("amount"), donnees.get("currency"),
    )
    return False


def _requete_verrouillee(payment_id):
    """Relecture du paiement sous verrou de ligne (`SELECT … FOR UPDATE`).

    `populate_existing` force la relecture même si l'objet est déjà dans la
    session : sans elle, on lirait le statut d'avant l'attente du verrou.
    """
    return (select(Payment).where(Payment.id == payment_id)
            .with_for_update().execution_options(populate_existing=True))


def _appliquer_verification(payment_id, issue, donnees):
    """Applique une vérification CinetPay, une seule fois par paiement.

    Le callback et « vérifier » peuvent arriver en même temps : chacun relit
    le paiement sous verrou et n'agit que s'il est encore en attente. Le
    second attend que le premier ait validé, puis ne trouve plus rien à faire,
    sans quoi la mise en avant serait prolongée deux fois et la notification
    envoyée en double. L'appel réseau a lieu avant, hors du verrou.
    """
    paiement = db.session.execute(_requete_verrouillee(payment_id)).scalar_one()
    if paiement.statut == "pending":
        if issue == REFUSE:
            paiement.statut = "failed"
        elif issue == ACCEPTE:
            motif = _motif_remboursement(paiement)
            if motif:
                # Argent reçu qu'on ne doit pas garder, montant conforme ou non.
                _marquer_a_rembourser(paiement, motif)
            elif _montant_conforme(paiement, donnees):
                _confirmer(paiement)
    db.session.commit()
    return paiement


def _verrouiller_service(paiement):
    """Verrouille la ligne qui porte le service payé (match, annonce ou
    compte) : deux paiements distincts du même service confirmés en même temps
    se sérialisent, et le second se voit en doublon."""
    if paiement.type_paiement in SERVICES_PAR_CANDIDATURE and paiement.match_id:
        # L'annonce d'abord, comme les routes de candidature et d'annonce
        # (ordre des verrous, voir `matches._requete_candidature_verrouillee`) :
        # son type de transaction ne change pas pendant la confirmation.
        candidature = db.session.get(Match, paiement.match_id)
        if candidature is not None:
            db.session.execute(
                select(Listing).where(Listing.id == candidature.listing_id)
                .with_for_update().execution_options(populate_existing=True))
        modele, cle = Match, paiement.match_id
    elif paiement.type_paiement in ("certification", "mise_en_avant") and paiement.listing_id:
        modele, cle = Listing, paiement.listing_id
    else:
        modele, cle = User, paiement.user_id
    # FOR NO KEY UPDATE : sérialise les confirmations sans bloquer les
    # insertions qui référencent la ligne (notifications, paiements).
    return db.session.execute(
        select(modele).where(modele.id == cle)
        .with_for_update(key_share=True).execution_options(populate_existing=True)
    ).scalar_one_or_none()


MOTIF_CANDIDATURE_CLOSE = "candidature_close"


def _motif_remboursement(paiement):
    """Raison de ne pas confirmer un paiement accepté par CinetPay, ou None."""
    if paiement.type_paiement in PAIEMENTS_HORS_PLATEFORME:
        return "hors_plateforme"
    objet = _verrouiller_service(paiement)
    annonce = objet if isinstance(objet, Listing) else paiement.listing
    if _service_deja_regle(paiement.type_paiement, paiement.user_id, paiement.match_id,
                           annonce, exclure_id=paiement.id):
        return "doublon"
    # Candidature retirée, refusée ou close pendant le paiement : les frais
    # n'ouvrent plus aucune mise en relation, l'argent est rendu.
    if (paiement.type_paiement == FRAIS_MISE_EN_RELATION
            and (not isinstance(objet, Match) or objet.status != CANDIDATURE_EN_ATTENTE)):
        return MOTIF_CANDIDATURE_CLOSE
    return None


def _marquer_a_rembourser(paiement, motif):
    paiement.statut = A_REMBOURSER
    current_app.logger.warning("Paiement %s (%s) encaissé mais à rembourser : %s",
                               paiement.id, paiement.type_paiement, motif)
    notify.paiement_a_rembourser(paiement, motif,
                                 [u.id for u in User.query.filter_by(role="admin").all()])


def _confirmer(paiement):
    """Passe le paiement en succès et déclenche l'effet métier associé."""
    paiement.statut = "success"
    paiement.paid_at = datetime.utcnow()

    if paiement.type_paiement == "certification" and paiement.listing:
        # Le paiement déclenche l'examen, pas la certification elle-même :
        # un vérificateur doit toujours contrôler les documents.
        if paiement.listing.certification_status != "certified":
            paiement.listing.certification_status = "pending"
            paiement.listing.certification_requested_at = datetime.utcnow()

    elif paiement.type_paiement == "mise_en_avant" and paiement.listing_id:
        # Deux mises en avant distinctes de la même annonce peuvent être
        # confirmées en même temps : le verrou du paiement ne les sépare pas.
        # On relit donc l'annonce sous verrou, sinon une prolongation se perd.
        annonce = db.session.execute(
            select(Listing).where(Listing.id == paiement.listing_id)
            .with_for_update().execution_options(populate_existing=True)
        ).scalar_one()
        base = max(annonce.premium_until or datetime.utcnow(), datetime.utcnow())
        annonce.is_premium = True
        annonce.premium_until = base + DUREE_MISE_EN_AVANT

    elif paiement.type_paiement == FRAIS_MISE_EN_RELATION and paiement.match:
        # D1 : l'acceptation demandée par le bailleur prend effet maintenant,
        # et avec elle la messagerie, l'adresse et la notification du
        # locataire. La candidature, verrouillée par `_verrouiller_service`,
        # est encore en attente (`_motif_remboursement`).
        from app.routes.matches import accepter_candidature
        accepter_candidature(paiement.match)

    notify.paiement_confirme(
        paiement.user_id, paiement.montant, paiement.devise,
        PAYMENT_TYPES.get(paiement.type_paiement, "Paiement"), paiement.id,
    )


# ─── GET /api/payments/mes-paiements ─────────────────────────

@payments_bp.route("/mes-paiements", methods=["GET"])
@current_user_required
def mes_paiements(current_user):
    query = Payment.query.filter_by(user_id=current_user.id)
    if statut := request.args.get("statut"):
        query = query.filter_by(statut=statut)

    paiements = query.order_by(Payment.created_at.desc()).all()
    reussis = [p for p in paiements if p.statut == "success"]

    return jsonify({
        "paiements": [p.to_dict() for p in paiements],
        "total": len(paiements),
        "total_paye": sum(p.montant for p in reussis),
        "devise": paiements[0].devise if paiements else "GNF",
    }), 200


# ─── GET /api/payments/<id> ──────────────────────────────────

@payments_bp.route("/<string:payment_id>", methods=["GET"])
@current_user_required
def recu(current_user, payment_id):
    """Reçu numérique — accessible au payeur, à l'autre partie et à l'admin."""
    paiement = Payment.query.get_or_404(payment_id)

    autorise = paiement.user_id == current_user.id or current_user.role == "admin"
    if not autorise and paiement.match:
        autorise = current_user.id in (paiement.match.tenant_id,
                                       paiement.match.listing.landlord_id)
    if not autorise:
        return jsonify({"error": "Non autorisé"}), 403

    return jsonify({
        **paiement.to_dict(),
        "payeur": paiement.user.to_dict() if paiement.user else None,
        "listing": (paiement.listing.to_dict(
                        include_landlord=False,
                        avec_adresse=peut_voir_adresse(current_user, paiement.listing,
                                                       candidature=paiement.match))
                    if paiement.listing else None),
    }), 200


# ─── POST /api/payments/<id>/verifier ────────────────────────

@payments_bp.route("/<string:payment_id>/verifier", methods=["POST"])
@limiter.limit(LIMITE_VERIFICATION)
@current_user_required
def verifier_paiement(current_user, payment_id):
    """Re-vérifie un paiement resté en attente (retour utilisateur sur le site)."""
    paiement = Payment.query.get_or_404(payment_id)
    if paiement.user_id != current_user.id:
        return jsonify({"error": "Non autorisé"}), 403

    if paiement.statut != "pending":
        return jsonify({"message": "Paiement déjà traité", "paiement": paiement.to_dict()}), 200

    paiement_id, transaction_id = paiement.id, paiement.cinetpay_transaction_id
    db.session.rollback()
    issue, donnees = _verifier_aupres_de_cinetpay(transaction_id)
    paiement = _appliquer_verification(paiement_id, issue, donnees)

    messages = {"success": "Paiement confirmé", "failed": "Paiement refusé",
                A_REMBOURSER: "Paiement reçu mais non dû : il vous sera remboursé"}
    return jsonify({
        "message": messages.get(paiement.statut, "Paiement toujours en attente"),
        "paiement": paiement.to_dict(),
    }), 200
