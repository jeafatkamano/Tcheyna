"""routes/users.py — Profil public, édition du compte et photo de profil."""
from flask import Blueprint, jsonify, request

from app import db
from app.models import Listing, Review, User
from app.routes import current_user_required, utilisateur_optionnel
from app.schemas import valider_corps
from app.schemas.users import MajProfil
from app.services import stockage
from app.services.acces import nom_reduit, passeport_pour, peut_voir_passeport, visibilite_adresse

users_bp = Blueprint("users", __name__)

# Champs retirés du profil public d'un locataire pour qui ne peut pas lire son
# dossier (voir get_user) ; le nom est réduit au prénom et à l'initiale.
CHAMPS_IDENTITE_LOCATAIRE = ("avatar_url", "bio", "quartier")


# ─── GET /api/users/<id> ─────────────────────────────────────

@users_bp.route("/<string:user_id>", methods=["GET"])
def get_user(user_id):
    """Profil public : niveau de confiance, avis reçus, annonces si bailleur.

    Le passeport d'un locataire n'y figure que pour qui a le droit de le lire
    (`services.acces.peut_voir_passeport`) ; l'adresse exacte des annonces
    d'un bailleur suit `visibilite_adresse`.
    """
    user = User.query.get_or_404(user_id)
    if not user.is_active:
        # Même réponse qu'un identifiant inconnu : pas d'oracle.
        return jsonify({"error": "Ressource introuvable", "details": []}), 404

    lecteur = utilisateur_optionnel()

    data = user.to_dict(public=True)

    # Un locataire n'est identifiable que par qui peut lire son dossier :
    # sinon l'identifiant d'une suggestion (version réduite) suffirait à
    # retrouver nom complet, photo, bio et quartier.
    niveau_passeport = None
    if user.role == "tenant":
        niveau_passeport = peut_voir_passeport(lecteur, user)
        if niveau_passeport is None:
            data["full_name"] = nom_reduit(user.full_name)
            for champ in CHAMPS_IDENTITE_LOCATAIRE:
                data.pop(champ, None)

    avis = user.reviews_received.order_by(Review.created_at.desc()).limit(10).all()
    data["avis"] = [r.to_dict() for r in avis]

    if user.role in ("landlord", "agency"):
        annonces = user.listings.filter(Listing.status == "active",
                                        Listing.is_visible.is_(True)).all()
        adresse_visible = visibilite_adresse(lecteur)
        data["annonces"] = [a.to_dict(include_landlord=False, avec_adresse=adresse_visible(a))
                            for a in annonces]
        data["nb_annonces"] = len(annonces)

    if user.role == "tenant":
        passeport = passeport_pour(lecteur, user, niveau=niveau_passeport)
        if passeport is not None:
            data["passeport"] = passeport

    return jsonify(data), 200


# ─── PUT /api/users/me ───────────────────────────────────────

@users_bp.route("/me", methods=["PUT"])
@current_user_required
@valider_corps(MajProfil)
def update_profile(current_user, corps):
    # Seuls les champs envoyés sont modifiés (voir MajProfil, qui exclut
    # avatar_url).
    for champ, valeur in corps.model_dump(exclude_unset=True).items():
        setattr(current_user, champ, valeur)

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
    # Les jetons de tous les appareils cessent de fonctionner immédiatement.
    current_user.revoquer_jetons()
    for annonce in current_user.listings:
        annonce.is_visible = False
        annonce.status = "closed"

    db.session.commit()
    return jsonify({"message": "Compte désactivé"}), 200


# ─── POST /api/users/me/avatar ───────────────────────────────

@users_bp.route("/me/avatar", methods=["POST"])
@current_user_required
def televerser_avatar(current_user):
    """Enregistre la photo de profil.

    Elle est publique : elle apparaît sur les annonces du propriétaire et
    auprès des candidats, où mettre un visage sur un nom fait partie du
    dispositif de confiance.
    """
    if "file" not in request.files:
        return jsonify({"error": "Aucune image fournie"}), 400

    ancien = current_user.avatar_url

    try:
        url = stockage.televerser(request.files["file"], "avatars",
                                  f"profil-{current_user.id}", stockage.IMAGES)
    except stockage.ErreurStockage as exc:
        return jsonify({"error": str(exc)}), 400

    current_user.avatar_url = url
    db.session.commit()

    # L'ancienne photo n'a plus d'usage une fois remplacée.
    if ancien and ancien != url:
        stockage.supprimer(ancien)

    return jsonify({
        "message": "Photo de profil enregistrée",
        "avatar_url": url,
        "user": current_user.to_dict(public=False),
    }), 200


# ─── DELETE /api/users/me/avatar ─────────────────────────────

@users_bp.route("/me/avatar", methods=["DELETE"])
@current_user_required
def supprimer_avatar(current_user):
    ancien = current_user.avatar_url
    if not ancien:
        return jsonify({"message": "Aucune photo de profil"}), 200

    current_user.avatar_url = None
    db.session.commit()
    stockage.supprimer(ancien)

    return jsonify({"message": "Photo de profil retirée",
                    "user": current_user.to_dict(public=False)}), 200
