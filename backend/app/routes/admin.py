"""
routes/admin.py — Back-office de vérification.

C'est ici que se fabrique l'actif de confiance : validation des pièces
d'identité, des justificatifs de revenus et certification des annonces.
"""
from datetime import datetime, timedelta

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy import select

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
from app.schemas import erreur_champ, valider_corps
from app.schemas.admin import Decision, Remboursement, StatutCompte
from app.schemas.payments import A_REMBOURSER, PAIEMENTS_HORS_PLATEFORME, REMBOURSE
from app.services import donnees_personnelles as dp
from app.services import notifications as notify
from app.services import stockage

admin_bp = Blueprint("admin", __name__)

admin_required = role_required("admin")


def _liens_pieces(passport):
    """Liens temporaires vers les pièces d'un passeport.

    Un vérificateur doit pouvoir ouvrir la CNI qu'il valide ; ces documents ne
    sont pour autant jamais accessibles publiquement.

    Une signature impossible donne `None` : la référence interne
    `supabase://…` ne s'ouvre dans aucun navigateur, l'interface signale
    alors le lien comme indisponible.
    """
    if not passport:
        return {}
    champs = {
        "cni_recto": passport.cni_recto_url,
        "cni_verso": passport.cni_verso_url,
        "passport": passport.passport_url,
        "income": passport.income_doc_url,
    }
    return {cle: stockage.url_signee(url)
            for cle, url in champs.items() if url}


# ─── GET /api/admin/diagnostic ───────────────────────────────

@admin_bp.route("/diagnostic", methods=["GET"])
@admin_required
def diagnostic(current_user):
    """État de la configuration serveur, sans jamais révéler de secret.

    L'offre gratuite de Render ne donne pas d'accès shell : sans cette route,
    vérifier qu'une variable d'environnement est bien arrivée demanderait de
    déduire la réponse d'un message d'erreur.
    """
    from flask import current_app

    def renseigne(cle):
        return bool(current_app.config.get(cle))

    # On éprouve la clé plutôt que de constater sa présence : une clé publique
    # est renseignée, valide, et refuse pourtant chaque écriture.
    stockage_pret, consequence = stockage.verifier_acces()

    return jsonify({
        "stockage": {
            "operationnel": stockage_pret,
            "supabase_url": renseigne("SUPABASE_URL"),
            "supabase_service_key": renseigne("SUPABASE_SERVICE_KEY"),
            "compartiment_public": current_app.config.get("SUPABASE_BUCKET_PUBLIC"),
            "compartiment_prive": current_app.config.get("SUPABASE_BUCKET_PRIVE"),
            "consequence": consequence,
        },
        "sms": {
            "operationnel": renseigne("AT_API_KEY"),
            "consequence": (
                "Les codes OTP partent par SMS."
                if renseigne("AT_API_KEY")
                else "Aucun SMS envoyé : personne ne peut dépasser le niveau 0."
            ),
        },
        "paiements": {
            "operationnel": renseigne("CINETPAY_API_KEY") and renseigne("CINETPAY_SITE_ID"),
            "consequence": (
                "Les paiements Mobile Money sont actifs."
                if renseigne("CINETPAY_API_KEY") and renseigne("CINETPAY_SITE_ID")
                else "Les paiements restent au statut « en attente »."
            ),
        },
        "base_de_donnees": {
            "moteur": current_app.config["SQLALCHEMY_DATABASE_URI"].split("://")[0],
        },
        # Réglage de TRUSTED_PROXY_HOPS (limites de débit par IP). Depuis son
        # propre poste, l'admin compare `remote_addr` à son IP publique :
        # égales, le réglage est bon ; IP d'un proxy (Render, Cloudflare),
        # il faut l'augmenter. `x_forwarded_for_entrees` donne le nombre
        # d'entrées reçues, donc de proxys traversés (+ celles du client).
        "reseau": {
            "trusted_proxy_hops": current_app.config.get("TRUSTED_PROXY_HOPS"),
            "remote_addr": request.remote_addr,
            "x_forwarded_for_entrees": len([
                e for e in request.headers.get("X-Forwarded-For", "").split(",") if e.strip()
            ]),
            # Présence seulement : ces en-têtes ne sont pas utilisés tant
            # qu'on ignore si Render les écrase (sinon, falsifiables).
            "true_client_ip_present": "True-Client-IP" in request.headers,
            "cf_connecting_ip_present": "CF-Connecting-IP" in request.headers,
            "limites_stockage": current_app.config.get("RATELIMIT_STORAGE_URI", "").split("://")[0],
        },
    }), 200


