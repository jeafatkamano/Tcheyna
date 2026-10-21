"""
routes/passport.py — Passeport Locataire.

Regroupe le dossier du locataire (documents, revenus, garant) et ses critères de
recherche, qui alimentent directement le moteur de matching.
"""
from datetime import datetime

from flask import Blueprint, jsonify, request

from app import db
from app.models import TRUST_LEVELS, TenantPassport, abonnements_passeport
from app.routes import current_user_required, role_required
from app.schemas import erreur_champ, valider_corps
from app.schemas.passport import Criteres, MajPasseport
from app.services import donnees_personnelles as dp
from app.services import stockage
from app.services.acces import passeport_pour

passport_bp = Blueprint("passport", __name__)

DOC_TYPES = {
    "cni_recto": "cni_recto_url",
    "cni_verso": "cni_verso_url",
    "passport":  "passport_url",
    "income":    "income_doc_url",
}


def _obtenir_ou_creer(user):
    passport = user.passport
    if not passport:
        passport = TenantPassport(tenant_id=user.id, devise="GNF")
        db.session.add(passport)
        db.session.flush()
    return passport


# ─── GET /api/passport ───────────────────────────────────────

@passport_bp.route("/", methods=["GET"])
@role_required("tenant")
def get_passport(current_user):
    passport = _obtenir_ou_creer(current_user)
    passport.calculate_score()
    db.session.commit()

    niveau_actuel = current_user.trust_level or 0
    fin_abonnement = abonnements_passeport([current_user.id]).get(current_user.id)
    return jsonify({
        **passport.to_dict(),
        "trust_level": niveau_actuel,
        "niveau": TRUST_LEVELS[niveau_actuel],
        "prochain_niveau": TRUST_LEVELS.get(niveau_actuel + 1),
        "etapes": _etapes_verification(current_user, passport),
        "abonnement": {
            "actif": fin_abonnement is not None,
            "jusqu_au": fin_abonnement.isoformat() if fin_abonnement else None,
        },
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
@valider_corps(MajPasseport)
def create_or_update_passport(current_user, corps):
    """Met à jour la situation professionnelle et le garant."""
    passport = _obtenir_ou_creer(current_user)
    valeurs = corps.model_dump(exclude_unset=True)

    # `null` laisse le revenu déclaré inchangé (comportement historique).
    if (revenu := valeurs.pop("revenu_mensuel", None)) is not None:
        # Déclarer un nouveau revenu remet la validation à zéro : l'admin doit revoir.
        if passport.revenu_mensuel != revenu and current_user.income_verified:
            current_user.income_verified = False
            passport.income_verified = False
            # La date de dépôt d'un justificatif validé et déjà supprimé ne
            # désigne plus rien (D5, D12) : un nouveau dépôt la remplacera.
            if not passport.income_doc_url:
                passport.revenus_deposes_le = None
        passport.revenu_mensuel = revenu

    if "a_un_garant" in valeurs:
        valeurs["a_un_garant"] = bool(valeurs["a_un_garant"])  # null = pas de garant
    for champ, valeur in valeurs.items():
        setattr(passport, champ, valeur)

    passport.calculate_score()
    current_user.update_trust_level()
    db.session.commit()

    return jsonify({"message": "Passeport mis à jour", "passport": passport.to_dict()}), 200


# ─── PUT /api/passport/preferences ───────────────────────────

@passport_bp.route("/preferences", methods=["PUT"])
@role_required("tenant")
@valider_corps(Criteres)
def update_preferences(current_user, corps):
    """Critères de recherche : ce que le moteur de matching utilise."""
    passport = _obtenir_ou_creer(current_user)
    valeurs = corps.model_dump(exclude_unset=True)

    # Comparé à l'état final : envoyer le seul minimum le confronte au
    # maximum déjà enregistré.
    budget_min = valeurs.get("budget_min", passport.budget_min)
    budget_max = valeurs.get("budget_max", passport.budget_max)
    if budget_min is not None and budget_max is not None and budget_min > budget_max:
        raise erreur_champ("budget_min", "budget_incoherent",
                           "Le budget minimum dépasse le budget maximum", budget_min)

    if "quartiers_souhaites" in valeurs:
        valeurs["quartiers_souhaites"] = ",".join(valeurs["quartiers_souhaites"] or []) or None
    for champ, valeur in valeurs.items():
        setattr(passport, champ, valeur)

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
    # Suppression planifiée : une panne du stockage ne laisse pas l'ancienne
    # pièce orpheline (voir services/donnees_personnelles.py).
    a_supprimer = dp.planifier_suppression([ancien] if ancien != url else [], "remplacement_piece")

    # Un nouveau document annule la validation précédente : l'admin doit revoir.
    # La date de dépôt fait courir la durée de conservation sans décision (D5).
    if doc_type in ("cni_recto", "cni_verso", "passport"):
        passport.docs_uploaded = bool(passport.cni_recto_url or passport.passport_url)
        current_user.cni_uploaded = passport.docs_uploaded
        current_user.cni_verified = False
        passport.identite_deposee_le = datetime.utcnow()
    elif doc_type == "income":
        passport.income_verified = False
        current_user.income_verified = False
        passport.revenus_deposes_le = datetime.utcnow()

    passport.calculate_score()
    current_user.update_trust_level()
    db.session.commit()
    dp.executer_suppressions(a_supprimer)

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
    a_supprimer = dp.planifier_suppression([ancien], "retrait_piece")

    if doc_type in ("cni_recto", "cni_verso", "passport"):
        passport.docs_uploaded = bool(passport.cni_recto_url or passport.passport_url)
        current_user.cni_uploaded = passport.docs_uploaded
        current_user.cni_verified = False
        if not (passport.cni_recto_url or passport.cni_verso_url or passport.passport_url):
            passport.identite_deposee_le = None
    elif doc_type == "income":
        passport.income_verified = False
        current_user.income_verified = False
        passport.revenus_deposes_le = None

    passport.calculate_score()
    current_user.update_trust_level()
    db.session.commit()
    dp.executer_suppressions(a_supprimer)

    return jsonify({"message": "Document supprimé", "score": passport.score}), 200


# ─── GET /api/passport/<tenant_id> ───────────────────────────

@passport_bp.route("/<string:tenant_id>", methods=["GET"])
@current_user_required
def voir_passeport(current_user, tenant_id):
    """Dossier d'un locataire, selon `services.acces.peut_voir_passeport` :
    complet pour lui-même et l'admin, public (sans données financières) pour
    un bailleur qui a reçu sa candidature.

    Sans droit, la réponse est la même que pour un passeport inexistant :
    elle ne confirme pas l'existence du locataire.
    """
    passport = TenantPassport.query.filter_by(tenant_id=tenant_id).first()
    donnees = passeport_pour(current_user, passport.tenant) if passport else None
    if donnees is None:
        return jsonify({"error": "Ce locataire n'a pas encore de passeport"}), 404

    return jsonify({
        **donnees,
        "tenant": passport.tenant.to_dict() if passport.tenant else None,
    }), 200
