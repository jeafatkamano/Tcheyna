"""
routes/auth.py — Inscription, connexion et vérification du téléphone.

La vérification par OTP SMS (Africa's Talking) est le premier palier du
Passeport Locataire : sans elle, l'utilisateur reste au niveau 0.
"""
import random
import re
import string
from datetime import datetime, timedelta

from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    get_jwt_identity,
    jwt_required,
)
from werkzeug.security import check_password_hash, generate_password_hash

from app import db
from app.models import TRUST_LEVELS, OTPCode, TenantPassport, User
from app.routes import current_user_required
from app.services import notifications as notify

auth_bp = Blueprint("auth", __name__)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$")
PHONE_RE = re.compile(r"^\+?[0-9]{8,15}$")

OTP_TTL_MINUTES = 10
OTP_MAX_ATTEMPTS = 5


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
    return "".join(random.choices(string.digits, k=length))


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
    return {
        "access_token":  create_access_token(identity=user.id),
        "refresh_token": create_refresh_token(identity=user.id),
    }


# ─── POST /api/auth/register ──────────────────────────────────

@auth_bp.route("/register", methods=["POST"])
def register():
    data = request.get_json() or {}

    for field in ("email", "password", "full_name", "role"):
        if not data.get(field):
            return jsonify({"error": f"Champ requis : {field}"}), 400

    email = data["email"].lower().strip()
    if not EMAIL_RE.match(email):
        return jsonify({"error": "Adresse e-mail invalide"}), 400

    if len(data["password"]) < 8:
        return jsonify({"error": "Le mot de passe doit contenir au moins 8 caractères"}), 400

    if data["role"] not in ("tenant", "landlord", "agency"):
        return jsonify({"error": "Rôle invalide : tenant | landlord | agency"}), 400

    if User.query.filter_by(email=email).first():
        return jsonify({"error": "Cette adresse e-mail est déjà utilisée"}), 409

    phone = normaliser_phone(data.get("phone"))
    if phone:
        if not PHONE_RE.match(phone):
            return jsonify({"error": "Numéro de téléphone invalide"}), 400
        if User.query.filter_by(phone=phone).first():
            return jsonify({"error": "Ce numéro de téléphone est déjà utilisé"}), 409

    user = User(
        email=email,
        password_hash=generate_password_hash(data["password"]),
        full_name=data["full_name"].strip(),
        role=data["role"],
        phone=phone,
        pays=data.get("pays", "Guinée"),
        ville=data.get("ville", "Conakry"),
        quartier=data.get("quartier"),
        preferred_lang=data.get("preferred_lang", "fr"),
        trust_level=0,
    )
    db.session.add(user)
    db.session.flush()  # attribue l'id avant de créer le passeport

    # Le locataire dispose d'un passeport dès l'inscription : il n'a plus qu'à
    # le compléter, ce qui rend la progression de confiance visible tout de suite.
    if user.role == "tenant":
        passport = TenantPassport(tenant_id=user.id, devise=data.get("devise", "GNF"))
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
def login():
    data = request.get_json() or {}

    if not data.get("email") or not data.get("password"):
        return jsonify({"error": "E-mail et mot de passe requis"}), 400

    user = User.query.filter_by(email=data["email"].lower().strip()).first()
    if not user or not check_password_hash(user.password_hash, data["password"]):
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
    return jsonify({"access_token": create_access_token(identity=get_jwt_identity())}), 200


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
def change_password(current_user):
    data = request.get_json() or {}
    ancien, nouveau = data.get("ancien_mot_de_passe"), data.get("nouveau_mot_de_passe")

    if not ancien or not nouveau:
        return jsonify({"error": "Ancien et nouveau mot de passe requis"}), 400
    if not check_password_hash(current_user.password_hash, ancien):
        return jsonify({"error": "Ancien mot de passe incorrect"}), 401
    if len(nouveau) < 8:
        return jsonify({"error": "Le mot de passe doit contenir au moins 8 caractères"}), 400

    current_user.password_hash = generate_password_hash(nouveau)
    db.session.commit()
    return jsonify({"message": "Mot de passe modifié"}), 200


# ─── POST /api/auth/send-otp ─────────────────────────────────

@auth_bp.route("/send-otp", methods=["POST"])
@current_user_required
def send_otp(current_user):
    data = request.get_json() or {}

    # Permet de renseigner (ou corriger) le numéro au moment de la vérification
    if data.get("phone"):
        phone = normaliser_phone(data["phone"])
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

    # Anti-spam : un code toutes les 60 secondes au maximum
    dernier = (OTPCode.query.filter_by(user_id=current_user.id)
               .order_by(OTPCode.created_at.desc()).first())
    if dernier and (datetime.utcnow() - dernier.created_at) < timedelta(seconds=60):
        attente = 60 - int((datetime.utcnow() - dernier.created_at).total_seconds())
        return jsonify({"error": f"Patientez {attente} s avant de redemander un code"}), 429

    OTPCode.query.filter_by(user_id=current_user.id, is_used=False).update({"is_used": True})

    code = generate_otp()
    db.session.add(OTPCode(
        user_id=current_user.id,
        code=code,
        expires_at=datetime.utcnow() + timedelta(minutes=OTP_TTL_MINUTES),
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
def verify_otp(current_user):
    data = request.get_json() or {}
    if not data.get("code"):
        return jsonify({"error": "Code OTP requis"}), 400

    otp = (OTPCode.query.filter_by(user_id=current_user.id, is_used=False)
           .order_by(OTPCode.created_at.desc()).first())

    if not otp:
        return jsonify({"error": "Aucun code en attente. Demandez un nouveau code."}), 400

    if otp.expires_at < datetime.utcnow():
        return jsonify({"error": "Code expiré. Demandez un nouveau code."}), 400

    if otp.attempts >= OTP_MAX_ATTEMPTS:
        otp.is_used = True
        db.session.commit()
        return jsonify({"error": "Trop de tentatives. Demandez un nouveau code."}), 429

    if otp.code != data["code"].strip():
        otp.attempts += 1
        db.session.commit()
        restantes = OTP_MAX_ATTEMPTS - otp.attempts
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
