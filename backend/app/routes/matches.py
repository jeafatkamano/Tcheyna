"""
routes/matches.py — Mise en relation bidirectionnelle.

Cycle de vie : le locataire candidate (`pending`) → le propriétaire accepte
(`accepted`, ce qui ouvre la messagerie) ou refuse (`rejected`) → la location est
conclue (`completed`, ce qui ouvre les avis croisés).
"""
from datetime import datetime

from flask import Blueprint, jsonify, request

from app import db
from app.models import Conversation, Listing, Match, User
from app.routes import current_user_required, role_required
from app.services import notifications as notify
from app.services.matching import score_compatibilite

matches_bp = Blueprint("matches", __name__)

# Un locataire doit être au moins « Basique » (téléphone vérifié) pour candidater,
# et « Identifié » (CNI validée) pour candidater à une annonce certifiée.
NIVEAU_MIN_CANDIDATURE = 1
NIVEAU_MIN_ANNONCE_CERTIFIEE = 2


# ─── POST /api/matches ───────────────────────────────────────

@matches_bp.route("/", methods=["POST"])
@role_required("tenant")
def create_match(current_user):
    data = request.get_json() or {}
    listing_id = data.get("listing_id")
    if not listing_id:
        return jsonify({"error": "listing_id requis"}), 400

    niveau = current_user.trust_level or 0
    if niveau < NIVEAU_MIN_CANDIDATURE:
        return jsonify({
            "error": "Vérifiez votre numéro de téléphone pour pouvoir candidater",
            "action_requise": "verifier_telephone",
        }), 403

    listing = Listing.query.get_or_404(listing_id)

    if listing.status != "active" or not listing.is_visible:
        return jsonify({"error": "Cette annonce n'est plus disponible"}), 400

    if listing.landlord_id == current_user.id:
        return jsonify({"error": "Vous ne pouvez pas candidater à votre propre annonce"}), 400

    if listing.is_certified and niveau < NIVEAU_MIN_ANNONCE_CERTIFIEE:
        return jsonify({
            "error": "Les annonces certifiées demandent une identité vérifiée (niveau 2)",
            "action_requise": "verifier_identite",
        }), 403

    if Match.query.filter_by(tenant_id=current_user.id, listing_id=listing_id).first():
        return jsonify({"error": "Vous avez déjà candidaté pour cette annonce"}), 409

    score, _ = score_compatibilite(current_user.passport, listing, current_user)

    match = Match(
        tenant_id=current_user.id,
        listing_id=listing_id,
        message=(data.get("message") or "").strip() or None,
        score_compatibilite=score,
    )
    db.session.add(match)

    notify.nouvelle_candidature(
        listing.landlord_id, current_user.full_name, listing.title_fr, match.id
    )
    db.session.commit()

    return jsonify({"message": "Candidature envoyée", "match": match.to_dict()}), 201


# ─── GET /api/matches/mes-candidatures ───────────────────────

@matches_bp.route("/mes-candidatures", methods=["GET"])
@role_required("tenant")
def mes_candidatures(current_user):
    """Côté locataire : le suivi de ses candidatures."""
    lang = request.args.get("lang", "fr")
    query = Match.query.filter_by(tenant_id=current_user.id)
    if statut := request.args.get("statut"):
        query = query.filter_by(status=statut)

    matches = query.order_by(Match.created_at.desc()).all()

    return jsonify({
        "matches": [m.to_dict(lang=lang) for m in matches],
        "stats": {
            "total":     len(matches),
            "en_attente": sum(1 for m in matches if m.status == "pending"),
            "acceptees":  sum(1 for m in matches if m.status == "accepted"),
            "refusees":   sum(1 for m in matches if m.status == "rejected"),
            "conclues":   sum(1 for m in matches if m.status == "completed"),
        },
    }), 200


# ─── GET /api/matches/mes-demandes ───────────────────────────