# ─── GET /api/admin/stats ────────────────────────────────────

@admin_bp.route("/stats", methods=["GET"])
@admin_required
def stats(current_user):
    il_y_a_30j = datetime.utcnow() - timedelta(days=30)

    paiements_ok = Payment.query.filter_by(statut="success").all()
    # Caution et loyer encaissés avant D2 = A sont des fonds de tiers, pas des
    # revenus Tcheyna : comptés à part. Les commissions historiques retenues sur
    # un premier loyer restent comptées comme commissions.
    services = [p for p in paiements_ok if p.type_paiement not in PAIEMENTS_HORS_PLATEFORME]
    fonds_de_tiers = [p for p in paiements_ok if p.type_paiement in PAIEMENTS_HORS_PLATEFORME]
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
            "total_encaisse": sum(p.montant for p in services)
                              + sum(p.commission or 0 for p in fonds_de_tiers),
            "commissions":    sum(p.montant for p in services if p.type_paiement == "commission")
                              + sum(p.commission or 0 for p in fonds_de_tiers),
            "nb_paiements":   len(services),
            "fonds_de_tiers_historiques": sum(p.montant for p in fonds_de_tiers),
            "devise":         "GNF",
        },
        "file_de_verification": {
            "cni_en_attente":     User.query.filter_by(cni_uploaded=True, cni_verified=False).count(),
            "revenus_en_attente": TenantPassport.query.filter(
                TenantPassport.income_doc_url.isnot(None),
                TenantPassport.income_verified.is_(False)).count(),
            "annonces_en_attente": Listing.query.filter_by(certification_status="pending").count(),
            # Encaissés par CinetPay mais non dus (caution, loyer, doublon).
            "paiements_a_rembourser": Payment.query.filter_by(statut=A_REMBOURSER).count(),
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
            "pieces": _liens_pieces(u.passport),
        }
        for u in users
    ]), 200


