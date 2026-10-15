"""
routes/auth.py — Inscription, connexion et vérification du téléphone.

La vérification par OTP SMS (Africa's Talking) est le premier palier du
Passeport Locataire : sans elle, l'utilisateur reste au niveau 0.
"""
import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    get_jwt_identity,
    jwt_required,
)
from flask_limiter.util import get_remote_address
from werkzeug.security import check_password_hash, generate_password_hash

from app import db, formater_delai, limiter, reponse_trop_de_requetes
from app.models import TRUST_LEVELS, OTPCode, TenantPassport, User, generate_uuid
from app.routes import current_user_required
from app.schemas import erreur_champ, valider_corps
from app.schemas.auth import (
    ChangementMotDePasse,
    Connexion,
    EnvoiOTP,
    Inscription,
    VerificationOTP,
)
from app.services import notifications as notify

auth_bp = Blueprint("auth", __name__)

PHONE_RE = re.compile(r"^\+?[0-9]{8,15}$")

OTP_TTL_MINUTES = 10
OTP_MAX_ATTEMPTS = 5
# Codes envoyés au même numéro sur 24 h glissantes, tous comptes confondus.
# Compté en base, et non par flask-limiter : chaque SMS est payé, le quota
# doit être exact entre workers et survivre aux redémarrages.
OTP_MAX_PAR_JOUR = 5
OTP_ANTISPAM_SECONDES = 60

# Limites de débit (R7). Connexion : seuls les échecs comptent, par couple
# IP + e-mail ; une connexion réussie ne consomme rien. Inscription : toutes
# les réponses comptent, ce qui freine aussi l'énumération d'e-mails (409).
LIMITE_CONNEXION = "10 per 15 minutes"
LIMITE_INSCRIPTION = "5 per hour"


# ─── Helpers ──────────────────────────────────────────────────

def normaliser_phone(phone):
    """Nettoie le numéro et préfixe la Guinée par défaut (+224)."""
    if not phone:
        return None
    cleaned = re.sub(r"[\s.\-()]", "", phone.strip())
    if cleaned.startswith("00"):
        cleaned = "+" + cleaned[2:]
    if not cleaned.startswith("+"):
        # 9 chiffres = numéro guinéen local (ex. 622529252)
        cleaned = "+224" + cleaned.lstrip("0")
    return cleaned


def generate_otp(length=6):
    # `secrets` et non `random` : le générateur de `random` (Mersenne Twister)
    # est prévisible à partir de ses sorties précédentes.
    return f"{secrets.randbelow(10 ** length):0{length}d}"


def _cle_otp():
    """Clé du HMAC : OTP_HMAC_KEY si elle est fournie, sinon dérivée de
    SECRET_KEY. La dérivation évite d'employer telle quelle, pour un second
    usage, la clé qui signe déjà les sessions Flask."""
    dediee = current_app.config.get("OTP_HMAC_KEY")
    if dediee:
        return dediee.encode()
    return hmac.new(current_app.config["SECRET_KEY"].encode(), b"tcheyna/otp/v1",
                    hashlib.sha256).digest()


def hacher_otp(otp_id, code):
    """HMAC-SHA256 du code, lié à la ligne qui le porte : la même empreinte
    ne peut pas être recopiée sur une autre ligne. Pas de scrypt : avec 10⁶
    codes possibles, un hachage lent n'empêche pas la force brute hors ligne
    et coûterait du CPU à chaque vérification ; c'est la clé, hors base, qui
    protège."""
    return hmac.new(_cle_otp(), f"{otp_id}:{code}".encode(), hashlib.sha256).hexdigest()


def _cle_connexion():
    """Clé de la limite de connexion : IP + e-mail saisi. L'e-mail est relu
    du corps brut (le schéma n'est pas encore passé) ; un corps illisible
    donne une clé par IP seule."""
    corps = request.get_json(silent=True)
    email = corps.get("email") if isinstance(corps, dict) else None
    email = email.strip().lower() if isinstance(email, str) else ""
    return f"{get_remote_address()}|{email}"


