"""routes/users.py — Profil public et édition du compte."""
from flask import Blueprint, jsonify, request

from app import db
from app.models import Listing, Review, User
from app.routes import current_user_required

users_bp = Blueprint("users", __name__)


# ─── GET /api/users/<id> ─────────────────────────────────────

@users_bp.route("/<string:user_id>", methods=["GET"])
def get_user(user_id):
    """Profil public : niveau de confiance, avis reçus, annonces si bailleur."""
    user = User.query.get_or_404(user_id)
    if not user.is_active:
        return jsonify({"error": "Ce compte n'est plus actif"}), 404

    data = user.to_dict(public=True)

    avis = user.reviews_received.order_by(Review.created_at.desc()).limit(10).all()
    data["avis"] = [r.to_dict() for r in avis]

    if user.role in ("landlord", "agency"):
        annonces = user.listings.filter(Listing.status == "active",
                                        Listing.is_visible.is_(True)).all()
        data["annonces"] = [a.to_dict(include_landlord=False) for a in annonces]
        data["nb_annonces"] = len(annonces)

    if user.role == "tenant" and user.passport:
        data["passeport"] = user.passport.to_dict(public=True)

    return jsonify(data), 200


# ─── PUT /api/users/me ───────────────────────────────────────

@users_bp.route("/me", methods=["PUT"])
@current_user_required
def update_profile(current_user):
    data = request.get_json() or {}

    for champ in ("full_name", "pays", "ville", "quartier",
                  "preferred_lang", "avatar_url", "bio"):
        if champ in data:
            valeur = data[champ]
            setattr(current_user, champ,
                    valeur.strip() if isinstance(valeur, str) else valeur)

    if not current_user.full_name:
        return jsonify({"error": "Le nom complet est requis"}), 400

    db.session.commit()
    return jsonify({"message": "Profil mis à jour",
                    "user": current_user.to_dict(public=False)}), 200


# ─── DELETE /api/users/me ────────────────────────────────────

@users_bp.route("/me", methods=["DELETE"])
@current_user_required
def desactiver_compte(current_user):
    """Désactivation plutôt que suppression : les historiques d'avis et de
    paiements des autres utilisateurs doivent rester intacts."""
    current_user.is_active = False
    for annonce in current_user.listings:
        annonce.is_visible = False
        annonce.status = "closed"

    db.session.commit()
    return jsonify({"message": "Compte désactivé"}), 200
