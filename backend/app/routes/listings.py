"""
routes/listings.py — Annonces immobilières.

Inclut le parcours « Annonce Certifiée » : le propriétaire dépose un document de
propriété, l'annonce passe en `pending`, un administrateur tranche. Une annonce
certifiée remonte dans les résultats et affiche un badge visible.
"""
from datetime import date, datetime

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request

from app import db
from app.models import Favorite, Listing, Payment, User
from app.routes import current_user_required, role_required
from app.services import stockage
from app.services.matching import score_compatibilite, trier_par_compatibilite

listings_bp = Blueprint("listings", __name__)

TYPES_BIEN = ("appartement", "maison", "studio", "chambre", "villa")
MAX_IMAGES = 10
MAX_DOCUMENTS = 6


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

    if not listing.documents:
        return jsonify({
            "error": "Ajoutez au moins un document de propriété (titre foncier, "
                     "bail ou acte notarié) avant de demander la certification"
        }), 400
    if not listing.images_urls:
        return jsonify({"error": "Ajoutez au moins une photo du bien"}), 400

    # La certification est un service payant du modèle économique. Tant que la
    # passerelle Mobile Money n'est pas configurée, aucun propriétaire ne peut
    # payer : on laisse alors passer la demande plutôt que de bloquer le
    # parcours, et la contrainte s'applique d'elle-même dès l'activation.
    if current_app.config.get("CINETPAY_API_KEY"):
        regle = Payment.query.filter_by(
            listing_id=listing.id, type_paiement="certification", statut="success"
        ).first()
        if not regle:
            return jsonify({
                "error": "La certification est un service payant. Réglez les frais "
                         "de certification pour soumettre votre dossier.",
                "paiement_requis": "certification",
            }), 402

    listing.certification_status = "pending"
    listing.certification_requested_at = datetime.utcnow()
    listing.certification_note = None
    db.session.commit()

    return jsonify({
        "message": "Demande de certification envoyée. Un vérificateur Tcheyna "
                   "examinera votre dossier sous 48 h.",
        "listing": listing.to_dict(),
    }), 200


# ─── Photos du bien ──────────────────────────────────────────

@listings_bp.route("/<string:listing_id>/photos", methods=["POST"])
@role_required("landlord", "agency")
def televerser_photos(current_user, listing_id):
    """Ajoute une ou plusieurs photos du bien.

    Ces photos sont publiques : elles s'affichent dans les résultats de
    recherche, y compris pour un visiteur sans compte.
    """
    listing = Listing.query.get_or_404(listing_id)
    if listing.landlord_id != current_user.id:
        return jsonify({"error": "Cette annonce ne vous appartient pas"}), 403

    fichiers = request.files.getlist("files") or request.files.getlist("file")
    if not fichiers:
        return jsonify({"error": "Aucune photo fournie"}), 400

    existantes = listing.images_urls.split(",") if listing.images_urls else []
    if len(existantes) + len(fichiers) > MAX_IMAGES:
        restant = max(MAX_IMAGES - len(existantes), 0)
        return jsonify({
            "error": f"{MAX_IMAGES} photos maximum par annonce. "
                     f"Vous pouvez encore en ajouter {restant}."
        }), 400

    ajoutees = []
    for fichier in fichiers:
        try:
            url = stockage.televerser(fichier, "photos", f"annonce-{listing.id}",
                                      stockage.IMAGES)
        except stockage.ErreurStockage as exc:
            # Les photos déjà enregistrées sont conservées : l'utilisateur n'a
            # pas à tout recommencer parce qu'un seul fichier pose problème.
            if ajoutees:
                listing.images_urls = ",".join(existantes + ajoutees)
                db.session.commit()
            return jsonify({"error": str(exc), "ajoutees": len(ajoutees)}), 400
        ajoutees.append(url)

    listing.images_urls = ",".join(existantes + ajoutees)
    db.session.commit()

    return jsonify({
        "message": f"{len(ajoutees)} photo(s) ajoutée(s)",
        "images": listing.to_dict()["images"],
    }), 201


@listings_bp.route("/<string:listing_id>/photos", methods=["DELETE"])
@role_required("landlord", "agency")
def supprimer_photo(current_user, listing_id):
    """Retire une photo, désignée par son URL."""
    listing = Listing.query.get_or_404(listing_id)
    if listing.landlord_id != current_user.id:
        return jsonify({"error": "Cette annonce ne vous appartient pas"}), 403

    url = (request.get_json() or {}).get("url")
    if not url:
        return jsonify({"error": "url requise"}), 400

    existantes = listing.images_urls.split(",") if listing.images_urls else []
    if url not in existantes:
        return jsonify({"error": "Cette photo n'appartient pas à l'annonce"}), 404

    restantes = [u for u in existantes if u != url]
    listing.images_urls = ",".join(restantes) if restantes else None
    db.session.commit()

    stockage.supprimer(url)

    return jsonify({"message": "Photo retirée",
                    "images": listing.to_dict()["images"]}), 200