def send_sms_otp(phone, code):
    """Envoie l'OTP via Africa's Talking. Retourne False si l'envoi échoue —
    en développement, le code reste consultable dans la réponse de l'API."""
    api_key = current_app.config.get("AT_API_KEY")
    if not api_key:
        current_app.logger.warning("AT_API_KEY absent — SMS non envoyé (mode dev)")
        return False
    try:
        import africastalking

        africastalking.initialize(current_app.config["AT_USERNAME"], api_key)
        africastalking.SMS.send(
            f"[Tcheyna] Votre code de verification : {code}. Valable {OTP_TTL_MINUTES} minutes.",
            [phone],
            sender_id=current_app.config["AT_SENDER_ID"],
        )
        return True
    except Exception as exc:  # noqa: BLE001 — un échec SMS ne doit pas bloquer l'inscription
        current_app.logger.error("Échec envoi OTP à %s : %s", phone, exc)
        return False


def emettre_tokens(user):
    # `tv` : version des jetons du compte, contrôlée à chaque requête
    # (app/__init__.py, `jeton_revoque`).
    claims = {"tv": user.token_version}
    return {
        "access_token":  create_access_token(identity=user.id, additional_claims=claims),
        "refresh_token": create_refresh_token(identity=user.id, additional_claims=claims),
    }


# ─── POST /api/auth/register ──────────────────────────────────

@auth_bp.route("/register", methods=["POST"])
@limiter.limit(LIMITE_INSCRIPTION)
@valider_corps(Inscription)
def register(corps):
    email = corps.email
    if User.query.filter_by(email=email).first():
        return jsonify({"error": "Cette adresse e-mail est déjà utilisée"}), 409

    phone = normaliser_phone(corps.phone)
    if phone:
        if not PHONE_RE.match(phone):
            return jsonify({"error": "Numéro de téléphone invalide"}), 400
        if User.query.filter_by(phone=phone).first():
            return jsonify({"error": "Ce numéro de téléphone est déjà utilisé"}), 409

    user = User(
        email=email,
        password_hash=generate_password_hash(corps.password),
        full_name=corps.full_name,
        role=corps.role,
        phone=phone,
        pays=corps.pays,
        ville=corps.ville,
        quartier=corps.quartier,
        preferred_lang=corps.preferred_lang,
        trust_level=0,
    )
    db.session.add(user)
    db.session.flush()  # attribue l'id avant de créer le passeport

    # Le locataire dispose d'un passeport dès l'inscription : il n'a plus qu'à
    # le compléter, ce qui rend la progression de confiance visible tout de suite.
    if user.role == "tenant":
        passport = TenantPassport(tenant_id=user.id, devise="GNF")
        passport.calculate_score()
        db.session.add(passport)

    db.session.commit()

    return jsonify({
        "message": "Inscription réussie",
        "user": user.to_dict(public=False),
        **emettre_tokens(user),
    }), 201


# ─── POST /api/auth/login ─────────────────────────────────────

@auth_bp.route("/login", methods=["POST"])
# Le 429 tombe avant la vérification du mot de passe : une fois la limite
# atteinte, même le bon mot de passe est refusé jusqu'à la fin de la fenêtre.
@limiter.limit(LIMITE_CONNEXION, key_func=_cle_connexion,
               deduct_when=lambda reponse: reponse.status_code in (401, 403))
@valider_corps(Connexion)
def login(corps):
    user = User.query.filter_by(email=corps.email.lower()).first()
    if not user or not check_password_hash(user.password_hash, corps.password):
        return jsonify({"error": "Identifiants incorrects"}), 401

    if not user.is_active:
        return jsonify({"error": "Compte désactivé. Contactez le support."}), 403

    user.last_login_at = datetime.utcnow()
    db.session.commit()

    return jsonify({
        "message": "Connexion réussie",
        "user": user.to_dict(public=False),
        **emettre_tokens(user),
    }), 200


# ─── POST /api/auth/refresh ───────────────────────────────────

@auth_bp.route("/refresh", methods=["POST"])
@jwt_required(refresh=True)
def refresh():
    # La version du jeton est déjà contrôlée (`jeton_revoque`). Reste l'état
    # du compte : sans cette relecture, un compte désactivé obtenait encore
    # des jetons d'accès pendant 30 jours.
    user = db.session.get(User, get_jwt_identity())
    if user is None:
        return jsonify({"error": "Utilisateur introuvable", "details": []}), 401
    if not user.is_active:
        return jsonify({"error": "Compte désactivé. Contactez le support.", "details": []}), 403
    return jsonify({"access_token": create_access_token(
        identity=user.id, additional_claims={"tv": user.token_version})}), 200