@matches_bp.route("/mes-demandes", methods=["GET"])
@role_required("landlord", "agency")
def mes_demandes(current_user):
    """Côté propriétaire : les candidatures reçues, les meilleurs dossiers d'abord."""
    lang = request.args.get("lang", "fr")
    listing_ids = [l.id for l in current_user.listings]
    if not listing_ids:
        return jsonify({"matches": [], "stats": {"total": 0, "en_attente": 0,
                                                 "acceptees": 0, "conclues": 0}}), 200

    query = Match.query.filter(Match.listing_id.in_(listing_ids))
    if statut := request.args.get("statut"):
        query = query.filter(Match.status == statut)
    if listing_id := request.args.get("listing_id"):
        query = query.filter(Match.listing_id == listing_id)

    matches = query.order_by(Match.created_at.desc()).all()

    resultats = []
    for match in matches:
        data = match.to_dict(lang=lang)
        # Le propriétaire voit le dossier du candidat, sans ses données bancaires
        data["passeport"] = (match.tenant.passport.to_dict(public=True)
                             if match.tenant and match.tenant.passport else None)
        resultats.append(data)

    resultats.sort(
        key=lambda d: (d.get("score_compatibilite") or 0,
                       (d.get("passeport") or {}).get("score", 0)),
        reverse=True,
    )

    return jsonify({
        "matches": resultats,
        "stats": {
            "total":      len(matches),
            "en_attente": sum(1 for m in matches if m.status == "pending"),
            "acceptees":  sum(1 for m in matches if m.status == "accepted"),
            "conclues":   sum(1 for m in matches if m.status == "completed"),
        },
    }), 200


# ─── GET /api/matches/candidats-suggeres ─────────────────────

@matches_bp.route("/candidats-suggeres", methods=["GET"])
@role_required("landlord", "agency")
def candidats_suggeres(current_user):
    """Locataires vérifiés dont le profil correspond à une annonce donnée.

    C'est la face « propriétaire » du matching : au lieu d'attendre des
    candidatures, le bailleur voit qui, dans la base vérifiée, cherche
    exactement son bien.
    """
    listing_id = request.args.get("listing_id")
    if not listing_id:
        return jsonify({"error": "listing_id requis"}), 400

    listing = Listing.query.get_or_404(listing_id)
    if listing.landlord_id != current_user.id:
        return jsonify({"error": "Cette annonce ne vous appartient pas"}), 403

    limite = min(request.args.get("limite", 10, type=int), 30)
    deja_candidats = {m.tenant_id for m in listing.matches}

    # On ne suggère que des locataires ayant au moins le téléphone vérifié.
    locataires = (User.query
                  .filter(User.role == "tenant",
                          User.is_active.is_(True),
                          User.trust_level >= NIVEAU_MIN_CANDIDATURE)
                  .limit(200).all())

    suggestions = []
    for locataire in locataires:
        if locataire.id in deja_candidats:
            continue
        score, details = score_compatibilite(locataire.passport, listing, locataire)
        if score < 50:  # en dessous, la suggestion ferait perdre du temps
            continue
        suggestions.append({
            "tenant": locataire.to_dict(),
            "passeport": locataire.passport.to_dict(public=True) if locataire.passport else None,
            "score_compatibilite": score,
            "details_compatibilite": details,
        })

    suggestions.sort(key=lambda s: s["score_compatibilite"], reverse=True)

    return jsonify({"candidats": suggestions[:limite], "total": len(suggestions)}), 200


# ─── GET /api/matches/<id> ───────────────────────────────────

@matches_bp.route("/<string:match_id>", methods=["GET"])
@current_user_required
def get_match(current_user, match_id):
    match = Match.query.get_or_404(match_id)

    est_locataire = match.tenant_id == current_user.id
    est_bailleur = match.listing and match.listing.landlord_id == current_user.id
    if not (est_locataire or est_bailleur or current_user.role == "admin"):
        return jsonify({"error": "Non autorisé"}), 403

    data = match.to_dict(lang=request.args.get("lang", "fr"))
    if match.tenant and match.tenant.passport:
        # Le locataire voit son passeport complet, le bailleur la version publique
        data["passeport"] = match.tenant.passport.to_dict(public=not est_locataire)
    return jsonify(data), 200


# ─── PUT /api/matches/<id>/statut ────────────────────────────

