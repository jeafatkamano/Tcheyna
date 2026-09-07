"""
routes/reviews.py — Avis croisés.

Un avis n'est possible qu'après une location effectivement conclue via la
plateforme : c'est ce qui rend l'historique de réputation crédible, et donc
difficile à répliquer pour un concurrent.
"""
from flask import Blueprint, jsonify, request
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from app import db
from app.models import TRUST_LEVELS, Match, Review, User
from app.routes import current_user_required

reviews_bp = Blueprint("reviews", __name__)


# ─── GET /api/reviews/user/<id> ──────────────────────────────

@reviews_bp.route("/user/<string:user_id>", methods=["GET"])
def get_user_reviews(user_id):
    User.query.get_or_404(user_id)
    reviews = (Review.query.filter_by(target_id=user_id)
               .order_by(Review.created_at.desc()).all())

    moyenne = db.session.query(func.avg(Review.note)).filter_by(target_id=user_id).scalar()
    repartition = {n: 0 for n in range(1, 6)}
    for review in reviews:
        repartition[review.note] = repartition.get(review.note, 0) + 1

    return jsonify({
        "reviews":     [r.to_dict() for r in reviews],
        "moyenne":     round(float(moyenne), 2) if moyenne else 0,
        "total":       len(reviews),
        "positifs":    sum(1 for r in reviews if r.is_positive),
        "repartition": repartition,
    }), 200


# ─── GET /api/reviews/a-donner ───────────────────────────────

@reviews_bp.route("/a-donner", methods=["GET"])
@current_user_required
def avis_a_donner(current_user):
    """Locations conclues pour lesquelles l'appelant n'a pas encore noté l'autre partie."""
    if current_user.role == "tenant":
        matches = Match.query.filter_by(tenant_id=current_user.id, status="completed").all()
    else:
        listing_ids = [l.id for l in current_user.listings]
        matches = (Match.query.filter(Match.listing_id.in_(listing_ids),
                                      Match.status == "completed").all()
                   if listing_ids else [])

    deja_notes = {r.match_id for r in current_user.reviews_given if r.match_id}

    en_attente = []
    for match in matches:
        if match.id in deja_notes:
            continue
        cible = (match.listing.landlord if current_user.role == "tenant" else match.tenant)
        if not cible:
            continue
        en_attente.append({
            "match_id":  match.id,
            "listing":   match.listing.to_dict(include_landlord=False) if match.listing else None,
            "cible":     cible.to_dict(),
            "type_avis": ("tenant_to_landlord" if current_user.role == "tenant"
                          else "landlord_to_tenant"),
            "conclu_le": match.completed_at.isoformat() if match.completed_at else None,
        })

    return jsonify({"a_donner": en_attente, "total": len(en_attente)}), 200


# ─── POST /api/reviews ───────────────────────────────────────

@reviews_bp.route("/", methods=["POST"])
@current_user_required
def create_review(current_user):
    data = request.get_json() or {}

    for champ in ("match_id", "note"):
        if data.get(champ) in (None, ""):
            return jsonify({"error": f"Champ requis : {champ}"}), 400

    try:
        note = int(data["note"])
    except (TypeError, ValueError):
        return jsonify({"error": "La note doit être un nombre"}), 400
    if not 1 <= note <= 5:
        return jsonify({"error": "La note doit être comprise entre 1 et 5"}), 400

    match = Match.query.get_or_404(data["match_id"])
    if match.status != "completed":
        return jsonify({"error": "Vous ne pouvez noter qu'après une location conclue"}), 400

    # L'auteur doit être l'une des deux parties, et note l'autre.
    if match.tenant_id == current_user.id:
        target_id, type_avis = match.listing.landlord_id, "tenant_to_landlord"
    elif match.listing and match.listing.landlord_id == current_user.id:
        target_id, type_avis = match.tenant_id, "landlord_to_tenant"
    else:
        return jsonify({"error": "Vous n'êtes pas partie à cette location"}), 403

    if Review.query.filter_by(reviewer_id=current_user.id, match_id=match.id).first():
        return jsonify({"error": "Vous avez déjà laissé un avis pour cette location"}), 409

    review = Review(
        reviewer_id=current_user.id,
        target_id=target_id,
        match_id=match.id,
        note=note,
        commentaire=(data.get("commentaire") or "").strip() or None,
        type_avis=type_avis,
        is_positive=note >= 4,
    )
    db.session.add(review)
    db.session.flush()

    # Un troisième avis positif fait passer au niveau « Recommandé ».
    from app.services import notifications as notify

    cible = User.query.get(target_id)
    if cible:
        ancien = cible.trust_level or 0
        nouveau = cible.update_trust_level()
        notify.nouvel_avis(cible.id, current_user.full_name, note)
        if nouveau > ancien:
            niveau = TRUST_LEVELS[nouveau]
            notify.niveau_atteint(cible.id, nouveau, niveau["label"], niveau["debloque"])

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "Vous avez déjà laissé un avis pour cette location"}), 409

    return jsonify({"message": "Avis publié", "review": review.to_dict()}), 201
