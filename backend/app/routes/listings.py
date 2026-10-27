"""
routes/listings.py — Annonces immobilières.

Inclut le parcours « Annonce Certifiée » : le propriétaire dépose un document de
propriété, l'annonce passe en `pending`, un administrateur tranche. Une annonce
certifiée remonte dans les résultats et affiche un badge visible. Le badge
suit le contenu examiné : changer le bien (`CHAMPS_CERTIFIES`) ou ses photos
l'annule, et ses pièces de propriété ne peuvent plus être retirées. Pendant
l'examen, ces changements sont refusés : l'administrateur approuve l'état
qu'il a ouvert.
"""
import math
from datetime import datetime, timedelta

from flask import Blueprint, current_app, jsonify, request
from pydantic_core import PydanticCustomError
from sqlalchemy import event, inspect
from sqlalchemy.orm import selectinload

from app import db
from app.models import (
    TYPES_BIEN_SANS_PIECES,
    Favorite,
    Listing,
    Match,
    Payment,
    Verification,
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
from app.services import donnees_personnelles as dp
from app.services import notifications as notify
from app.services import stockage
from app.services.acces import peut_voir_annonce, publication_autorisee, visibilite_adresse
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
    """Annonces en ligne du propriétaire. `?inclure_retirees=1` y ajoute ses
    annonces retirées, pour qu'il puisse les remettre en ligne (lot 2.2) ; les
    statistiques portent toujours sur les seules annonces en ligne."""
    lang = request.args.get("lang", "fr")
    requete = current_user.listings.order_by(Listing.created_at.desc())
    annonces = requete.filter(Listing.is_visible.is_(True)).all()
    listees = requete.all() if _bool_arg("inclure_retirees") else annonces
    etats = etats_certification(listees)

    return jsonify({
        "listings": [{**a.to_dict(lang=lang, include_landlord=False, avec_adresse=True),
                      **_vue_proprietaire(a, etats[a.id])}
                     for a in listees],
        "total": len(listees),
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
        if data["is_owner"]:
            data.update(_vue_proprietaire(listing, etats_certification([listing])[listing.id]))
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
@publication_autorisee  # D3 : téléphone vérifié (services/acces.py)
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
# l'ancien état du bien. Le vérificateur juge les pièces de propriété
# « cohérentes avec l'annonce » (CGU §5) sur la fiche complète : ce qui se
# vérifie sur pièces, sur photos ou en visite relève du badge.
CHAMPS_CERTIFIES = (
    # Où est le bien : ce que désigne le titre foncier ou le bail. `pays` en
    # fait partie, une ville n'ayant de sens que dans son pays.
    "pays", "ville", "quartier", "adresse",
    # Ce qu'est le bien, et le droit exercé dessus : un bail ou un mandat de
    # gestion ne prouve pas le droit de vendre.
    "type_bien", "type_transaction",
    # Sa consistance : gonfler le nombre de pièces d'un petit logement
    # certifié est le cas relevé par l'audit.
    "superficie", "nb_pieces", "etage", "meuble",
    # Ses équipements : des colonnes du bien, et des critères de recherche
    # (eau courante, groupe électrogène…) où le badge fait remonter l'annonce.
    "has_generator", "has_water", "has_wifi", "is_secured", "has_parking", "has_ac",
)
# Hors certification, et pourquoi :
# - `prix`, `charges`, `caution` : des conditions commerciales, que les pièces
#   ne prouvent pas et qui bougent avec le marché (baisse, négociation) ;
# - titres et descriptions : du texte libre, retouché souvent (coquille,
#   traduction) ; les faits vérifiables sont dans les champs ci-dessus ;
# - `disponible_a_partir` : une date qui change d'un locataire à l'autre ;
# - `devise` : elle découle du pays.
_BOOLEENS_CERTIFIES = ("meuble", "has_generator", "has_water", "has_wifi",
                       "is_secured", "has_parking", "has_ac")


def _etat_certifie(listing):
    """Champs certifiés sous une forme comparable avant et après une
    modification : espaces de bord retirés (une adresse saisie avant les
    contrôles peut en garder), chaîne vide égale à l'absence, booléen nul
    égal à faux, pièces, étage et ameublement ignorés pour un bien qui n'en
    a pas (le serveur les efface). Sans quoi une sauvegarde sans changement
    réel annulerait la certification."""
    etat = {}
    for champ in CHAMPS_CERTIFIES:
        valeur = getattr(listing, champ)
        if isinstance(valeur, str):
            valeur = valeur.strip() or None
        etat[champ] = bool(valeur) if champ in _BOOLEENS_CERTIFIES else valeur
    if etat["type_bien"] in TYPES_BIEN_SANS_PIECES:
        etat.update(nb_pieces=None, etage=None, meuble=False)
    return etat


def _refus_pendant_examen(action):
    """409 renvoyé quand une modification du contenu examiné arrive pendant
    l'examen : l'administrateur approuverait sinon un autre état que celui
    qu'il a ouvert. Même règle que pour les pièces de propriété."""
    return jsonify({"error": f"Impossible {action} pendant l'examen de la certification"}), 409


def _annuler_certification(listing, motif):
    """Retire le badge d'une annonce certifiée dont le contenu examiné vient
    de changer : il portait sur l'état précédent. Sans effet sur une annonce
    qui n'est pas certifiée. L'appelant valide la transaction."""
    if not listing.is_certified:
        return
    listing.certification_status = "none"
    listing.certified_at = None
    listing.certification_note = f"Certification annulée : {motif}."


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
        # deviendrait impossible à modifier. La valeur en base est comparée
        # nettoyée, comme l'entrée (espaces de bord retirés par le schéma).
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

    # La certification se juge sur l'état enregistré, remises à zéro
    # ci-dessous comprises : c'est lui que le badge garantit.
    etat_examine = _etat_certifie(listing)

    if valeurs.get("charges", 0) is None:
        valeurs["charges"] = 0
    for champ, valeur in valeurs.items():
        setattr(listing, champ, valeur)
    listing.devise = devise
    # D6 (lot 2.3) : enregistrer le formulaire compte comme une activité, même
    # sans changement réel. C'est la confirmation « toujours d'actualité » que
    # le client actuel sait déjà faire, en plus de PUT /<id>/confirmer.
    listing.updated_at = datetime.utcnow()

    # Basculer de la location vers la vente laisserait sinon traîner une caution
    # et des charges qui n'ont plus d'objet.
    if listing.type_transaction == "vente":
        listing.charges = 0
        listing.caution = None
    if listing.type_bien in TYPES_BIEN_SANS_PIECES:
        listing.nb_pieces = None
        listing.etage = None
        listing.meuble = False

    if _etat_certifie(listing) != etat_examine:
        # Prix, description… restent modifiables pendant l'examen ; le bien,
        # non.
        if listing.certification_status == "pending":
            db.session.rollback()
            return _refus_pendant_examen("de modifier les caractéristiques du bien")
        _annuler_certification(listing, "les caractéristiques du bien ont été modifiées")

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
    # Même effet que PUT /<id>/retirer (lot 2.2), dont cette route est
    # l'alias historique : elle garde sa réponse.
    _retirer(listing)
    db.session.commit()
    return jsonify({"message": "Annonce retirée"}), 200


# ─── Cycle de vie : retirer, remettre en ligne (lot 2.2) ─────
#
# États d'une annonce, portés par `status` et `is_visible` :
#   en ligne : status « active », is_visible vrai. La création publie
#              directement (D3 : téléphone vérifié) ; il n'y a pas de brouillon.
#   retirée  : is_visible faux, status « closed ». Par son propriétaire
#              (retrait, DELETE), ou avec tout son compte (désactivation,
#              suppression). Invisible hors propriétaire, admin et candidats
#              (`services.acces.peut_voir_annonce`).
#   conclue  : status « matched », posé par PUT /matches/<id>/conclure. Le
#              bien est loué ou vendu : il ne revient pas sur le marché.
# Aucun administrateur ne retire d'annonce aujourd'hui (routes/admin.py).
#
# Le retrait ne touche pas aux candidatures : en attente ou acceptées, elles
# le restent, comme avec DELETE depuis toujours (question posée dans la PR).

def _retirer(listing):
    """Retrait logique, réversible par `reactiver_annonce`. L'appelant valide."""
    listing.is_visible = False
    listing.status = "closed"


def _conclue(listing):
    """Le bien a-t-il été loué ou vendu par Tcheyna ? Une annonce conclue puis
    retirée passe en « closed » : la candidature conclue en garde la trace."""
    return listing.status == "matched" or listing.matches.filter(
        Match.status == "completed").first() is not None


def _vue_proprietaire(listing, etat_certification):
    """Champs que seul le propriétaire lit : l'état de publication, et ce
    qu'une nouvelle demande de certification lui coûterait (D4)."""
    return {"retiree": not listing.is_visible, "certification_resoumission": etat_certification}


def _refus_annonce(message, code, statut):
    return jsonify({"error": message,
                    "details": [{"champ": "__root__", "code": code, "message": message}]}), statut


@listings_bp.route("/<string:listing_id>/retirer", methods=["PUT"])
@role_required("landlord", "agency")
def retirer_annonce(current_user, listing_id):
    """Masque une annonce sans la supprimer. Idempotent."""
    listing = Listing.query.get_or_404(listing_id)
    if listing.landlord_id != current_user.id:
        return jsonify({"error": "Cette annonce ne vous appartient pas"}), 403

    listing = _annonce_verrouillee(listing_id)
    deja = not listing.is_visible
    if not deja:
        _retirer(listing)
    db.session.commit()
    return jsonify({
        "message": "Annonce déjà retirée" if deja else "Annonce retirée",
        "listing": {**listing.to_dict(include_landlord=False, avec_adresse=True),
                    **_vue_proprietaire(listing, etats_certification([listing])[listing.id])},
    }), 200


@listings_bp.route("/<string:listing_id>/reactiver", methods=["PUT"])
@role_required("landlord", "agency")
@publication_autorisee  # D3 : remettre en ligne, c'est publier (services/acces.py)
def reactiver_annonce(current_user, listing_id):
    """Remet en ligne une annonce retirée. Idempotent.

    Un compte désactivé n'arrive pas jusqu'ici (`role_required` : 403) ; un
    compte réactivé par l'admin retrouve ses annonces retirées et peut les
    remettre en ligne, comme celles qu'il avait retirées lui-même.
    """
    listing = Listing.query.get_or_404(listing_id)
    if listing.landlord_id != current_user.id:
        return jsonify({"error": "Cette annonce ne vous appartient pas"}), 403

    listing = _annonce_verrouillee(listing_id)
    if _conclue(listing):
        db.session.rollback()
        return _refus_annonce("Ce bien a été loué ou vendu : son annonce ne peut pas être "
                              "remise en ligne. Publiez une nouvelle annonce.",
                              "annonce_conclue", 409)

    deja = listing.is_visible and listing.status == "active"
    listing.is_visible = True
    listing.status = "active"
    db.session.commit()
    return jsonify({
        "message": "Annonce déjà en ligne" if deja else "Annonce remise en ligne",
        "listing": {**listing.to_dict(include_landlord=False, avec_adresse=True),
                    **_vue_proprietaire(listing, etats_certification([listing])[listing.id])},
    }), 200


# ─── Expiration sans activité (D6, lot 2.3) ──────────────────
#
# Décision D6 (20/10/2026) : une annonce sans activité expire après 30 jours,
# avec une relance au propriétaire à J-7. Expirer, c'est retirer (`_retirer`) :
# l'annonce quitte les résultats, ses candidatures restent en l'état (règle du
# retrait, question posée dans la PR #37), et son propriétaire la remet en
# ligne par PUT /<id>/reactiver (téléphone vérifié, D3).
#
# Activité, sans colonne dédiée (aucune migration) : la plus récente de
#   • la publication (`created_at`) ;
#   • la dernière écriture du propriétaire sur l'annonce (`updated_at`) :
#     modification (même sans changement), photos, pièces, demande de
#     certification, remise en ligne, confirmation (PUT /<id>/confirmer) ;
#   • la dernière candidature reçue (`Match.created_at`).
# `updated_at` suit toute écriture (`onupdate`), y compris celles du système,
# qui ne disent rien de l'annonce : une écriture qui ne touche que
# COLONNES_SYSTEME garde l'ancienne date (`_garder_date_d_activite`).
DUREE_SANS_ACTIVITE = timedelta(days=30)
DELAI_RELANCE = timedelta(days=7)

# Compteur de vues (chaque visite), décision de certification par l'admin
# (routes/admin.py) et mise en avant payée (routes/payments.py). Une demande
# de certification par le propriétaire écrit aussi `certification_requested_at`
# et compte ; ses pièces et ses photos aussi.
COLONNES_SYSTEME = frozenset({
    "views_count",
    "certification_status", "certified_at", "certification_note",
    "is_premium", "premium_until",
})


@event.listens_for(Listing, "before_update")
def _garder_date_d_activite(_mapper, _connexion, annonce):
    """Une écriture qui ne touche que des colonnes du système laisse
    `updated_at` tel quel : `SET updated_at = updated_at` remplace le
    `onupdate`. Posé ici une fois pour toutes plutôt qu'à chaque écriture
    système : l'admin, les paiements et le compteur de vues n'ont rien à
    savoir de l'expiration."""
    etat = inspect(annonce)
    modifiees = {colonne.key for colonne in etat.mapper.column_attrs
                 if etat.attrs[colonne.key].history.has_changes()}
    if modifiees and modifiees <= COLONNES_SYSTEME:
        annonce.updated_at = Listing.updated_at


def dernieres_activites(annonces):
    """Date de la dernière activité de chaque annonce, en une requête pour
    toute la liste : {id: datetime, ou None si aucune date n'est connue}."""
    ids = [a.id for a in annonces]
    candidatures = {}
    if ids:
        candidatures = dict(db.session.query(Match.listing_id, db.func.max(Match.created_at))
                            .filter(Match.listing_id.in_(ids)).group_by(Match.listing_id))
    return {a.id: max((d for d in (a.created_at, a.updated_at, candidatures.get(a.id))
                       if d is not None), default=None)
            for a in annonces}


def _en_ligne(listing):
    return listing.is_visible and listing.status == "active"


def _mise_en_avant_en_cours(listing, maintenant):
    return bool(listing.is_premium and listing.premium_until
                and listing.premium_until > maintenant)


def expirer_annonces(maintenant=None):
    """Relance, puis retire, les annonces en ligne sans activité (D6).
    Retourne (relances envoyées, annonces retirées).

    Faite pour un cron quotidien (`flask annonces expirer`), à heure fixe :
      • relance : dès J-7 (échéance moins 7 jours), une seule par échéance.
        Le lien de la notification porte la date d'échéance : rejouer la
        commande ne relance pas deux fois, et une nouvelle activité, qui
        déplace l'échéance, ouvre droit à une nouvelle relance ;
      • retrait : à l'échéance, et jamais moins de 7 jours (en dates) après
        la relance de cette échéance. Un cron manqué pendant toute la fenêtre
        de relance, ou la première exécution sur des annonces déjà anciennes,
        relance d'abord et retire 7 jours plus tard : aucun propriétaire
        n'est retiré sans préavis ;
      • une annonce en mise en avant payée en cours n'est ni relancée ni
        retirée (question posée dans la PR) ; à la fin de la mise en avant,
        elle est relancée puis retirée comme les autres ;
      • une annonce conclue (`matched`) ou déjà retirée n'est pas en ligne :
        elle n'est pas concernée.
    """
    maintenant = maintenant or datetime.utcnow()
    debut_relance = maintenant - (DUREE_SANS_ACTIVITE - DELAI_RELANCE)
    # Condition nécessaire, lue en SQL : publiée et écrite avant le début de
    # la fenêtre de relance. Les candidatures se vérifient ensuite.
    annonces = (Listing.query
                .filter(Listing.status == "active", Listing.is_visible.is_(True),
                        Listing.created_at <= debut_relance,
                        db.or_(Listing.updated_at.is_(None), Listing.updated_at <= debut_relance))
                .order_by(Listing.created_at, Listing.id)
                .all())
    annonces = [a for a in annonces if not _mise_en_avant_en_cours(a, maintenant)]
    activites = dernieres_activites(annonces)

    relances = retraits = 0
    for annonce in annonces:
        derniere = activites[annonce.id]
        if derniere is None or maintenant < derniere + DUREE_SANS_ACTIVITE - DELAI_RELANCE:
            continue
        echeance = derniere + DUREE_SANS_ACTIVITE
        relance = notify.relance_expiration(annonce.landlord_id, annonce.id, echeance)
        if relance is None:
            notif = notify.annonce_bientot_expiree(
                annonce.landlord_id, annonce.title_fr, annonce.id, echeance,
                retrait_le=max(echeance, maintenant + DELAI_RELANCE))
            # Date simulée par les tests ; en production, c'est maintenant.
            notif.created_at = maintenant
            db.session.commit()
            relances += 1
        elif (maintenant >= echeance
              and relance.created_at.date() + DELAI_RELANCE <= maintenant.date()
              and _expirer(annonce.id, maintenant)):
            retraits += 1
    return relances, retraits


def _expirer(listing_id, maintenant):
    """Retire une annonce arrivée à échéance, sous verrou : une confirmation,
    une modification ou une candidature arrivée depuis la lecture (toutes
    écrivent l'annonce ou la verrouillent) la garde en ligne. Retourne vrai
    si l'annonce a été retirée."""
    listing = _annonce_verrouillee(listing_id)
    derniere = dernieres_activites([listing])[listing.id]
    if (not _en_ligne(listing) or _mise_en_avant_en_cours(listing, maintenant)
            or derniere is None or maintenant < derniere + DUREE_SANS_ACTIVITE):
        db.session.rollback()
        return False
    _retirer(listing)
    # Trace de la raison : le journal des décisions accueille déjà les
    # traitements automatiques, sans décideur (purge des pièces).
    dp.consigner(None, listing.id, "annonce", "expiree",
                 f"Aucune activité depuis le {derniere:%d/%m/%Y} (D6 : 30 jours)")
    notify.annonce_expiree(listing.landlord_id, listing.title_fr, listing.id, derniere)
    db.session.commit()
    return True


@listings_bp.route("/<string:listing_id>/confirmer", methods=["PUT"])
@role_required("landlord", "agency")
def confirmer_annonce(current_user, listing_id):
    """Le propriétaire confirme que son annonce en ligne est toujours
    d'actualité. Ne change rien d'autre : compte comme une activité (D6) et
    repousse l'expiration de 30 jours. Idempotent.

    Une annonce retirée (par son propriétaire ou faute d'activité) se remet
    en ligne par PUT /<id>/reactiver, qui exige le téléphone vérifié (D3) ;
    confirmer ne la republie pas. Une annonce conclue ne se confirme pas.
    """
    listing = Listing.query.get_or_404(listing_id)
    if listing.landlord_id != current_user.id:
        return jsonify({"error": "Cette annonce ne vous appartient pas"}), 403

    listing = _annonce_verrouillee(listing_id)
    if not _en_ligne(listing):
        conclue = _conclue(listing)
        db.session.rollback()
        if conclue:
            return _refus_annonce("Ce bien a été loué ou vendu : son annonce n'est plus "
                                  "en ligne.", "annonce_conclue", 409)
        return _refus_annonce("Cette annonce n'est pas en ligne : remettez-la en ligne "
                              "pour la publier de nouveau.", "annonce_retiree", 409)

    listing.updated_at = datetime.utcnow()
    db.session.commit()
    echeance = dernieres_activites([listing])[listing.id] + DUREE_SANS_ACTIVITE
    return jsonify({
        "message": "Annonce confirmée : elle reste en ligne",
        "expiration_prevue": echeance.isoformat(),
        "listing": {**listing.to_dict(include_landlord=False, avec_adresse=True),
                    **_vue_proprietaire(listing, etats_certification([listing])[listing.id])},
    }), 200


# ─── Re-soumission de certification (D4, lot 2.2) ────────────
#
# Décision D4 (20/10/2026) : la re-soumission d'une certification refusée est
# gratuite une fois, payante ensuite au tarif de la certification. Le premier
# paiement couvre donc deux examens (le premier et une re-soumission), chaque
# paiement suivant un seul.
#
# Sans colonne dédiée (aucune migration) : les refus se lisent dans le journal
# `verifications` (objet « certification_annonce », décision « refusee »,
# écrit par PUT /admin/certifier depuis le lot 1.5, jamais purgé) et les
# paiements dans `payments`. Les deux sont rejoués dans l'ordre : un paiement
# ouvre des examens, un refus en consomme un. Un refus sans examen payé
# (passerelle non configurée, refus antérieur au journal) ne consomme rien.
# Seuls les refus comptent : une certification accordée puis annulée par une
# modification du bien se redemande comme avant ce lot (question ouverte de
# la PR #20). Retirer, compléter les pièces ou réactiver n'efface aucun refus.
RESOUMISSIONS_GRATUITES = 1


def etats_certification(annonces, exclure_paiement_id=None):
    """État de la re-soumission de chaque annonce, en deux requêtes pour
    toute la liste : {id: {"nb_refus", "nb_paiements", "paiement_requis",
    "resoumission_gratuite"}}. Il vaut hors examen en cours : pendant un
    examen, le crédit qu'il consommera n'est pas encore décompté.

    `paiement_requis` : une nouvelle demande exige un nouveau paiement (dès
    que la passerelle est configurée, voir `demander_certification`).
    `resoumission_gratuite` : la prochaine demande est la re-soumission
    gratuite. `exclure_paiement_id` : paiement en cours de confirmation, qui
    ne compte pas encore (`routes.payments._motif_remboursement`).
    """
    ids = [a.id for a in annonces]
    evenements = {i: [] for i in ids}
    if ids:
        paiements = Payment.query.with_entities(
            Payment.listing_id, Payment.paid_at, Payment.created_at
        ).filter(Payment.listing_id.in_(ids), Payment.type_paiement == "certification",
                 Payment.statut == "success")
        if exclure_paiement_id:
            paiements = paiements.filter(Payment.id != exclure_paiement_id)
        for listing_id, paye_le, cree_le in paiements:
            # À date égale, le paiement passe avant le refus (0 < 1).
            evenements[listing_id].append((paye_le or cree_le, 0))
        refus = Verification.query.with_entities(
            Verification.cible_id, Verification.created_at
        ).filter(Verification.cible_id.in_(ids), Verification.objet == "certification_annonce",
                 Verification.decision == "refusee")
        for listing_id, le in refus:
            evenements[listing_id].append((le, 1))

    etats = {}
    for listing_id, liste in evenements.items():
        couverts = consommes = nb_refus = nb_paiements = 0
        for _, est_refus in sorted(liste, key=lambda e: (e[0] or datetime.min, e[1])):
            if not est_refus:
                # Seul le premier paiement porte la re-soumission gratuite.
                couverts += 1 if nb_paiements else 1 + RESOUMISSIONS_GRATUITES
                nb_paiements += 1
                continue
            nb_refus += 1
            if couverts:
                couverts -= 1
                consommes += 1
        etats[listing_id] = {
            "nb_refus": nb_refus,
            "nb_paiements": nb_paiements,
            "paiement_requis": couverts == 0,
            "resoumission_gratuite": couverts > 0 and 1 <= consommes <= RESOUMISSIONS_GRATUITES,
        }
    return etats


def certification_a_payer(listing, exclure_paiement_id=None):
    """Une nouvelle demande de certification de `listing` exige-t-elle un
    nouveau paiement ? Lue aussi par `routes.payments`, qui n'admet un
    paiement de certification que dans ce cas."""
    return etats_certification([listing], exclure_paiement_id)[listing.id]["paiement_requis"]


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
    # Après un refus, la re-soumission gratuite (D4) passe sans paiement.
    etat = etats_certification([listing])[listing.id]
    if current_app.config.get("CINETPAY_API_KEY") and etat["paiement_requis"]:
        return jsonify({
            "error": ("Vous avez déjà utilisé la re-soumission gratuite de cette annonce. "
                      "Réglez de nouveau les frais de certification pour soumettre "
                      "votre dossier." if etat["nb_paiements"] else
                      "La certification est un service payant. Réglez les frais "
                      "de certification pour soumettre votre dossier."),
            "paiement_requis": "certification",
            "certification_resoumission": etat,
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

    if listing.certification_status == "pending":
        return _refus_pendant_examen("d'ajouter une photo")

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
    # L'examen a pu commencer pendant le stockage (paiement confirmé).
    if nouvelles and listing.certification_status == "pending":
        db.session.rollback()
        for url in nouvelles:
            stockage.supprimer(url)
        return _refus_pendant_examen("d'ajouter une photo")
    if nouvelles:
        if len(existantes) + len(nouvelles) > MAX_IMAGES:
            db.session.rollback()
            for url in nouvelles:
                stockage.supprimer(url)
            return refus_limite(len(existantes))
        listing.images_urls = ",".join(existantes + nouvelles)
        # Le vérificateur n'a pas vu ces photos : elles pourraient montrer un
        # autre bien. Un doublon reconnu n'ajoute rien et ne compte pas.
        _annuler_certification(listing, "des photos ont été ajoutées")
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
    if listing.certification_status == "pending":
        db.session.rollback()
        return _refus_pendant_examen("de retirer une photo")
    existantes = _photos(listing)
    if url not in existantes:
        return jsonify({"error": "Cette photo n'appartient pas à l'annonce"}), 404

    restantes = [u for u in existantes if u != url]
    listing.images_urls = ",".join(restantes) if restantes else None
    # Remplacer une photo, c'est en retirer une puis en ajouter une : chacune
    # des deux étapes annule le badge.
    _annuler_certification(listing, "une photo a été retirée")
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

    # Mêmes photos, autre ordre : rien de ce que le vérificateur a vu ne
    # change, la certification reste, et l'ordre peut changer pendant
    # l'examen. La vignette devient l'une des photos examinées.
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
    # Sur une annonce certifiée, une pièce de plus n'ôte rien aux pièces
    # examinées, qui ne peuvent plus être retirées : le badge reste.
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
        return _refus_pendant_examen("de retirer une pièce")
    # Le badge repose sur ces pièces : en retirer une le viderait de sa preuve.
    if listing.is_certified:
        return jsonify({"error": "Impossible de retirer une pièce d'une annonce "
                                 "certifiée : le badge « Annonce Certifiée » "
                                 "repose sur ces pièces"}), 409

    url = corps.url
    existants = listing.documents
    if url not in existants:
        return jsonify({"error": "Ce document n'appartient pas à l'annonce"}), 404

    restants = [u for u in existants if u != url]
    listing.documents_urls = ",".join(restants) if restants else None
    db.session.commit()

    stockage.supprimer(url)

    return jsonify({"message": "Document retiré", "nb_documents": len(restants)}), 200
