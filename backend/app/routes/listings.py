"""
routes/listings.py — Annonces immobilières.

Inclut le parcours « Annonce Certifiée » : le propriétaire dépose un document de
propriété, l'annonce passe en `pending`, un administrateur tranche. Une annonce
certifiée remonte dans les résultats et affiche un badge visible.
"""
import os
from datetime import date, datetime

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required, verify_jwt_in_request
from werkzeug.utils import secure_filename

from app import db
from app.models import Favorite, Listing, User
from app.routes import current_user_required, role_required
from app.services.matching import score_compatibilite, trier_par_compatibilite

listings_bp = Blueprint("listings", __name__)

TYPES_BIEN = ("appartement", "maison", "studio", "chambre", "villa")
MAX_IMAGES = 10


def _bool_arg(nom):
    return request.args.get(nom, "").lower() in ("true", "1", "yes")


def _parse_date(valeur):
    if not valeur:
        return None
    try:
        return date.fromisoformat(valeur)
    except (TypeError, ValueError):
        return None


def _utilisateur_optionnel():
    """Identifie l'appelant si un jeton valide est fourni, sans l'exiger."""
    try:
        verify_jwt_in_request(optional=True)
        user_id = get_jwt_identity()
        return User.query.get(user_id) if user_id else None
    except Exception:  # noqa: BLE001 — un jeton invalide ne doit pas casser la recherche publique
        return None


# ─── GET /api/listings ────────────────────────────────────────

@listings_bp.route("/", methods=["GET"])
def get_listings():
    """Recherche publique. Les annonces certifiées et premium sont priorisées."""
    lang = request.args.get("lang", "fr")
    page = request.args.get("page", 1, type=int)
    per_page = min(request.args.get("per_page", 12, type=int), 50)

    query = Listing.query.filter_by(status="active", is_visible=True)

    for champ, arg in (("pays", "pays"), ("ville", "ville"),
                       ("quartier", "quartier"), ("type_bien", "type")):
        valeur = request.args.get(arg)
        if valeur:
            query = query.filter(getattr(Listing, champ) == valeur)

    if (prix_min := request.args.get("prix_min", type=int)) is not None:
        query = query.filter(Listing.prix >= prix_min)
    if (prix_max := request.args.get("prix_max", type=int)) is not None:
        query = query.filter(Listing.prix <= prix_max)
    if (pieces_min := request.args.get("nb_pieces_min", type=int)) is not None:
        query = query.filter(Listing.nb_pieces >= pieces_min)
    if (surface_min := request.args.get("surface_min", type=float)) is not None:
        query = query.filter(Listing.superficie >= surface_min)

    for arg, colonne in (("has_water", Listing.has_water),
                         ("has_generator", Listing.has_generator),
                         ("has_wifi", Listing.has_wifi),
                         ("is_secured", Listing.is_secured),
                         ("has_parking", Listing.has_parking),
                         ("has_ac", Listing.has_ac),
                         ("meuble", Listing.meuble)):
        if _bool_arg(arg):
            query = query.filter(colonne.is_(True))

    if _bool_arg("certified_only"):
        query = query.filter(Listing.certification_status == "certified")

    if recherche := request.args.get("q"):
        motif = f"%{recherche.strip()}%"
        query = query.filter(db.or_(Listing.title_fr.ilike(motif),
                                    Listing.description_fr.ilike(motif),
                                    Listing.quartier.ilike(motif)))

    tri = request.args.get("tri", "recent")
    ordres = {
        "prix_asc":  Listing.prix.asc(),
        "prix_desc": Listing.prix.desc(),
        "surface":   Listing.superficie.desc().nullslast(),
        "recent":    Listing.created_at.desc(),
    }
    # Le badge « Certifié » se paie d'une visibilité : il prime sur le tri choisi.
    query = query.order_by(
        Listing.is_premium.desc(),
        db.case((Listing.certification_status == "certified", 1), else_=0).desc(),
        ordres.get(tri, ordres["recent"]),
    )

    paginated = query.paginate(page=page, per_page=per_page, error_out=False)

    # Un locataire connecté voit le score de compatibilité et ses favoris
    user = _utilisateur_optionnel()
    favoris = set()
    passport = None
    if user:
        favoris = {f.listing_id for f in user.favorites}
        if user.role == "tenant":
            passport = user.passport

    listings = []
    for annonce in paginated.items:
        data = annonce.to_dict(lang=lang)
        data["is_favorite"] = annonce.id in favoris
        if user and user.role == "tenant":
            data["score_compatibilite"], _ = score_compatibilite(passport, annonce, user)
        listings.append(data)

    if tri == "match" and user and user.role == "tenant":
        listings.sort(key=lambda d: d.get("score_compatibilite", 0), reverse=True)

    return jsonify({
        "listings": listings,
        "total": paginated.total,
        "pages": paginated.pages,
        "page": page,
        "per_page": per_page,
    }), 200


