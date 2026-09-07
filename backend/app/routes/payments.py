"""
routes/payments.py — Paiements Mobile Money via CinetPay.

Couvre les cinq flux du modèle économique : caution et premier loyer (payés par
le locataire), commission de mise en relation, certification d'annonce et mise
en avant (payées par le propriétaire), abonnement Passeport (locataire).

Chaque paiement réussi produit un reçu numérique consultable par les deux
parties — la traçabilité promise dans le business plan.
"""
import uuid
from datetime import datetime, timedelta

import requests
from flask import Blueprint, current_app, jsonify, request

from app import db
from app.models import (
    COMMISSION_RATE,
    PAYMENT_TYPES,
    Listing,
    Match,
    Payment,
)
from app.routes import current_user_required
from app.services import notifications as notify

payments_bp = Blueprint("payments", __name__)

CINETPAY_INIT_URL = "https://api-checkout.cinetpay.com/v2/payment"
CINETPAY_CHECK_URL = "https://api-checkout.cinetpay.com/v2/payment/check"

METHODES = ("orange_money", "mtn_momo", "wave", "moov", "carte")

# Tarifs des services Tcheyna, en GNF (base : Conakry)
TARIFS_GNF = {
    "certification":        250_000,
    "abonnement_passeport": 150_000,
    "mise_en_avant":        200_000,
}
DUREE_MISE_EN_AVANT = timedelta(days=30)


def _reference():
    """Référence de reçu lisible : TCH-XXXXXXXX."""
    return f"TCH-{uuid.uuid4().hex[:8].upper()}"


def _montant_attendu(type_paiement, user, match, listing):
    """Détermine le montant à payer et son libellé.

    Le montant vient toujours du serveur : le client ne choisit jamais combien
    il paie, sauf pour les paiements libres entre parties.
    """
    if type_paiement == "caution":
        if not match or not match.listing:
            return None, None, "Un match accepté est requis pour payer la caution"
        montant = match.listing.caution or match.listing.prix
        return montant, f"Caution — {match.listing.title_fr}", None

    if type_paiement == "premier_loyer":
        if not match or not match.listing:
            return None, None, "Un match accepté est requis pour payer le loyer"
        montant = (match.listing.prix or 0) + (match.listing.charges or 0)
        return montant, f"Premier loyer — {match.listing.title_fr}", None

    if type_paiement == "commission":
        if not match or not match.listing:
            return None, None, "Un match conclu est requis pour la commission"
        montant = int((match.listing.prix or 0) * COMMISSION_RATE)
        return montant, f"Commission Tcheyna — {match.listing.title_fr}", None

    if type_paiement == "certification":
        if not listing:
            return None, None, "listing_id requis pour une certification"
        return TARIFS_GNF["certification"], f"Certification — {listing.title_fr}", None

    if type_paiement == "mise_en_avant":
        if not listing:
            return None, None, "listing_id requis pour une mise en avant"
        return TARIFS_GNF["mise_en_avant"], f"Mise en avant 30 jours — {listing.title_fr}", None

    if type_paiement == "abonnement_passeport":
        return TARIFS_GNF["abonnement_passeport"], "Abonnement Passeport Locataire (1 an)", None

    return None, None, f"Type de paiement inconnu : {type_paiement}"


# ─── GET /api/payments/tarifs ────────────────────────────────

