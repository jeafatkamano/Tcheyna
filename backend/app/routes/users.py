"""routes/users.py — Profil public, édition du compte et photo de profil."""
from flask import Blueprint, jsonify, request
from werkzeug.security import check_password_hash

from app import db
from app.models import Listing, Review, User
from app.routes import current_user_required, utilisateur_optionnel
from app.schemas import erreur_champ, valider_corps
from app.schemas.users import MajProfil, SuppressionCompte
from app.services import donnees_personnelles as dp
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


# ─── POST /api/users/me/suppression ──────────────────────────

@users_bp.route("/me/suppression", methods=["POST"])
@current_user_required
@valider_corps(SuppressionCompte)
def supprimer_compte(current_user, corps):
    """Suppression définitive du compte, à la demande de son titulaire.

    Contrairement à DELETE /me (désactivation, réversible par un admin), les
    données personnelles sont anonymisées et les fichiers supprimés ; seuls
    restent les éléments rattachés à d'autres personnes ou à une obligation
    (paiements, avis, messages), sans plus rien qui identifie le titulaire.
    """
    if current_user.role == "admin":
        # Les décisions qu'il a signées restent attribuables : un compte
        # administrateur se retire par désactivation.
        return jsonify({"error": "Un compte administrateur ne peut pas être supprimé "
                                 "de cette façon"}), 403
    if not check_password_hash(current_user.password_hash, corps.mot_de_passe):
        # 422 et non 401 : le client lirait un 401 comme une session expirée.
        raise erreur_champ("mot_de_passe", "mot_de_passe_incorrect", "Mot de passe incorrect")

    a_supprimer = dp.anonymiser_compte(current_user)
    db.session.commit()
    dp.executer_suppressions(a_supprimer)
    return jsonify({"message": "Compte supprimé"}), 200


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
        # 422 pour une image illisible ou trop grande, comme les photos.
        return jsonify({"error": str(exc)}), exc.statut

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