# ─── GET /api/listings/recommandations ───────────────────────

@listings_bp.route("/recommandations", methods=["GET"])
@role_required("tenant")
def recommandations(current_user):
    """Annonces les plus compatibles avec le Passeport Locataire de l'appelant."""
    limite = min(request.args.get("limite", 10, type=int), 30)
    lang = request.args.get("lang", "fr")
    passport = current_user.passport

    query = Listing.query.filter_by(status="active", is_visible=True)
    if passport and passport.ville_souhaitee:
        query = query.filter(Listing.ville == passport.ville_souhaitee)
    elif current_user.ville:
        query = query.filter(Listing.ville == current_user.ville)

    candidats = query.limit(150).all()
    favoris = {f.listing_id for f in current_user.favorites}
    deja_candidate = {m.listing_id for m in current_user.matches}

    resultats = []
    for annonce, score, details in trier_par_compatibilite(passport, candidats, current_user):
        if annonce.id in deja_candidate:
            continue
        data = annonce.to_dict(lang=lang)
        data["score_compatibilite"] = score
        data["details_compatibilite"] = details
        data["is_favorite"] = annonce.id in favoris
        resultats.append(data)
        if len(resultats) >= limite:
            break

    return jsonify({
        "listings": resultats,
        "total": len(resultats),
        "passeport_complet": bool(passport and passport.budget_max and passport.ville_souhaitee),
    }), 200


# ─── GET /api/listings/mes-annonces ──────────────────────────

@listings_bp.route("/mes-annonces", methods=["GET"])
@role_required("landlord", "agency")
def mes_annonces(current_user):
    lang = request.args.get("lang", "fr")
    annonces = (current_user.listings
                .filter(Listing.is_visible.is_(True))
                .order_by(Listing.created_at.desc()).all())

    return jsonify({
        "listings": [a.to_dict(lang=lang, include_landlord=False) for a in annonces],
        "total": len(annonces),
        "stats": {
            "actives":    sum(1 for a in annonces if a.status == "active"),
            "certifiees": sum(1 for a in annonces if a.is_certified),
            "vues":       sum(a.views_count or 0 for a in annonces),
            "candidatures": sum(a.matches.count() for a in annonces),
        },
    }), 200


# ─── GET /api/listings/<id> ──────────────────────────────────

@listings_bp.route("/<string:listing_id>", methods=["GET"])
def get_listing(listing_id):
    lang = request.args.get("lang", "fr")
    listing = Listing.query.get_or_404(listing_id)

    user = _utilisateur_optionnel()

    # Le propriétaire ne gonfle pas son propre compteur de vues
    if not user or user.id != listing.landlord_id:
        listing.views_count = (listing.views_count or 0) + 1
        db.session.commit()

    data = listing.to_dict(lang=lang)

    if user:
        data["is_favorite"] = bool(
            Favorite.query.filter_by(user_id=user.id, listing_id=listing.id).first()
        )
        data["is_owner"] = user.id == listing.landlord_id
        if user.role == "tenant":
            score, details = score_compatibilite(user.passport, listing, user)
            data["score_compatibilite"] = score
            data["details_compatibilite"] = details
            candidature = listing.matches.filter_by(tenant_id=user.id).first()
            data["ma_candidature"] = (
                {"id": candidature.id, "status": candidature.status} if candidature else None
            )

    return jsonify(data), 200


