"""routes/favorites.py — Annonces sauvegardées."""
from flask import Blueprint, jsonify, request
from sqlalchemy.exc import IntegrityError

from app import db
from app.models import Favorite, Listing
from app.routes import current_user_required

favorites_bp = Blueprint("favorites", __name__)


# ─── GET /api/favorites ──────────────────────────────────────

@favorites_bp.route("/", methods=["GET"])
@current_user_required
def liste_favoris(current_user):
    lang = request.args.get("lang", "fr")
    favoris = (current_user.favorites
               .order_by(Favorite.created_at.desc()).all())

    listings = []
    for favori in favoris:
        if not favori.listing or not favori.listing.is_visible:
            continue
        data = favori.listing.to_dict(lang=lang)
        data["is_favorite"] = True
        data["ajoute_le"] = favori.created_at.isoformat()
        listings.append(data)

    return jsonify({"listings": listings, "total": len(listings)}), 200


# ─── POST /api/favorites/<listing_id> ────────────────────────

@favorites_bp.route("/<string:listing_id>", methods=["POST"])
@current_user_required
def ajouter_favori(current_user, listing_id):
    Listing.query.get_or_404(listing_id)

    existant = Favorite.query.filter_by(user_id=current_user.id,
                                        listing_id=listing_id).first()
    if existant:
        return jsonify({"message": "Déjà dans vos favoris", "is_favorite": True}), 200

    db.session.add(Favorite(user_id=current_user.id, listing_id=listing_id))
    try:
        db.session.commit()
    except IntegrityError:
        # Double-clic ou requête concurrente : l'état visé est atteint de toute façon.
        db.session.rollback()
        return jsonify({"message": "Déjà dans vos favoris", "is_favorite": True}), 200

    return jsonify({"message": "Ajouté aux favoris", "is_favorite": True}), 201


# ─── DELETE /api/favorites/<listing_id> ──────────────────────

@favorites_bp.route("/<string:listing_id>", methods=["DELETE"])
@current_user_required
def retirer_favori(current_user, listing_id):
    favori = Favorite.query.filter_by(user_id=current_user.id,
                                      listing_id=listing_id).first()
    if not favori:
        return jsonify({"message": "N'était pas dans vos favoris", "is_favorite": False}), 200

    db.session.delete(favori)
    db.session.commit()
    return jsonify({"message": "Retiré des favoris", "is_favorite": False}), 200