@payments_bp.route("/tarifs", methods=["GET"])
def tarifs():
    """Grille tarifaire publique."""
    return jsonify({
        "devise": "GNF",
        "services": [
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
        "commission": {
            "taux": COMMISSION_RATE,
            "libelle": "Commission de mise en relation",
            "payeur": "Propriétaire",
            "description": f"{int(COMMISSION_RATE * 100)} % du premier loyer, "
                           "prélevés lors d'une location conclue via Tcheyna",
        },
    }), 200


# ─── POST /api/payments/initier ──────────────────────────────

@payments_bp.route("/initier", methods=["POST"])
@current_user_required
def initier_paiement(current_user):
    data = request.get_json() or {}

    type_paiement = data.get("type_paiement", "caution")
    if type_paiement not in PAYMENT_TYPES:
        return jsonify({"error": f"Type invalide : {' | '.join(PAYMENT_TYPES)}"}), 400

    methode = data.get("methode")
    if methode and methode not in METHODES:
        return jsonify({"error": f"Méthode invalide : {' | '.join(METHODES)}"}), 400

    match = Match.query.get(data["match_id"]) if data.get("match_id") else None
    listing = Listing.query.get(data["listing_id"]) if data.get("listing_id") else None

    # Contrôles d'accès : on ne paie que pour ses propres opérations.
    if match and current_user.id not in (match.tenant_id, match.listing.landlord_id):
        return jsonify({"error": "Cette mise en relation ne vous concerne pas"}), 403
    if listing and listing.landlord_id != current_user.id:
        return jsonify({"error": "Cette annonce ne vous appartient pas"}), 403

    montant, description, erreur = _montant_attendu(type_paiement, current_user, match, listing)
    if erreur:
        return jsonify({"error": erreur}), 400
    if not montant or montant <= 0:
        return jsonify({"error": "Montant à payer indéterminé"}), 400

    devise = (match.listing.devise if match and match.listing
              else listing.devise if listing
              else data.get("devise", "GNF"))

    transaction_id = uuid.uuid4().hex[:20].upper()

    paiement = Payment(
        user_id=current_user.id,
        match_id=match.id if match else None,
        listing_id=listing.id if listing else (match.listing_id if match else None),
        reference=_reference(),
        type_paiement=type_paiement,
        description=description,
        montant=montant,
        commission=int(montant * COMMISSION_RATE) if type_paiement == "premier_loyer" else 0,
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

@payments_bp.route("/callback", methods=["POST"])
def cinetpay_callback():
    """Webhook CinetPay.

    Le statut n'est jamais lu depuis le corps de la requête : on rappelle
    CinetPay pour le vérifier, sinon n'importe qui pourrait valider un paiement.
    """
    data = request.get_json(silent=True) or request.form
    transaction_id = data.get("cpm_trans_id")

    if not transaction_id:
        return jsonify({"error": "cpm_trans_id manquant"}), 400

    paiement = Payment.query.filter_by(cinetpay_transaction_id=transaction_id).first()
    if not paiement:
        current_app.logger.warning("Callback pour une transaction inconnue : %s", transaction_id)
        return jsonify({"message": "Transaction inconnue"}), 200

    if paiement.statut == "success":
        return jsonify({"message": "Déjà traité"}), 200

    reussi = _verifier_aupres_de_cinetpay(transaction_id)
    _appliquer_resultat(paiement, reussi)
    db.session.commit()

    return jsonify({"message": "OK"}), 200


def _verifier_aupres_de_cinetpay(transaction_id):
    """Interroge CinetPay pour connaître le statut réel de la transaction."""
    if not current_app.config.get("CINETPAY_API_KEY"):
        return False
    try:
        reponse = requests.post(CINETPAY_CHECK_URL, json={
            "apikey":         current_app.config["CINETPAY_API_KEY"],
            "site_id":        current_app.config["CINETPAY_SITE_ID"],
            "transaction_id": transaction_id,
        }, timeout=15)
        resultat = reponse.json()
        return (str(resultat.get("code")) == "00"
                and resultat.get("data", {}).get("status") == "ACCEPTED")
    except (requests.RequestException, ValueError) as exc:
        current_app.logger.error("Vérification CinetPay impossible : %s", exc)
        return False


def _appliquer_resultat(paiement, reussi):
    """Met à jour le paiement et déclenche l'effet métier associé."""
    if not reussi:
        paiement.statut = "failed"
        return

    paiement.statut = "success"
    paiement.paid_at = datetime.utcnow()

    if paiement.type_paiement == "certification" and paiement.listing:
        # Le paiement déclenche l'examen, pas la certification elle-même :
        # un vérificateur doit toujours contrôler les documents.
        if paiement.listing.certification_status != "certified":
            paiement.listing.certification_status = "pending"
            paiement.listing.certification_requested_at = datetime.utcnow()

    elif paiement.type_paiement == "mise_en_avant" and paiement.listing:
        base = max(paiement.listing.premium_until or datetime.utcnow(), datetime.utcnow())
        paiement.listing.is_premium = True
        paiement.listing.premium_until = base + DUREE_MISE_EN_AVANT

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
        "listing": (paiement.listing.to_dict(include_landlord=False)
                    if paiement.listing else None),
    }), 200


# ─── POST /api/payments/<id>/verifier ────────────────────────

@payments_bp.route("/<string:payment_id>/verifier", methods=["POST"])
@current_user_required
def verifier_paiement(current_user, payment_id):
    """Re-vérifie un paiement resté en attente (retour utilisateur sur le site)."""
    paiement = Payment.query.get_or_404(payment_id)
    if paiement.user_id != current_user.id:
        return jsonify({"error": "Non autorisé"}), 403

    if paiement.statut != "pending":
        return jsonify({"message": "Paiement déjà traité", "paiement": paiement.to_dict()}), 200

    reussi = _verifier_aupres_de_cinetpay(paiement.cinetpay_transaction_id)
    if reussi:
        _appliquer_resultat(paiement, True)
        db.session.commit()

    return jsonify({
        "message": "Paiement confirmé" if reussi else "Paiement toujours en attente",
        "paiement": paiement.to_dict(),
    }), 200