# ─── GET /api/auth/me ─────────────────────────────────────────

@auth_bp.route("/me", methods=["GET"])
@current_user_required
def me(current_user):
    data = current_user.to_dict(public=False)
    data["niveau"] = TRUST_LEVELS[current_user.trust_level or 0]
    data["prochain_niveau"] = TRUST_LEVELS.get((current_user.trust_level or 0) + 1)
    return jsonify(data), 200


# ─── PUT /api/auth/password ───────────────────────────────────

@auth_bp.route("/password", methods=["PUT"])
@current_user_required
@valider_corps(ChangementMotDePasse)
def change_password(current_user, corps):
    if not check_password_hash(current_user.password_hash, corps.ancien_mot_de_passe):
        # 422 et non 401 : le client lit un 401 comme une session expirée, la
        # rafraîchit puis déconnecte l'utilisateur pour une simple faute de
        # frappe.
        raise erreur_champ("ancien_mot_de_passe", "mot_de_passe_incorrect",
                           "Ancien mot de passe incorrect")

    current_user.password_hash = generate_password_hash(corps.nouveau_mot_de_passe)
    # Un mot de passe se change souvent parce qu'il a fuité : les sessions
    # ouvertes ailleurs (y compris par un tiers) sont fermées. L'appareil
    # courant reçoit de nouveaux jetons et reste connecté.
    current_user.revoquer_jetons()
    db.session.commit()
    return jsonify({"message": "Mot de passe modifié", **emettre_tokens(current_user)}), 200


# ─── POST /api/auth/send-otp ─────────────────────────────────

@auth_bp.route("/send-otp", methods=["POST"])
@current_user_required
@valider_corps(EnvoiOTP)
def send_otp(current_user, corps):
    # Permet de renseigner (ou corriger) le numéro au moment de la vérification
    if corps.phone:
        phone = normaliser_phone(corps.phone)
        if not PHONE_RE.match(phone or ""):
            return jsonify({"error": "Numéro de téléphone invalide"}), 400
        existant = User.query.filter_by(phone=phone).first()
        if existant and existant.id != current_user.id:
            return jsonify({"error": "Ce numéro est déjà utilisé par un autre compte"}), 409
        current_user.phone = phone

    if not current_user.phone:
        return jsonify({"error": "Aucun numéro de téléphone associé au compte"}), 400

    if current_user.phone_verified:
        return jsonify({"message": "Téléphone déjà vérifié",
                        "trust_level": current_user.trust_level}), 200

    maintenant = datetime.utcnow()

    # Anti-spam : un code toutes les 60 secondes au maximum
    dernier = (OTPCode.query.filter_by(user_id=current_user.id)
               .order_by(OTPCode.created_at.desc()).first())
    if dernier and (maintenant - dernier.created_at) < timedelta(seconds=OTP_ANTISPAM_SECONDES):
        attente = OTP_ANTISPAM_SECONDES - (maintenant - dernier.created_at).total_seconds()
        return reponse_trop_de_requetes(
            f"Patientez {formater_delai(attente)} avant de redemander un code", attente)

    # Quota quotidien par numéro (R7) : changer de compte ne le remet pas à
    # zéro, chaque SMS est facturé.
    depuis = maintenant - timedelta(hours=24)
    envois = (OTPCode.query
              .filter(OTPCode.phone == current_user.phone, OTPCode.created_at >= depuis)
              .order_by(OTPCode.created_at.asc()).all())
    if len(envois) >= OTP_MAX_PAR_JOUR:
        # Une place se libère quand l'envoi le plus ancien de la fenêtre sort
        # des 24 h.
        attente = (envois[-OTP_MAX_PAR_JOUR].created_at + timedelta(hours=24)
                   - maintenant).total_seconds()
        return reponse_trop_de_requetes(
            f"{OTP_MAX_PAR_JOUR} codes maximum par jour pour ce numéro. "
            f"Réessayez dans {formater_delai(attente)}.", attente)

    OTPCode.query.filter_by(user_id=current_user.id, is_used=False).update({"is_used": True})

    code = generate_otp()
    # L'identifiant est fixé avant l'insertion : il entre dans l'empreinte.
    otp_id = generate_uuid()
    db.session.add(OTPCode(
        id=otp_id,
        user_id=current_user.id,
        code_hash=hacher_otp(otp_id, code),
        phone=current_user.phone,
        attempts=0,
        created_at=maintenant,
        expires_at=maintenant + timedelta(minutes=OTP_TTL_MINUTES),
    ))
    db.session.commit()

    envoye = send_sms_otp(current_user.phone, code)

    reponse = {
        "message": "Code envoyé par SMS" if envoye else "Code généré (SMS indisponible)",
        "phone": current_user.phone,
        "expire_dans": OTP_TTL_MINUTES * 60,
    }
    # En développement le SMS n'est pas envoyé : on expose le code pour tester.
    if not envoye and current_app.config.get("DEBUG"):
        reponse["debug_code"] = code

    return jsonify(reponse), 200