@listings_bp.route("/<string:listing_id>/photos/ordre", methods=["PUT"])
@role_required("landlord", "agency")
def reordonner_photos(current_user, listing_id):
    """Redéfinit l'ordre des photos ; la première sert de vignette."""
    listing = Listing.query.get_or_404(listing_id)
    if listing.landlord_id != current_user.id:
        return jsonify({"error": "Cette annonce ne vous appartient pas"}), 403

    ordre = (request.get_json() or {}).get("images")
    if not isinstance(ordre, list):
        return jsonify({"error": "images doit être une liste d'URLs"}), 400

    existantes = listing.images_urls.split(",") if listing.images_urls else []
    if sorted(ordre) != sorted(existantes):
        return jsonify({"error": "La liste doit contenir exactement les photos "
                                 "actuelles de l'annonce"}), 400

    listing.images_urls = ",".join(ordre)
    db.session.commit()
    return jsonify({"message": "Ordre enregistré", "images": ordre}), 200


# ─── Documents administratifs ────────────────────────────────

@listings_bp.route("/<string:listing_id>/documents", methods=["POST"])
@role_required("landlord", "agency")
def televerser_documents(current_user, listing_id):
    """Dépose les pièces établissant la propriété : titre foncier, bail, acte
    notarié, quittance… Plusieurs documents sont souvent nécessaires.

    Contrairement aux photos, ces pièces ne sont jamais publiques.
    """
    listing = Listing.query.get_or_404(listing_id)
    if listing.landlord_id != current_user.id:
        return jsonify({"error": "Cette annonce ne vous appartient pas"}), 403

    fichiers = request.files.getlist("files") or request.files.getlist("file")
    if not fichiers:
        return jsonify({"error": "Aucun document fourni"}), 400

    existants = listing.documents
    if len(existants) + len(fichiers) > MAX_DOCUMENTS:
        return jsonify({"error": f"{MAX_DOCUMENTS} documents maximum par annonce"}), 400

    ajoutes = []
    for fichier in fichiers:
        try:
            url = stockage.televerser(fichier, "documents", f"propriete-{listing.id}",
                                      stockage.DOCUMENTS)
        except stockage.ErreurStockage as exc:
            if ajoutes:
                listing.documents_urls = ",".join(existants + ajoutes)
                db.session.commit()
            return jsonify({"error": str(exc), "ajoutes": len(ajoutes)}), 400
        ajoutes.append(url)

    listing.documents_urls = ",".join(existants + ajoutes)

    # Compléter les pièces après un refus permet de redemander la certification.
    if listing.certification_status == "rejected":
        listing.certification_status = "none"

    db.session.commit()

    return jsonify({
        "message": f"{len(ajoutes)} document(s) enregistré(s)",
        "nb_documents": len(listing.documents),
    }), 201


@listings_bp.route("/<string:listing_id>/documents", methods=["GET"])
@current_user_required
def lister_documents(current_user, listing_id):
    """Retourne des liens temporaires vers les pièces justificatives.

    Réservé au propriétaire du bien et aux administrateurs : ces documents
    portent des informations patrimoniales.
    """
    listing = Listing.query.get_or_404(listing_id)
    if listing.landlord_id != current_user.id and current_user.role != "admin":
        return jsonify({"error": "Non autorisé"}), 403

    documents = [
        {
            "reference": url,
            "libelle": f"Document {i}",
            "url": stockage.url_signee(url) or url,
        }
        for i, url in enumerate(listing.documents, start=1)
    ]
    return jsonify({"documents": documents, "total": len(documents)}), 200


@listings_bp.route("/<string:listing_id>/documents", methods=["DELETE"])
@role_required("landlord", "agency")
def supprimer_document(current_user, listing_id):
    listing = Listing.query.get_or_404(listing_id)
    if listing.landlord_id != current_user.id:
        return jsonify({"error": "Cette annonce ne vous appartient pas"}), 403

    if listing.certification_status == "pending":
        return jsonify({"error": "Impossible de retirer une pièce pendant "
                                 "l'examen de la certification"}), 409

    url = (request.get_json() or {}).get("url")
    existants = listing.documents
    if not url or url not in existants:
        return jsonify({"error": "Ce document n'appartient pas à l'annonce"}), 404

    restants = [u for u in existants if u != url]
    listing.documents_urls = ",".join(restants) if restants else None
    db.session.commit()

    stockage.supprimer(url)

    return jsonify({"message": "Document retiré", "nb_documents": len(restants)}), 200
