"""
routes/admin.py — Back-office de vérification.

C'est ici que se fabrique l'actif de confiance : validation des pièces
d'identité, des justificatifs de revenus et certification des annonces.
"""
from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request

from app import db
from app.models import (
    TRUST_LEVELS,
    Listing,
    Match,
    Payment,
    Review,
    TenantPassport,
    User,
)
from app.routes import role_required
from app.services import notifications as notify

admin_bp = Blueprint("admin", __name__)

admin_required = role_required("admin")


# ─── GET /api/admin/stats ────────────────────────────────────

@admin_bp.route("/stats", methods=["GET"])
@admin_required
def stats(current_user):
    il_y_a_30j = datetime.utcnow() - timedelta(days=30)

    paiements_ok = Payment.query.filter_by(statut="success").all()
    matches_conclus = Match.query.filter_by(status="completed").count()

    return jsonify({
        "utilisateurs": {
            "total":       User.query.count(),
            "locataires":  User.query.filter_by(role="tenant").count(),
            "proprietaires": User.query.filter_by(role="landlord").count(),
            "agences":     User.query.filter_by(role="agency").count(),
            "nouveaux_30j": User.query.filter(User.created_at >= il_y_a_30j).count(),
            "par_niveau": {
                str(n): User.query.filter_by(trust_level=n).count() for n in TRUST_LEVELS
            },
        },
        "annonces": {
            "total":      Listing.query.count(),
            "actives":    Listing.query.filter_by(status="active", is_visible=True).count(),
            "certifiees": Listing.query.filter_by(certification_status="certified").count(),
            "louees":     Listing.query.filter_by(status="matched").count(),
        },
        "mises_en_relation": {
            "total":      Match.query.count(),
            "en_attente": Match.query.filter_by(status="pending").count(),
            "acceptees":  Match.query.filter_by(status="accepted").count(),
            "conclues":   matches_conclus,
        },
        "revenus": {
            "total_encaisse": sum(p.montant for p in paiements_ok),
            "commissions":    sum(p.commission or 0 for p in paiements_ok),
            "nb_paiements":   len(paiements_ok),
            "devise":         "GNF",
        },
        "file_de_verification": {
            "cni_en_attente":     User.query.filter_by(cni_uploaded=True, cni_verified=False).count(),
            "revenus_en_attente": TenantPassport.query.filter(
                TenantPassport.income_doc_url.isnot(None),
                TenantPassport.income_verified.is_(False)).count(),
            "annonces_en_attente": Listing.query.filter_by(certification_status="pending").count(),
        },
        "avis": {"total": Review.query.count()},
    }), 200


# ─── Vérification des pièces d'identité ──────────────────────

@admin_bp.route("/cni-pending", methods=["GET"])
@admin_required
def cni_pending(current_user):
    users = User.query.filter_by(cni_uploaded=True, cni_verified=False).all()
    return jsonify([
        {
            "user": u.to_dict(public=False),
            "passport": u.passport.to_dict() if u.passport else None,
        }
        for u in users
    ]), 200


@admin_bp.route("/verify-cni/<string:user_id>", methods=["PUT"])
@admin_required
def verify_cni(current_user, user_id):
    """Valide ou refuse la pièce d'identité d'un utilisateur."""
    user = User.query.get_or_404(user_id)
    data = request.get_json() or {}
    approuve = data.get("approuve", True)

    user.cni_verified = bool(approuve)
    if not approuve:
        # Le document est écarté : l'utilisateur doit en redéposer un.
        user.cni_uploaded = False
        if user.passport:
            user.passport.cni_recto_url = None
            user.passport.cni_verso_url = None
            user.passport.passport_url = None
            user.passport.docs_uploaded = False

    ancien = user.trust_level or 0
    nouveau = user.update_trust_level()
    if user.passport:
        user.passport.calculate_score()

    if approuve and nouveau > ancien:
        niveau = TRUST_LEVELS[nouveau]
        notify.niveau_atteint(user.id, nouveau, niveau["label"], niveau["debloque"])
    elif not approuve:
        notify.notifier(
            user.id, "niveau_confiance", "Pièce d'identité refusée",
            data.get("motif") or "Le document fourni n'est pas exploitable. "
                                 "Merci d'en téléverser un nouveau, bien lisible.",
            "/tenant/profile",
        )

    db.session.commit()

    return jsonify({
        "message": "Identité validée" if approuve else "Identité refusée",
        "trust_level": user.trust_level,
        "badge": user.badge,
    }), 200


# ─── Vérification des revenus ────────────────────────────────

