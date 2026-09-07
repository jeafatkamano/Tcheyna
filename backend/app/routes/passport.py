"""
routes/passport.py — Passeport Locataire.

Regroupe le dossier du locataire (documents, revenus, garant) et ses critères de
recherche, qui alimentent directement le moteur de matching.
"""
from datetime import date

from flask import Blueprint, jsonify, request

from app import db
from app.models import TRUST_LEVELS, TenantPassport
from app.routes import role_required
from app.services import stockage

passport_bp = Blueprint("passport", __name__)

DOC_TYPES = {
    "cni_recto": "cni_recto_url",
    "cni_verso": "cni_verso_url",
    "passport":  "passport_url",
    "income":    "income_doc_url",
}

SITUATIONS_PRO = ("salarié", "indépendant", "étudiant", "commerçant", "fonctionnaire", "autre")


def _obtenir_ou_creer(user):
    passport = user.passport
    if not passport:
        passport = TenantPassport(tenant_id=user.id, devise="GNF")
        db.session.add(passport)
        db.session.flush()
    return passport


def _parse_date(valeur):
    try:
        return date.fromisoformat(valeur) if valeur else None
    except (TypeError, ValueError):
        return None


# ─── GET /api/passport ───────────────────────────────────────

@passport_bp.route("/", methods=["GET"])
@role_required("tenant")
def get_passport(current_user):
    passport = _obtenir_ou_creer(current_user)
    passport.calculate_score()
    db.session.commit()

    niveau_actuel = current_user.trust_level or 0
    return jsonify({
        **passport.to_dict(),
        "trust_level": niveau_actuel,
        "niveau": TRUST_LEVELS[niveau_actuel],
        "prochain_niveau": TRUST_LEVELS.get(niveau_actuel + 1),
        "etapes": _etapes_verification(current_user, passport),
    }), 200


def _etapes_verification(user, passport):
    """Liste ce qui est acquis et ce qu'il reste à faire, dans l'ordre du parcours."""
    return [
        {
            "niveau": 1, "titre": "Numéro vérifié par SMS",
            "fait": bool(user.phone_verified),
            "action": "verifier_telephone",
        },
        {
            "niveau": 2, "titre": "Pièce d'identité (CNI) validée",
            "fait": bool(user.cni_verified),
            "en_attente": bool(user.cni_uploaded and not user.cni_verified),
            "action": "televerser_cni",
        },
        {
            "niveau": 3, "titre": "Justificatifs de revenus validés",
            "fait": bool(user.income_verified),
            "en_attente": bool(passport.income_doc_url and not user.income_verified),
            "action": "televerser_revenus",
        },
        {
            "niveau": 4, "titre": "Historique locatif et avis de bailleurs",
            "fait": (user.trust_level or 0) >= 4,
            "detail": f"{user.reviews_received.filter_by(is_positive=True).count()}/3 avis positifs",
            "action": "obtenir_avis",
        },
    ]


# ─── POST /api/passport ──────────────────────────────────────

@passport_bp.route("/", methods=["POST"])
@role_required("tenant")
def create_or_update_passport(current_user):
    """Met à jour la situation professionnelle et le garant."""
    passport = _obtenir_ou_creer(current_user)
    data = request.get_json() or {}

    if (situation := data.get("situation_pro")) and situation not in SITUATIONS_PRO:
        return jsonify({"error": f"Situation invalide : {' | '.join(SITUATIONS_PRO)}"}), 400

    if "revenu_mensuel" in data and data["revenu_mensuel"] is not None:
        try:
            revenu = int(data["revenu_mensuel"])
        except (TypeError, ValueError):
            return jsonify({"error": "Le revenu doit être un nombre"}), 400
        if revenu < 0:
            return jsonify({"error": "Le revenu ne peut pas être négatif"}), 400
        # Déclarer un nouveau revenu remet la validation à zéro : l'admin doit revoir.
        if passport.revenu_mensuel != revenu and current_user.income_verified:
            current_user.income_verified = False
            passport.income_verified = False
        passport.revenu_mensuel = revenu

    for champ in ("devise", "employeur", "situation_pro",
                  "a_un_garant", "garant_nom", "garant_revenu"):
        if champ in data:
            setattr(passport, champ, data[champ])

    passport.calculate_score()
    current_user.update_trust_level()
    db.session.commit()

    return jsonify({"message": "Passeport mis à jour", "passport": passport.to_dict()}), 200


# ─── PUT /api/passport/preferences ───────────────────────────