@admin_bp.route("/verify-cni/<string:user_id>", methods=["PUT"])
@admin_required
@valider_corps(Decision)
def verify_cni(current_user, user_id, corps):
    """Valide ou refuse la pièce d'identité d'un utilisateur."""
    user = User.query.get_or_404(user_id)
    approuve = corps.approuve

    # R1 : une validation ne porte que sur une pièce effectivement déposée.
    # Le passeport fait foi, pas le drapeau `cni_uploaded`, qui peut dériver.
    passeport = user.passport
    if not (passeport and (passeport.cni_recto_url or passeport.passport_url)):
        if approuve:
            raise erreur_champ("approuve", "piece_absente", "Aucune pièce d'identité déposée")
        # Refus sans pièce : un drapeau `cni_uploaded` orphelin laisse le
        # compte dans la file d'attente. On la vide en remettant les drapeaux
        # à faux, sans notifier le rejet d'une pièce qui n'existe pas.
        user.cni_uploaded = False
        user.cni_verified = False
        if passeport:
            passeport.docs_uploaded = False
        user.update_trust_level()
        if passeport:
            passeport.calculate_score()
        dp.consigner(current_user, user.id, "identite", "classee",
                     corps.motif or "Aucune pièce déposée")
        db.session.commit()
        return jsonify({"message": "Aucune pièce déposée : demande retirée de la file",
                        "trust_level": user.trust_level, "badge": user.badge}), 200

    user.cni_verified = bool(approuve)
    # Politique de confidentialité §7 : la pièce est supprimée dès la décision,
    # qu'elle soit validée ou refusée. Seul le résultat (`cni_verified`) et
    # le journal `verifications` en gardent la trace.
    a_supprimer = dp.planifier_suppression(dp.retirer_pieces_identite(passeport),
                                           "decision_identite")
    # Validée : le dépôt reste acquis (score, file d'attente) sans le fichier.
    # Refusée : l'utilisateur doit en redéposer une.
    user.cni_uploaded = bool(approuve)
    passeport.docs_uploaded = bool(approuve)
    dp.consigner(current_user, user.id, "identite",
                 "approuvee" if approuve else "refusee", corps.motif)

    ancien = user.trust_level or 0
    nouveau = user.update_trust_level()
    passeport.calculate_score()

    if approuve and nouveau > ancien:
        niveau = TRUST_LEVELS[nouveau]
        notify.niveau_atteint(user.id, nouveau, niveau["label"], niveau["debloque"])
    elif not approuve:
        notify.notifier(
            user.id, "niveau_confiance", "Pièce d'identité refusée",
            corps.motif or "Le document fourni n'est pas exploitable. "
                                 "Merci d'en téléverser un nouveau, bien lisible.",
            "/tenant/profile",
        )

    db.session.commit()
    dp.executer_suppressions(a_supprimer)

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
        {
            "passport": p.to_dict(),
            "user": p.tenant.to_dict(public=False) if p.tenant else None,
            "pieces": _liens_pieces(p),
        }
        for p in passports
    ]), 200


@admin_bp.route("/verify-revenus/<string:user_id>", methods=["PUT"])
@admin_required
@valider_corps(Decision)
def verify_revenus(current_user, user_id, corps):
    user = User.query.get_or_404(user_id)
    if not user.passport:
        return jsonify({"error": "Ce locataire n'a pas de passeport"}), 404
    # R1 bis : pas de décision sans justificatif déposé.
    if not user.passport.income_doc_url:
        raise erreur_champ("approuve", "piece_absente", "Aucun justificatif de revenus déposé")

    approuve = corps.approuve

    user.passport.income_verified = bool(approuve)
    user.income_verified = bool(approuve)
    # Supprimé dès la décision, comme les pièces d'identité.
    a_supprimer = dp.planifier_suppression(dp.retirer_justificatif_revenus(user.passport),
                                           "decision_revenus")
    dp.consigner(current_user, user.id, "revenus",
                 "approuvee" if approuve else "refusee", corps.motif)

    ancien = user.trust_level or 0
    nouveau = user.update_trust_level()
    user.passport.calculate_score()

    if approuve and nouveau > ancien:
        niveau = TRUST_LEVELS[nouveau]
        notify.niveau_atteint(user.id, nouveau, niveau["label"], niveau["debloque"])
    elif not approuve:
        notify.notifier(
            user.id, "niveau_confiance", "Justificatif de revenus refusé",
            corps.motif or "Le justificatif fourni n'a pas pu être validé.",
            "/tenant/profile",
        )

    db.session.commit()
    dp.executer_suppressions(a_supprimer)
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
            **a.to_dict(avec_adresse=True),
            # Liens temporaires : les pièces de propriété ne sont pas publiques.
            # `None` quand la signature échoue, comme pour les passeports.
            "documents": [stockage.url_signee(u) for u in a.documents],
            "demande_le": (a.certification_requested_at.isoformat()
                           if a.certification_requested_at else None),
        }
        for a in annonces
    ]), 200