@matches_bp.route("/<string:match_id>/statut", methods=["PUT"])
@role_required("landlord", "agency")
def update_match_status(current_user, match_id):
    """Le propriétaire accepte ou refuse une candidature.

    Une acceptation ouvre la conversation privée entre les deux parties.
    """
    match = Match.query.get_or_404(match_id)
    if not match.listing or match.listing.landlord_id != current_user.id:
        return jsonify({"error": "Non autorisé"}), 403

    statut = (request.get_json() or {}).get("statut")
    if statut not in ("accepted", "rejected"):
        return jsonify({"error": "Statut invalide : accepted | rejected"}), 400

    if match.status not in ("pending", "accepted"):
        return jsonify({"error": f"Candidature déjà « {match.status} »"}), 409

    match.status = statut

    if statut == "accepted" and not match.conversation:
        conversation = Conversation(
            match_id=match.id,
            tenant_id=match.tenant_id,
            landlord_id=current_user.id,
        )
        db.session.add(conversation)

    notify.candidature_traitee(
        match.tenant_id, statut == "accepted", match.listing.title_fr, match.id
    )
    db.session.commit()

    return jsonify({
        "message": "Candidature acceptée — la messagerie est ouverte"
                   if statut == "accepted" else "Candidature refusée",
        "match": match.to_dict(),
    }), 200


# ─── PUT /api/matches/<id>/visite ────────────────────────────

@matches_bp.route("/<string:match_id>/visite", methods=["PUT"])
@current_user_required
def planifier_visite(current_user, match_id):
    """Fixe la date de visite. Les deux parties peuvent la proposer."""
    match = Match.query.get_or_404(match_id)

    autorise = (match.tenant_id == current_user.id
                or (match.listing and match.listing.landlord_id == current_user.id))
    if not autorise:
        return jsonify({"error": "Non autorisé"}), 403

    if match.status != "accepted":
        return jsonify({"error": "La candidature doit être acceptée avant de planifier une visite"}), 400

    date_str = (request.get_json() or {}).get("visite_date")
    if not date_str:
        return jsonify({"error": "visite_date requis (format ISO 8601)"}), 400

    try:
        match.visite_date = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
    except ValueError:
        return jsonify({"error": "Date invalide (format attendu : 2026-09-15T14:30)"}), 400

    autre_id = (match.listing.landlord_id if current_user.id == match.tenant_id
                else match.tenant_id)
    notify.notifier(
        autre_id, "nouveau_message", "Visite planifiée",
        f"{current_user.full_name} propose une visite le "
        f"{match.visite_date.strftime('%d/%m/%Y à %H:%M')}.",
        f"/messages/{match.id}",
    )
    db.session.commit()

    return jsonify({"message": "Visite planifiée", "match": match.to_dict()}), 200


# ─── PUT /api/matches/<id>/conclure ──────────────────────────

@matches_bp.route("/<string:match_id>/conclure", methods=["PUT"])
@role_required("landlord", "agency")
def conclure_location(current_user, match_id):
    """Marque la location comme conclue : l'annonce sort du marché et les deux
    parties peuvent désormais se noter."""
    match = Match.query.get_or_404(match_id)
    if not match.listing or match.listing.landlord_id != current_user.id:
        return jsonify({"error": "Non autorisé"}), 403

    if match.status != "accepted":
        return jsonify({"error": "Seule une candidature acceptée peut être conclue"}), 400

    match.status = "completed"
    match.completed_at = datetime.utcnow()
    match.listing.status = "matched"

    # Les autres candidats sont libérés plutôt que laissés sans réponse.
    autres = Match.query.filter(Match.listing_id == match.listing_id,
                                Match.id != match.id,
                                Match.status.in_(("pending", "accepted"))).all()
    for autre in autres:
        autre.status = "rejected"
        notify.candidature_traitee(autre.tenant_id, False, match.listing.title_fr, autre.id)

    notify.notifier(
        match.tenant_id, "candidature_acceptee", "Location conclue 🎉",
        f"Votre location de « {match.listing.title_fr} » est confirmée. "
        "Vous pouvez maintenant laisser un avis sur le propriétaire.",
        f"/tenant/matches?avis={match.id}",
    )
    db.session.commit()

    return jsonify({
        "message": "Location conclue",
        "match": match.to_dict(),
        "commission": match.commission,
        "devise": match.listing.devise,
    }), 200


# ─── DELETE /api/matches/<id> ────────────────────────────────

@matches_bp.route("/<string:match_id>", methods=["DELETE"])
@role_required("tenant")
def retirer_candidature(current_user, match_id):
    match = Match.query.get_or_404(match_id)
    if match.tenant_id != current_user.id:
        return jsonify({"error": "Non autorisé"}), 403

    if match.status == "completed":
        return jsonify({"error": "Une location conclue ne peut pas être retirée"}), 400

    match.status = "cancelled"
    db.session.commit()
    return jsonify({"message": "Candidature retirée"}), 200