@passport_bp.route("/preferences", methods=["PUT"])
@role_required("tenant")
def update_preferences(current_user):
    """Critères de recherche : ce que le moteur de matching utilise."""
    passport = _obtenir_ou_creer(current_user)
    data = request.get_json() or {}

    budget_min = data.get("budget_min", passport.budget_min)
    budget_max = data.get("budget_max", passport.budget_max)
    if budget_min and budget_max and int(budget_min) > int(budget_max):
        return jsonify({"error": "Le budget minimum dépasse le budget maximum"}), 400

    for champ in ("budget_min", "budget_max", "ville_souhaitee",
                  "type_bien_souhaite", "nb_pieces_min", "nb_occupants"):
        if champ in data:
            setattr(passport, champ, data[champ])

    if "quartiers_souhaites" in data:
        quartiers = data["quartiers_souhaites"]
        if isinstance(quartiers, list):
            quartiers = ",".join(str(q).strip() for q in quartiers if str(q).strip())
        passport.quartiers_souhaites = quartiers or None

    if "date_emmenagement" in data:
        passport.date_emmenagement = _parse_date(data["date_emmenagement"])

    passport.calculate_score()
    db.session.commit()

    return jsonify({"message": "Critères de recherche enregistrés",
                    "passport": passport.to_dict()}), 200


# ─── POST /api/passport/upload/<doc_type> ────────────────────

@passport_bp.route("/upload/<string:doc_type>", methods=["POST"])
@role_required("tenant")
def upload_document(current_user, doc_type):
    """Téléverse un document : cni_recto | cni_verso | passport | income."""
    if doc_type not in DOC_TYPES:
        return jsonify({"error": f"Type invalide : {' | '.join(DOC_TYPES)}"}), 400

    if "file" not in request.files:
        return jsonify({"error": "Aucun fichier fourni"}), 400

    passport = _obtenir_ou_creer(current_user)

    # Le document précédent est remplacé : conserver l'ancien fichier
    # occuperait de l'espace sans jamais servir.
    ancien = getattr(passport, DOC_TYPES[doc_type])

    try:
        url = stockage.televerser(request.files["file"], "documents",
                                  f"{doc_type}-{current_user.id}", stockage.DOCUMENTS)
    except stockage.ErreurStockage as exc:
        return jsonify({"error": str(exc)}), 400

    setattr(passport, DOC_TYPES[doc_type], url)
    if ancien and ancien != url:
        stockage.supprimer(ancien)

    # Un nouveau document annule la validation précédente : l'admin doit revoir.
    if doc_type in ("cni_recto", "cni_verso", "passport"):
        passport.docs_uploaded = bool(passport.cni_recto_url or passport.passport_url)
        current_user.cni_uploaded = passport.docs_uploaded
        current_user.cni_verified = False
    elif doc_type == "income":
        passport.income_verified = False
        current_user.income_verified = False

    passport.calculate_score()
    current_user.update_trust_level()
    db.session.commit()

    return jsonify({
        "message": "Document téléversé. Il sera vérifié sous 48 h.",
        "url": url,
        "score": passport.score,
        "trust_level": current_user.trust_level,
    }), 200


# ─── DELETE /api/passport/upload/<doc_type> ──────────────────

@passport_bp.route("/upload/<string:doc_type>", methods=["DELETE"])
@role_required("tenant")
def supprimer_document(current_user, doc_type):
    if doc_type not in DOC_TYPES:
        return jsonify({"error": f"Type invalide : {' | '.join(DOC_TYPES)}"}), 400

    passport = _obtenir_ou_creer(current_user)
    ancien = getattr(passport, DOC_TYPES[doc_type])
    setattr(passport, DOC_TYPES[doc_type], None)
    if ancien:
        stockage.supprimer(ancien)

    if doc_type in ("cni_recto", "cni_verso", "passport"):
        passport.docs_uploaded = bool(passport.cni_recto_url or passport.passport_url)
        current_user.cni_uploaded = passport.docs_uploaded
        current_user.cni_verified = False
    elif doc_type == "income":
        passport.income_verified = False
        current_user.income_verified = False

    passport.calculate_score()
    current_user.update_trust_level()
    db.session.commit()

    return jsonify({"message": "Document supprimé", "score": passport.score}), 200


# ─── GET /api/passport/<tenant_id> ───────────────────────────

@passport_bp.route("/<string:tenant_id>", methods=["GET"])
@role_required("landlord", "agency", "admin")
def voir_passeport(current_user, tenant_id):
    """Vue propriétaire d'un dossier candidat, sans les données financières brutes."""
    passport = TenantPassport.query.filter_by(tenant_id=tenant_id).first()
    if not passport:
        return jsonify({"error": "Ce locataire n'a pas encore de passeport"}), 404

    public = current_user.role != "admin"
    return jsonify({
        **passport.to_dict(public=public),
        "tenant": passport.tenant.to_dict() if passport.tenant else None,
    }), 200