# ─── POST /api/listings ──────────────────────────────────────

@listings_bp.route("/", methods=["POST"])
@role_required("landlord", "agency")
def create_listing(current_user):
    data = request.get_json() or {}

    for field in ("title_fr", "description_fr", "pays", "ville", "type_bien", "prix", "devise"):
        if not data.get(field):
            return jsonify({"error": f"Champ requis : {field}"}), 400

    if data["type_bien"] not in TYPES_BIEN:
        return jsonify({"error": f"Type de bien invalide : {' | '.join(TYPES_BIEN)}"}), 400

    try:
        prix = int(data["prix"])
    except (TypeError, ValueError):
        return jsonify({"error": "Le prix doit être un nombre entier"}), 400
    if prix <= 0:
        return jsonify({"error": "Le prix doit être supérieur à zéro"}), 400

    images = data.get("images") or []
    if len(images) > MAX_IMAGES:
        return jsonify({"error": f"{MAX_IMAGES} photos maximum par annonce"}), 400

    listing = Listing(
        landlord_id=current_user.id,
        title_fr=data["title_fr"].strip(),
        title_en=data.get("title_en"),
        description_fr=data["description_fr"].strip(),
        description_en=data.get("description_en"),
        pays=data["pays"],
        ville=data["ville"],
        quartier=data.get("quartier"),
        adresse=data.get("adresse"),
        type_bien=data["type_bien"],
        prix=prix,
        charges=data.get("charges", 0) or 0,
        caution=data.get("caution"),
        devise=data["devise"],
        nb_pieces=data.get("nb_pieces", 1),
        superficie=data.get("superficie"),
        etage=data.get("etage"),
        meuble=data.get("meuble", False),
        disponible_a_partir=_parse_date(data.get("disponible_a_partir")),
        has_generator=data.get("has_generator", False),
        has_water=data.get("has_water", False),
        has_wifi=data.get("has_wifi", False),
        is_secured=data.get("is_secured", False),
        has_parking=data.get("has_parking", False),
        has_ac=data.get("has_ac", False),
        images_urls=",".join(images) if images else None,
    )

    db.session.add(listing)
    db.session.commit()

    return jsonify({"message": "Annonce publiée avec succès",
                    "listing": listing.to_dict()}), 201


# ─── PUT /api/listings/<id> ──────────────────────────────────

@listings_bp.route("/<string:listing_id>", methods=["PUT"])
@role_required("landlord", "agency")
def update_listing(current_user, listing_id):
    listing = Listing.query.get_or_404(listing_id)
    if listing.landlord_id != current_user.id:
        return jsonify({"error": "Cette annonce ne vous appartient pas"}), 403

    data = request.get_json() or {}

    modifiables = (
        "title_fr", "title_en", "description_fr", "description_en",
        "pays", "ville", "quartier", "adresse", "type_bien", "prix", "charges",
        "caution", "devise", "nb_pieces", "superficie", "etage", "meuble",
        "has_generator", "has_water", "has_wifi", "is_secured", "has_parking",
        "has_ac", "status", "is_visible",
    )
    for champ in modifiables:
        if champ in data:
            setattr(listing, champ, data[champ])

    if "disponible_a_partir" in data:
        listing.disponible_a_partir = _parse_date(data["disponible_a_partir"])

    if "images" in data:
        images = data["images"] or []
        if len(images) > MAX_IMAGES:
            return jsonify({"error": f"{MAX_IMAGES} photos maximum par annonce"}), 400
        listing.images_urls = ",".join(images) if images else None

    # Modifier le bien invalide la certification : elle portait sur l'ancien état.
    champs_sensibles = {"adresse", "quartier", "ville", "type_bien", "superficie"}
    if listing.is_certified and champs_sensibles & set(data):
        listing.certification_status = "none"
        listing.certified_at = None
        listing.certification_note = (
            "Certification annulée : les caractéristiques du bien ont été modifiées."
        )

    db.session.commit()
    return jsonify({"message": "Annonce mise à jour", "listing": listing.to_dict()}), 200


