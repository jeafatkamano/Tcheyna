"""
routes/listings.py — Annonces immobilières.

Inclut le parcours « Annonce Certifiée » : le propriétaire dépose un document de
propriété, l'annonce passe en `pending`, un administrateur tranche. Une annonce
certifiée remonte dans les résultats et affiche un badge visible.
"""
import math
from datetime import datetime

from flask import Blueprint, current_app, jsonify, request
from pydantic_core import PydanticCustomError
from sqlalchemy.orm import selectinload

from app import db
from app.models import (
    TYPES_BIEN_SANS_PIECES,
    Favorite,
    Listing,
    Payment,
    agregats_annonces,
)
from app.routes import current_user_required, role_required, utilisateur_optionnel
from app.routes.geo import CURRENCIES
from app.schemas import erreur_champ, valider_corps
from app.schemas.listings import (
    LOYER_MAX,
    MAX_IMAGES,
    CreationAnnonce,
    MajAnnonce,
    OrdrePhotos,
    UrlFichier,
    verifier_lieu,
)
from app.services import stockage
from app.services.acces import peut_voir_annonce, visibilite_adresse
from app.services.matching import score_compatibilite, trier_par_compatibilite

listings_bp = Blueprint("listings", __name__)

MAX_DOCUMENTS = 6


class _AnnonceANoter:
    """Ce que `score_compatibilite` lit d'une annonce, et rien de plus : le
    tri « match » note toutes les annonces filtrées sans charger leurs
    entités complètes. Les propriétés sont celles de `Listing` elles-mêmes,
    pour que la note ne puisse pas diverger de celle d'une annonce chargée."""

    COLONNES = (Listing.id, Listing.prix, Listing.charges, Listing.ville, Listing.quartier,
                Listing.type_bien, Listing.type_transaction, Listing.nb_pieces,
                Listing.certification_status)

    est_vente = Listing.est_vente
    sans_pieces = Listing.sans_pieces
    is_certified = Listing.is_certified

    def __init__(self, ligne):
        self.__dict__.update(ligne._asdict())


def _bool_arg(nom):
    return request.args.get(nom, "").lower() in ("true", "1", "yes")


def _devise(pays):
    """La devise découle du pays : le client ne la choisit jamais."""
    return CURRENCIES.get(pays, {}).get("code")


def _verifier_devise(envoyee, attendue):
    """Une devise envoyée n'est tolérée que si elle vaut celle du pays ; elle
    n'est jamais enregistrée telle quelle."""
    if envoyee is not None and envoyee != attendue:
        raise erreur_champ("devise", "devise_incoherente",
                           "Devise incohérente avec le pays : {attendue} attendue", envoyee,
                           attendue=attendue)


def _verifier_loyer(type_transaction, prix):
    if type_transaction == "location" and prix > LOYER_MAX:
        raise erreur_champ("prix", "montant_trop_eleve",
                           "Loyer mensuel trop élevé ({maximum} maximum)", prix,
                           maximum=LOYER_MAX)


# ─── GET /api/listings ────────────────────────────────────────