@admin_bp.route("/certifier/<string:listing_id>", methods=["PUT"])
@admin_required
@valider_corps(Decision)
def certifier_annonce(current_user, listing_id, corps):
    """Accorde ou refuse le badge « Annonce Certifiée »."""
    listing = Listing.query.get_or_404(listing_id)
    approuve = corps.approuve
    motif = corps.motif or None

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

    # Les pièces de propriété restent (question ouverte à Kamano) : la
    # politique de confidentialité ne fixe pas leur durée, et après un refus
    # le bailleur complète son dossier au lieu de tout redéposer.
    dp.consigner(current_user, listing.id, "certification_annonce",
                 "approuvee" if approuve else "refusee", motif)
    notify.certification_traitee(
        listing.landlord_id, approuve, listing.title_fr, listing.id, motif
    )
    db.session.commit()

    return jsonify({
        "message": "Annonce certifiée" if approuve else "Certification refusée",
        "listing": listing.to_dict(avec_adresse=True),
    }), 200


# ─── Remboursements ──────────────────────────────────────────
# Décision de Kamano (16/10/2026) : un admin rembourse à la main depuis le
# back-office CinetPay, puis clôt le paiement ici.

def _motif_remboursement(paiement):
    if paiement.type_paiement in PAIEMENTS_HORS_PLATEFORME:
        return "hors_plateforme"
    return "doublon"


@admin_bp.route("/paiements-a-rembourser", methods=["GET"])
@admin_required
def paiements_a_rembourser(current_user):
    paiements = (Payment.query.filter_by(statut=A_REMBOURSER)
                 .order_by(Payment.updated_at.asc()).all())
    return jsonify([
        {
            **p.to_dict(),
            "motif": _motif_remboursement(p),
            "cinetpay_transaction_id": p.cinetpay_transaction_id,
            "payeur": p.user.to_dict() if p.user else None,
        }
        for p in paiements
    ]), 200


@admin_bp.route("/paiements/<string:payment_id>/rembourse", methods=["PUT"])
@admin_required
@valider_corps(Remboursement)
def marquer_rembourse(current_user, payment_id, corps):
    """Clôt un paiement « à rembourser » une fois l'argent rendu au payeur."""
    paiement = db.session.execute(
        select(Payment).where(Payment.id == payment_id)
        .with_for_update().execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if not paiement:
        return jsonify({"error": "Paiement introuvable"}), 404
    if paiement.statut != A_REMBOURSER:
        return jsonify({"error": "Ce paiement n'est pas à rembourser"}), 409

    paiement.statut = REMBOURSE
    current_app.logger.info("Paiement %s remboursé par %s (réf. %s)", paiement.id,
                            current_user.id, corps.reference_remboursement or "—")
    notify.paiement_rembourse(paiement)
    db.session.commit()
    return jsonify({"message": "Paiement marqué remboursé", "paiement": paiement.to_dict()}), 200


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
@valider_corps(StatutCompte)
def basculer_statut(current_user, user_id, corps):
    """Active ou désactive un compte (fraude avérée, demande de l'utilisateur…)."""
    user = User.query.get_or_404(user_id)
    if user.id == current_user.id:
        return jsonify({"error": "Vous ne pouvez pas désactiver votre propre compte"}), 400

    actif = (not user.is_active) if corps.is_active is None else corps.is_active
    if actif and user.supprime_le:
        # Ses données ont été effacées à sa demande : le réactiver rendrait un
        # compte vide, sans titulaire joignable.
        return jsonify({"error": "Ce compte a été supprimé par son titulaire : "
                                 "il ne peut pas être réactivé"}), 409
    if actif != user.is_active:
        dp.consigner(current_user, user.id, "statut_compte",
                     "activation" if actif else "desactivation")
    user.is_active = actif
    if not user.is_active:
        # Les jetons déjà émis sont révoqués : sans cela, un compte désactivé
        # pour fraude gardait l'accès aux routes qui ne relisent pas
        # `is_active`. Une réactivation ne les ressuscite pas.
        user.revoquer_jetons()
    db.session.commit()

    return jsonify({"message": "Compte activé" if user.is_active else "Compte désactivé",
                    "user": user.to_dict(public=False)}), 200