# ─── DELETE /api/listings/<id> ───────────────────────────────

@listings_bp.route("/<string:listing_id>", methods=["DELETE"])
@role_required("landlord", "agency")
def delete_listing(current_user, listing_id):
    listing = Listing.query.get_or_404(listing_id)
    if listing.landlord_id != current_user.id:
        return jsonify({"error": "Cette annonce ne vous appartient pas"}), 403

    # Retrait logique : les candidatures et paiements passés restent traçables.
    listing.is_visible = False
    listing.status = "closed"
    db.session.commit()
    return jsonify({"message": "Annonce retirée"}), 200


# ─── POST /api/listings/<id>/certification ───────────────────

@listings_bp.route("/<string:listing_id>/certification", methods=["POST"])
@role_required("landlord", "agency")
def demander_certification(current_user, listing_id):
    """Soumet l'annonce à la certification Tcheyna."""
    listing = Listing.query.get_or_404(listing_id)
    if listing.landlord_id != current_user.id:
        return jsonify({"error": "Cette annonce ne vous appartient pas"}), 403

    if listing.certification_status == "pending":
        return jsonify({"error": "Une demande est déjà en cours d'examen"}), 409
    if listing.is_certified:
        return jsonify({"message": "Cette annonce est déjà certifiée"}), 200

    if not listing.propriete_doc_url:
        return jsonify({
            "error": "Ajoutez d'abord un document de propriété "
                     "(POST /api/listings/<id>/document)"
        }), 400
    if not listing.images_urls:
        return jsonify({"error": "Ajoutez au moins une photo du bien"}), 400

    listing.certification_status = "pending"
    listing.certification_requested_at = datetime.utcnow()
    listing.certification_note = None
    db.session.commit()

    return jsonify({
        "message": "Demande de certification envoyée. Un vérificateur Tcheyna "
                   "examinera votre dossier sous 48 h.",
        "listing": listing.to_dict(),
    }), 200


# ─── POST /api/listings/<id>/document ────────────────────────

@listings_bp.route("/<string:listing_id>/document", methods=["POST"])
@role_required("landlord", "agency")
def upload_document_propriete(current_user, listing_id):
    """Dépose le titre foncier / bail justifiant la propriété du bien."""
    listing = Listing.query.get_or_404(listing_id)
    if listing.landlord_id != current_user.id:
        return jsonify({"error": "Cette annonce ne vous appartient pas"}), 403

    if "file" not in request.files:
        return jsonify({"error": "Aucun fichier fourni"}), 400

    fichier = request.files["file"]
    extension = (fichier.filename or "").rsplit(".", 1)[-1].lower()
    if extension not in current_app.config["ALLOWED_EXTENSIONS"]:
        return jsonify({"error": "Format non autorisé (jpg, png, pdf)"}), 400

    dossier = current_app.config["UPLOAD_FOLDER"]
    os.makedirs(dossier, exist_ok=True)
    nom = secure_filename(f"propriete_{listing.id}.{extension}")
    fichier.save(os.path.join(dossier, nom))

    listing.propriete_doc_url = f"/uploads/{nom}"
    db.session.commit()

    return jsonify({"message": "Document enregistré", "url": listing.propriete_doc_url}), 200