@listings_bp.route("/", methods=["GET"])
def get_listings():
    """Recherche publique. Les annonces certifiées et premium sont priorisées."""
    lang = request.args.get("lang", "fr")
    page = request.args.get("page", 1, type=int)
    per_page = min(request.args.get("per_page", 12, type=int), 50)

    query = Listing.query.filter_by(status="active", is_visible=True)

    for champ, arg in (("pays", "pays"), ("ville", "ville"),
                       ("quartier", "quartier"), ("type_bien", "type"),
                       ("type_transaction", "transaction")):
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
    # `is_premium` n'est jamais remis à faux : seule la date dit si la mise en
    # avant payée court encore.
    premium_en_cours = db.and_(Listing.is_premium.is_(True),
                               Listing.premium_until > datetime.utcnow())
    query = query.order_by(
        db.case((premium_en_cours, 1), else_=0).desc(),
        db.case((Listing.certification_status == "certified", 1), else_=0).desc(),
        ordres.get(tri, ordres["recent"]),
        # Départage stable : deux annonces ex aequo gardent le même ordre d'une
        # requête à l'autre, donc d'une page à l'autre.
        Listing.id,
    )

    # Un locataire connecté voit le score de compatibilité et ses favoris
    user = utilisateur_optionnel()
    favoris = set()
    passport = None
    if user:
        favoris = {f.listing_id for f in user.favorites}
        if user.role == "tenant":
            passport = user.passport
    adresse_visible = visibilite_adresse(user)
    locataire = user is not None and user.role == "tenant"

    scores = {}
    if tri == "match" and locataire:
        # Le score se calcule en Python : le tri porte sur TOUTES les annonces
        # filtrées, puis la page se découpe dans la liste triée (trier la seule
        # page courante ferait manquer, en page 1, les meilleures annonces des
        # pages suivantes). Tri stable : à score égal, l'ordre SQL (mise en
        # avant, certification, date) est conservé. Seules les colonnes du
        # score sont lues pour l'ensemble ; les entités, pour la page seule.
        a_noter = [_AnnonceANoter(ligne)
                   for ligne in query.with_entities(*_AnnonceANoter.COLONNES)]
        for annonce in a_noter:
            scores[annonce.id], _ = score_compatibilite(passport, annonce, user)
        a_noter.sort(key=lambda a: scores[a.id], reverse=True)
        # Mêmes bornes que `paginate(error_out=False)` : page < 1 → 1,
        # per_page < 1 → 20.
        page_reelle = max(page, 1)
        taille = per_page if per_page >= 1 else 20
        ids = [a.id for a in a_noter[(page_reelle - 1) * taille:page_reelle * taille]]
        total = len(a_noter)
        nb_pages = math.ceil(total / taille)
        chargees = {}
        if ids:
            chargees = {a.id: a for a in (Listing.query.options(selectinload(Listing.landlord))
                                          .filter(Listing.id.in_(ids)))}
        items = [chargees[i] for i in ids]
    else:
        # Bailleurs de la page lus en une requête (et non un par annonce).
        paginated = (query.options(selectinload(Listing.landlord))
                     .paginate(page=page, per_page=per_page, error_out=False))
        items, total, nb_pages = paginated.items, paginated.total, paginated.pages

    # Candidatures et avis des bailleurs : une requête pour toute la page.
    agregats = agregats_annonces(items)

    listings = []
    for annonce in items:
        data = annonce.to_dict(lang=lang, avec_adresse=adresse_visible(annonce),
                               agregats=agregats[annonce.id])
        data["is_favorite"] = annonce.id in favoris
        if locataire:
            if annonce.id not in scores:
                scores[annonce.id], _ = score_compatibilite(passport, annonce, user)
            data["score_compatibilite"] = scores[annonce.id]
        listings.append(data)

    return jsonify({
        "listings": listings,
        "total": total,
        "pages": nb_pages,
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

    # Le Passeport Locataire exprime un budget de loyer mensuel : le confronter
    # à un prix de vente n'aurait aucun sens.
    query = Listing.query.filter_by(status="active", is_visible=True,
                                    type_transaction="location")
    if passport and passport.ville_souhaitee:
        query = query.filter(Listing.ville == passport.ville_souhaitee)
    elif current_user.ville:
        query = query.filter(Listing.ville == current_user.ville)

    candidats = query.limit(150).all()
    favoris = {f.listing_id for f in current_user.favorites}
    deja_candidate = {m.listing_id for m in current_user.matches}
    adresse_visible = visibilite_adresse(current_user)

    resultats = []
    for annonce, score, details in trier_par_compatibilite(passport, candidats, current_user):
        if annonce.id in deja_candidate:
            continue
        data = annonce.to_dict(lang=lang, avec_adresse=adresse_visible(annonce))
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
        "listings": [a.to_dict(lang=lang, include_landlord=False, avec_adresse=True)
                     for a in annonces],
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

    user = utilisateur_optionnel()

    # Une annonce retirée n'existe plus que pour son propriétaire, l'admin et
    # ses candidats : pour les autres, elle est introuvable.
    if not peut_voir_annonce(user, listing):
        return jsonify({"error": "Ressource introuvable", "details": []}), 404

    # Le propriétaire ne gonfle pas son propre compteur de vues ; une annonce
    # retirée n'en reçoit plus.
    if listing.is_visible and (not user or user.id != listing.landlord_id):
        listing.views_count = (listing.views_count or 0) + 1
        db.session.commit()

    data = listing.to_dict(lang=lang, avec_adresse=visibilite_adresse(user)(listing))

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
@valider_corps(CreationAnnonce)
def create_listing(current_user, corps):
    valeurs = corps.model_dump()
    _verifier_devise(valeurs.pop("devise"), _devise(valeurs["pays"]))
    _verifier_loyer(valeurs["type_transaction"], valeurs["prix"])

    sans_pieces = valeurs["type_bien"] in TYPES_BIEN_SANS_PIECES
    location = valeurs["type_transaction"] == "location"
    listing = Listing(
        landlord_id=current_user.id,
        **valeurs,
        devise=_devise(valeurs["pays"]),
    )
    # Charges et caution n'existent que dans un bail ; un terrain ou un
    # hangar ne se décrit pas en pièces, en étage ni en ameublement.
    listing.charges = (valeurs["charges"] or 0) if location else 0
    if not location:
        listing.caution = None
    if sans_pieces:
        listing.nb_pieces, listing.etage, listing.meuble = None, None, False

    db.session.add(listing)
    db.session.commit()

    message = ("Annonce de vente publiée avec succès" if not location
               else "Annonce publiée avec succès")
    return jsonify({"message": message, "listing": listing.to_dict(avec_adresse=True)}), 201


# ─── PUT /api/listings/<id> ──────────────────────────────────

# Modifier l'un de ces champs invalide la certification : elle portait sur
# l'ancien état du bien.
CHAMPS_CERTIFIES = ("adresse", "quartier", "ville", "type_bien", "type_transaction", "superficie")


# Candidatures dont la décision dépend du type de transaction (frais de mise
# en relation d'une location, D1) : tant qu'il en existe, il ne change pas.
STATUTS_BLOQUANT_TYPE_TRANSACTION = ("pending", "accepted")


@listings_bp.route("/<string:listing_id>", methods=["PUT"])
@role_required("landlord", "agency")
@valider_corps(MajAnnonce)
def update_listing(current_user, listing_id, corps):
    listing = Listing.query.get_or_404(listing_id)
    if listing.landlord_id != current_user.id:
        return jsonify({"error": "Cette annonce ne vous appartient pas"}), 403
    # Relue sous verrou, comme pour les photos : une modification simultanée
    # (autre onglet, photo, décision de l'admin) ne peut ni écraser une
    # annulation de la certification ni s'intercaler entre la lecture de
    # l'état examiné et l'écriture.
    listing = _annonce_verrouillee(listing_id)

    valeurs = corps.model_dump(exclude_unset=True)
    devise_envoyee = valeurs.pop("devise", None)
    def change(champ):
        # Le front renvoie toujours le corps complet (pays, ville, prix…) :
        # seule une valeur qui diffère de la base compte. Sinon une annonce
        # antérieure aux contrôles (ville hors référentiel, gros loyer)
        # deviendrait impossible à modifier, et chaque sauvegarde annulerait
        # la certification. La valeur en base est comparée nettoyée, comme
        # l'entrée (espaces de bord retirés par le schéma).
        if champ not in valeurs:
            return False
        actuelle = getattr(listing, champ)
        return valeurs[champ] != (actuelle.strip() if isinstance(actuelle, str) else actuelle)

    # Les contrôles croisés portent sur l'état final : un champ absent garde
    # sa valeur en base.
    final = {c: valeurs.get(c, getattr(listing, c))
             for c in ("pays", "ville", "type_transaction", "prix")}
    if change("pays") or change("ville"):
        try:
            verifier_lieu(final["pays"], final["ville"])
        except PydanticCustomError as exc:
            raise erreur_champ("ville", exc.type, exc.message(), final["ville"]) from None
    if change("prix") or change("type_transaction"):
        _verifier_loyer(final["type_transaction"], final["prix"])
    # D1 (lot 2.4) : les frais de mise en relation ne portent que sur une
    # location. Basculer en « vente » le temps d'accepter gratuitement des
    # candidatures, puis revenir en location, les contournerait. Les
    # candidatures sont lues après le verrou de l'annonce, que prennent aussi
    # la candidature, la décision et la confirmation des frais : aucune ne
    # s'intercale entre cette lecture et l'écriture du nouveau type.
    if change("type_transaction") and any(
            m.status in STATUTS_BLOQUANT_TYPE_TRANSACTION for m in listing.matches):
        return jsonify({"error": "Le type de transaction ne peut pas changer tant que "
                                 "des candidatures sont en attente ou acceptées sur "
                                 "cette annonce : refusez-les d'abord."}), 409
    # Une annonce hors marché ouvert (créée avant ce contrôle) garde sa devise.
    devise = _devise(final["pays"]) or listing.devise
    _verifier_devise(devise_envoyee, devise)

    modifie_le_bien = any(change(c) for c in CHAMPS_CERTIFIES)

    if valeurs.get("charges", 0) is None:
        valeurs["charges"] = 0
    for champ, valeur in valeurs.items():
        setattr(listing, champ, valeur)
    listing.devise = devise

    # Basculer de la location vers la vente laisserait sinon traîner une caution
    # et des charges qui n'ont plus d'objet.
    if listing.type_transaction == "vente":
        listing.charges = 0
        listing.caution = None
    if listing.type_bien in TYPES_BIEN_SANS_PIECES:
        listing.nb_pieces = None
        listing.etage = None
        listing.meuble = False

    if listing.is_certified and modifie_le_bien:
        listing.certification_status = "none"
        listing.certified_at = None
        listing.certification_note = (
            "Certification annulée : les caractéristiques du bien ont été modifiées."
        )

    db.session.commit()
    return jsonify({"message": "Annonce mise à jour",
                    "listing": listing.to_dict(avec_adresse=True)}), 200


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
        "listing": listing.to_dict(avec_adresse=True),
    }), 200