@admin_bp.route("/revenus-pending", methods=["GET"])
@admin_required
def revenus_pending(current_user):
    passports = TenantPassport.query.filter(
        TenantPassport.income_doc_url.isnot(None),
        TenantPassport.income_verified.is_(False),
    ).all()
    return jsonify([
        {"passport": p.to_dict(), "user": p.tenant.to_dict(public=False) if p.tenant else None}
        for p in passports
    ]), 200


@admin_bp.route("/verify-revenus/<string:user_id>", methods=["PUT"])
@admin_required
def verify_revenus(current_user, user_id):
    user = User.query.get_or_404(user_id)
    if not user.passport:
        return jsonify({"error": "Ce locataire n'a pas de passeport"}), 404

    data = request.get_json() or {}
    approuve = data.get("approuve", True)

    user.passport.income_verified = bool(approuve)
    user.income_verified = bool(approuve)

    ancien = user.trust_level or 0
    nouveau = user.update_trust_level()
    user.passport.calculate_score()

    if approuve and nouveau > ancien:
        niveau = TRUST_LEVELS[nouveau]
        notify.niveau_atteint(user.id, nouveau, niveau["label"], niveau["debloque"])
    elif not approuve:
        notify.notifier(
            user.id, "niveau_confiance", "Justificatif de revenus refusé",
            data.get("motif") or "Le justificatif fourni n'a pas pu être validé.",
            "/tenant/profile",
        )

    db.session.commit()
    return jsonify({"message": "Revenus validés" if approuve else "Revenus refusés",
                    "trust_level": user.trust_level}), 200


# ─── Certification des annonces ──────────────────────────────

@admin_bp.route("/certifications-pending", methods=["GET"])
@admin_required
def certifications_pending(current_user):
    annonces = (Listing.query.filter_by(certification_status="pending")
                .order_by(Listing.certification_requested_at.asc()).all())
    return jsonify([
        {
            **a.to_dict(),
            "propriete_doc_url": a.propriete_doc_url,
            "demande_le": (a.certification_requested_at.isoformat()
                           if a.certification_requested_at else None),
        }
        for a in annonces
    ]), 200


@admin_bp.route("/certifier/<string:listing_id>", methods=["PUT"])
@admin_required
def certifier_annonce(current_user, listing_id):
    """Accorde ou refuse le badge « Annonce Certifiée »."""
    listing = Listing.query.get_or_404(listing_id)
    data = request.get_json() or {}
    approuve = data.get("approuve", True)
    motif = (data.get("motif") or "").strip() or None

    if not approuve and not motif:
        return jsonify({"error": "Un motif est requis pour refuser une certification"}), 400

    if approuve:
        listing.certification_status = "certified"
        listing.certified_at = datetime.utcnow()
        listing.certification_note = motif
    else:
        listing.certification_status = "rejected"
        listing.certified_at = None
        listing.certification_note = motif

    notify.certification_traitee(
        listing.landlord_id, approuve, listing.title_fr, listing.id, motif
    )
    db.session.commit()

    return jsonify({
        "message": "Annonce certifiée" if approuve else "Certification refusée",
        "listing": listing.to_dict(),
    }), 200


# ─── Utilisateurs ────────────────────────────────────────────

@admin_bp.route("/users", methods=["GET"])
@admin_required
def list_users(current_user):
    page = request.args.get("page", 1, type=int)
    per_page = min(request.args.get("per_page", 50, type=int), 200)

    query = User.query
    if role := request.args.get("role"):
        query = query.filter_by(role=role)
    if recherche := request.args.get("q"):
        motif = f"%{recherche.strip()}%"
        query = query.filter(db.or_(User.full_name.ilike(motif), User.email.ilike(motif)))

    paginated = (query.order_by(User.created_at.desc())
                 .paginate(page=page, per_page=per_page, error_out=False))

    return jsonify({
        "users": [u.to_dict(public=False) for u in paginated.items],
        "total": paginated.total,
        "pages": paginated.pages,
        "page": page,
    }), 200


@admin_bp.route("/users/<string:user_id>/statut", methods=["PUT"])
@admin_required
def basculer_statut(current_user, user_id):
    """Active ou désactive un compte (fraude avérée, demande de l'utilisateur…)."""
    user = User.query.get_or_404(user_id)
    if user.id == current_user.id:
        return jsonify({"error": "Vous ne pouvez pas désactiver votre propre compte"}), 400

    user.is_active = bool((request.get_json() or {}).get("is_active", not user.is_active))
    db.session.commit()

    return jsonify({"message": "Compte activé" if user.is_active else "Compte désactivé",
                    "user": user.to_dict(public=False)}), 200