# ─── POST /api/auth/verify-otp ───────────────────────────────

@auth_bp.route("/verify-otp", methods=["POST"])
@current_user_required
@valider_corps(VerificationOTP)
def verify_otp(current_user, corps):
    otp = (OTPCode.query.filter_by(user_id=current_user.id, is_used=False)
           .order_by(OTPCode.created_at.desc()).first())

    # Une ligne sans empreinte date d'avant le lot 1.4 (code en clair) : elle
    # n'est pas acceptée, l'utilisateur redemande un code.
    if not otp or not otp.code_hash:
        return jsonify({"error": "Aucun code en attente. Demandez un nouveau code."}), 400

    if otp.expires_at < datetime.utcnow():
        return jsonify({"error": "Code expiré. Demandez un nouveau code."}), 400

    # L'essai est décompté AVANT la comparaison, par un UPDATE conditionnel :
    # deux requêtes simultanées (deux workers) ne peuvent pas dépasser
    # OTP_MAX_ATTEMPTS comparaisons, ce que permettait la lecture puis
    # l'écriture de `attempts` en Python.
    reserve = (OTPCode.query
               .filter(OTPCode.id == otp.id, OTPCode.attempts < OTP_MAX_ATTEMPTS)
               .update({OTPCode.attempts: OTPCode.attempts + 1}, synchronize_session=False))
    if not reserve:
        OTPCode.query.filter_by(id=otp.id).update({"is_used": True}, synchronize_session=False)
        db.session.commit()
        return jsonify({"error": "Trop de tentatives. Demandez un nouveau code.", "details": []}), 429
    db.session.commit()

    # Comparaison à temps constant : la durée ne trahit pas le nombre de
    # caractères corrects.
    if not hmac.compare_digest(otp.code_hash, hacher_otp(otp.id, corps.code)):
        restantes = max(0, OTP_MAX_ATTEMPTS - otp.attempts)
        return jsonify({"error": f"Code incorrect ({restantes} tentative(s) restante(s))"}), 400

    otp.is_used = True
    current_user.phone_verified = True
    ancien_niveau = current_user.trust_level or 0
    nouveau_niveau = current_user.update_trust_level()

    if nouveau_niveau > ancien_niveau:
        niveau = TRUST_LEVELS[nouveau_niveau]
        notify.niveau_atteint(current_user.id, nouveau_niveau,
                              niveau["label"], niveau["debloque"])

    # Le passeport intègre la vérification du téléphone dans son score
    if current_user.passport:
        current_user.passport.calculate_score()

    db.session.commit()

    return jsonify({
        "message": "Téléphone vérifié avec succès",
        "trust_level": current_user.trust_level,
        "badge": current_user.badge,
        "niveau": TRUST_LEVELS[current_user.trust_level],
    }), 200


# ─── GET /api/auth/niveaux ───────────────────────────────────

@auth_bp.route("/niveaux", methods=["GET"])
def niveaux():
    """Grille publique des niveaux de confiance (affichée à l'onboarding)."""
    return jsonify({
        "niveaux": [{"niveau": n, **info} for n, info in sorted(TRUST_LEVELS.items())]
    }), 200