# ─── Photos du bien ──────────────────────────────────────────

def _annonce_verrouillee(listing_id):
    """Relit l'annonce en posant un verrou d'écriture sur sa ligne.

    `images_urls` est une liste stockée dans une seule colonne : toute
    modification est un « lire, modifier, réécrire ». Sans verrou, deux
    requêtes simultanées (deux onglets, un envoi rejoué) liraient la même
    liste et la seconde écraserait la photo ajoutée par la première. Le
    `SELECT … FOR UPDATE` sérialise ces réécritures sur PostgreSQL ; SQLite
    l'ignore, mais n'a qu'un écrivain à la fois. `populate_existing` force la
    relecture même si l'objet est déjà dans la session.
    """
    return db.session.execute(
        db.select(Listing).filter_by(id=listing_id).with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one()


def _photos(listing):
    return listing.images_urls.split(",") if listing.images_urls else []


@listings_bp.route("/<string:listing_id>/photos", methods=["POST"])
@role_required("landlord", "agency")
def televerser_photos(current_user, listing_id):
    """Ajoute une ou plusieurs photos du bien.

    Ces photos sont publiques : elles s'affichent dans les résultats de
    recherche, y compris pour un visiteur sans compte.

    L'application envoie une photo par requête, l'une après l'autre ; la
    route accepte encore plusieurs fichiers pour les anciens clients.
    """
    listing = Listing.query.get_or_404(listing_id)
    if listing.landlord_id != current_user.id:
        return jsonify({"error": "Cette annonce ne vous appartient pas"}), 403

    fichiers = request.files.getlist("files") or request.files.getlist("file")
    if not fichiers:
        return jsonify({"error": "Aucune photo fournie"}), 400

    def refus_limite(nb_existantes):
        restant = max(MAX_IMAGES - nb_existantes, 0)
        return jsonify({
            "error": f"{MAX_IMAGES} photos maximum par annonce. "
                     f"Vous pouvez encore en ajouter {restant}."
        }), 400

    def deja_presente(empreinte, urls):
        return any(f"-{empreinte}." in url for url in urls)

    existantes = _photos(listing)
    # Le stockage (Supabase) peut être lent : ni verrou ni transaction ouverte
    # pendant l'appel, qui retiendrait une connexion du pool. La transaction
    # de lecture est close ici ; la suivante ne s'ouvre qu'à la relecture.
    db.session.rollback()

    # 1. Ré-encodage (EXIF/GPS retirés, 1280 px) et repérage des doublons :
    #    une photo renvoyée après une réponse perdue (« Réessayer ») porte la
    #    même empreinte que celle déjà enregistrée, elle n'est pas ajoutée.
    preparees = []
    empreintes = []  # de chaque fichier reçu, doublons compris, dans l'ordre
    erreur = None
    for fichier in fichiers:
        try:
            image = stockage.preparer_image(fichier, "photos")
        except stockage.ErreurStockage as exc:
            erreur = exc
            break
        empreintes.append(image.empreinte)
        if deja_presente(image.empreinte, existantes) or any(
                p.empreinte == image.empreinte for p in preparees):
            continue
        preparees.append(image)

    if len(existantes) + len(preparees) > MAX_IMAGES:
        return refus_limite(len(existantes))

    # 2. Stockage. Les photos déjà enregistrées sont conservées si une suivante
    #    échoue : l'utilisateur n'a pas à tout recommencer.
    ajoutees = []
    for image in preparees:
        try:
            ajoutees.append(stockage.enregistrer_image(
                image, "photos", stockage.nom_image(f"annonce-{listing_id}", image)))
        except stockage.ErreurStockage as exc:
            erreur = exc
            break

    # 3. Relecture sous verrou : la liste a pu changer pendant le stockage
    #    (autre onglet, même photo renvoyée en parallèle).
    listing = _annonce_verrouillee(listing_id)
    existantes = _photos(listing)
    nouvelles = [u for u in ajoutees if u not in existantes]
    if nouvelles:
        if len(existantes) + len(nouvelles) > MAX_IMAGES:
            db.session.rollback()
            for url in nouvelles:
                stockage.supprimer(url)
            return refus_limite(len(existantes))
        listing.images_urls = ",".join(existantes + nouvelles)
        db.session.commit()
    else:
        db.session.rollback()

    if erreur is not None:
        return jsonify({"error": str(erreur), "ajoutees": len(nouvelles)}), erreur.statut

    images = listing.to_dict()["images"]
    # URL de chaque fichier envoyé, ajouté ou reconnu comme doublon : le client
    # sait ainsi quelle vignette correspond à sa photo, sans supposer qu'elle
    # est la dernière de la liste.
    urls = [next((u for u in images if f"-{e}." in u), None) for e in empreintes]
    return jsonify({
        "message": f"{len(nouvelles)} photo(s) ajoutée(s)" if nouvelles
        else "Photo déjà enregistrée",
        "images": images,
        "url": urls[-1] if urls else None,
        "urls": urls,
    }), 201 if nouvelles else 200


@listings_bp.route("/<string:listing_id>/photos", methods=["DELETE"])
@role_required("landlord", "agency")
@valider_corps(UrlFichier)
def supprimer_photo(current_user, listing_id, corps):
    """Retire une photo, désignée par son URL."""
    listing = Listing.query.get_or_404(listing_id)
    if listing.landlord_id != current_user.id:
        return jsonify({"error": "Cette annonce ne vous appartient pas"}), 403

    url = corps.url

    listing = _annonce_verrouillee(listing_id)
    existantes = _photos(listing)
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
@valider_corps(OrdrePhotos)
def reordonner_photos(current_user, listing_id, corps):
    """Redéfinit l'ordre des photos ; la première sert de vignette."""
    listing = Listing.query.get_or_404(listing_id)
    if listing.landlord_id != current_user.id:
        return jsonify({"error": "Cette annonce ne vous appartient pas"}), 403

    # Seule une permutation des photos actuelles est acceptée : cette route
    # ne peut pas introduire d'URL.
    ordre = corps.images
    listing = _annonce_verrouillee(listing_id)
    existantes = _photos(listing)
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
            # `None` si aucun lien temporaire n'est possible (stockage disque
            # en développement) : l'interface affiche « lien indisponible ».
            "url": stockage.url_signee(url),
        }
        for i, url in enumerate(listing.documents, start=1)
    ]
    return jsonify({"documents": documents, "total": len(documents)}), 200


@listings_bp.route("/<string:listing_id>/documents", methods=["DELETE"])
@role_required("landlord", "agency")
@valider_corps(UrlFichier)
def supprimer_document(current_user, listing_id, corps):
    listing = Listing.query.get_or_404(listing_id)
    if listing.landlord_id != current_user.id:
        return jsonify({"error": "Cette annonce ne vous appartient pas"}), 403

    if listing.certification_status == "pending":
        return jsonify({"error": "Impossible de retirer une pièce pendant "
                                 "l'examen de la certification"}), 409

    url = corps.url
    existants = listing.documents
    if url not in existants:
        return jsonify({"error": "Ce document n'appartient pas à l'annonce"}), 404

    restants = [u for u in existants if u != url]
    listing.documents_urls = ",".join(restants) if restants else None
    db.session.commit()

    stockage.supprimer(url)

    return jsonify({"message": "Document retiré", "nb_documents": len(restants)}), 200
