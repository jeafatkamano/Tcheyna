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
# Codes demandés par un même compte sur 24 h glissantes, quel que soit le
# numéro : sans ce plafond, un compte qui change de numéro à chaque appel
# enverrait un SMS par minute (~1 440 par jour). Même valeur que par numéro,
# à ajuster selon l'usage réel (numéro mal saisi puis corrigé, etc.).
OTP_MAX_PAR_COMPTE_PAR_JOUR = 5
# Plafond global : codes envoyés tous comptes et numéros confondus, sur une
# heure et sur 24 h glissantes. Les quotas ci-dessus ne bornent pas une
# attaque menée avec des comptes jetables vers des numéros surtaxés (« SMS
# pumping ») : ce plafond borne la perte sur le solde Africa's Talking.
# Compté en base, comme les quotas. Surchargeable par `app.config` sous le
# même nom ; valeurs justifiées dans la PR du lot 1.21.
OTP_PLAFOND_GLOBAL_PAR_HEURE = 100
OTP_PLAFOND_GLOBAL_PAR_JOUR = 500
# Part du plafond à partir de laquelle chaque envoi accepté laisse un
# avertissement dans les logs.
OTP_PLAFOND_GLOBAL_SEUIL_ALERTE = 0.8
OTP_ANTISPAM_SECONDES = 60

# Limites de débit (R7). Connexion : seuls les échecs comptent, par couple
# IP + e-mail ; une connexion réussie ne consomme rien. Inscription : toutes
# les réponses comptent, ce qui freine aussi l'énumération d'e-mails (409).
LIMITE_CONNEXION = "10 per 15 minutes"
LIMITE_INSCRIPTION = "5 per hour"
# Connexion, deux limites de plus (lot 1.12), elles aussi sur les seuls
# échecs. Par IP, tous e-mails confondus : borne la pulvérisation d'un même
# mot de passe sur des milliers d'e-mails, que le couple IP + e-mail laisse
# passer. Large, car un cybercafé ou un réseau mobile en CGNAT met beaucoup
# d'utilisateurs légitimes derrière une IP, et seuls leurs échecs comptent.
LIMITE_CONNEXION_PAR_IP = "50 per 15 minutes"
# Par e-mail, toutes IP confondues : borne la force brute répartie sur
# beaucoup d'IP contre un compte. Revers : un tiers peut épuiser ce quota
# avec de faux mots de passe et bloquer le titulaire jusqu'à une heure après
# son dernier essai ; il lui faut au moins trois IP pour le faire en moins de
# 45 minutes (le couple IP + e-mail l'arrête à 10 échecs par IP).
LIMITE_CONNEXION_PAR_EMAIL = "30 per hour"
# Changement de mot de passe, par compte (toutes les réponses) : l'ancien
# mot de passe y est vérifié, et un jeton volé ne doit pas permettre de le
# deviner hors des limites de /auth/login.
LIMITE_MOT_DE_PASSE = "5 per hour"


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


# Empreinte d'un mot de passe aléatoire, calculée une fois au chargement avec
# la même méthode que les vrais hachages : un e-mail inconnu coûte alors le
# même temps de vérification qu'un compte existant, et la durée de la réponse
# ne révèle pas quels e-mails sont inscrits.
HASH_FACTICE = generate_password_hash(secrets.token_hex(16))


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


def _email_saisi():
    """E-mail du corps de la connexion, normalisé comme le compare la route
    (espaces retirés, minuscules). Relu du corps brut : le schéma n'est pas
    encore passé. Vide si le corps est illisible."""
    corps = request.get_json(silent=True)
    email = corps.get("email") if isinstance(corps, dict) else None
    return email.strip().lower() if isinstance(email, str) else ""


def _cle_connexion_email():
    """Clé de la limite par e-mail, toutes IP confondues. Le préfixe la
    distingue d'une clé par IP. Un corps sans e-mail partage la clé
    « email: », sans effet : le schéma le refuse (422), qui ne compte pas."""
    return f"email:{_email_saisi()}"


def _echec_connexion(reponse):
    """Seules les connexions refusées consomment les limites de connexion :
    identifiants incorrects (401) ou compte désactivé (403)."""
    return reponse.status_code in (401, 403)


def _cle_compte():
    """Clé par compte connecté (identifiant du jeton déjà vérifié), et non
    par IP : deux comptes derrière la même IP ont chacun leur quota."""
    return f"compte:{get_jwt_identity()}"


def _cle_connexion():
    """Clé de la limite de connexion : IP + e-mail saisi. L'e-mail est relu
    du corps brut (le schéma n'est pas encore passé) ; un corps illisible
    donne une clé par IP seule."""
    return f"{get_remote_address()}|{_email_saisi()}"


def masquer_numero(phone):
    """« +224…52 » : quatre premiers caractères (l'indicatif, pour repérer
    une destination anormale) et deux derniers chiffres. Le numéro complet,
    donnée personnelle, n'a rien à faire dans les logs."""
    phone = phone or ""
    if len(phone) <= 6:
        return "…"
    return f"{phone[:4]}…{phone[-2:]}"


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
        # Le message d'erreur du fournisseur peut reprendre le destinataire,
        # voire le texte du SMS : numéro et code y sont masqués aussi.
        masque = masquer_numero(phone)
        detail = str(exc)
        for secret, remplacement in ((phone, masque), (code, "******")):
            if secret:
                detail = detail.replace(secret, remplacement)
        current_app.logger.error("Échec envoi OTP à %s : %s", masque, detail)
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
# Trois limites, chacune sur les seuls échecs : couple IP + e-mail, IP seule
# (`get_remote_address`, l'IP rendue fiable par ProxyFix), e-mail seul.
@limiter.limit(LIMITE_CONNEXION, key_func=_cle_connexion, deduct_when=_echec_connexion)
@limiter.limit(LIMITE_CONNEXION_PAR_IP, key_func=get_remote_address,
               deduct_when=_echec_connexion)
@limiter.limit(LIMITE_CONNEXION_PAR_EMAIL, key_func=_cle_connexion_email,
               deduct_when=_echec_connexion)
@valider_corps(Connexion)
def login(corps):
    user = User.query.filter_by(email=corps.email.lower()).first()
    if not user:
        check_password_hash(HASH_FACTICE, corps.password)  # temps égalisé, résultat ignoré
        return jsonify({"error": "Identifiants incorrects"}), 401
    if not check_password_hash(user.password_hash, corps.password):
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


# ─── POST /api/auth/logout ────────────────────────────────────

@auth_bp.route("/logout", methods=["POST"])
# Jeton d'accès ou de rafraîchissement : le second, valable 30 jours, est
# celui qu'il importe le plus de révoquer, et il reste le seul utilisable
# quand le jeton d'accès a expiré. Un jeton déjà révoqué est refusé (401)
# par `jeton_revoque`. Pas de limite de débit : chaque déconnexion révoque
# le jeton qui l'a demandée, et en obtenir un autre passe par /auth/login.
@jwt_required(verify_type=False)
def logout():
    user = db.session.get(User, get_jwt_identity())
    if user is None:
        return jsonify({"error": "Utilisateur introuvable", "details": []}), 401
    # `token_version` est propre au compte : la déconnexion ferme toutes ses
    # sessions, sur tous les appareils, et non le seul appareil appelant.
    user.revoquer_jetons()
    db.session.commit()
    return jsonify({"message": "Déconnexion réussie"}), 200


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
# Sous l'authentification : le jeton est vérifié quand la clé (le compte) est
# calculée, et une requête sans jeton valide ne consomme rien.
@limiter.limit(LIMITE_MOT_DE_PASSE, key_func=_cle_compte)
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

def _plafond_global(maintenant):
    """Compte les codes envoyés, tous comptes et numéros confondus, dans
    chaque fenêtre du plafond global. Retourne `(refus, fenetres)` : `refus`
    est le 429 à renvoyer si une fenêtre est pleine, sinon None ; `fenetres`
    sert ensuite à `_alerter_plafond_global`.

    Concurrence : le verrou de `send_otp` porte sur la ligne du compte et
    n'ordonne que les envois d'un même compte. Deux comptes servis au même
    instant par deux workers peuvent lire le même total, juste sous le
    plafond, et envoyer tous les deux. Le total d'une fenêtre reste donc
    inférieur à plafond + (demandes traitées simultanément - 1) : avec les
    2 workers gunicorn synchrones de render.yaml, un code de trop au plus par
    instance, le temps entre ce comptage et le commit n'étant que de quelques
    millisecondes. Un plafond exact demanderait un verrou global
    (`pg_advisory_xact_lock`) qui sérialiserait tous les envois du site : ce
    léger dépassement, borné, est préféré.
    """
    fenetres = []
    attentes = []
    for libelle, duree, nom, defaut in (
        ("sur une heure", timedelta(hours=1), "OTP_PLAFOND_GLOBAL_PAR_HEURE",
         OTP_PLAFOND_GLOBAL_PAR_HEURE),
        ("sur 24 h", timedelta(hours=24), "OTP_PLAFOND_GLOBAL_PAR_JOUR",
         OTP_PLAFOND_GLOBAL_PAR_JOUR),
    ):
        plafond = int(current_app.config.get(nom, defaut))
        recents = OTPCode.query.filter(OTPCode.created_at >= maintenant - duree)
        envois = recents.count()
        fenetres.append((libelle, plafond, envois))
        if envois >= plafond:
            # Comme pour les quotas, une place se libère quand l'envoi de
            # rang `envois - plafond` (du plus ancien) sort de la fenêtre.
            libere = (recents.order_by(OTPCode.created_at.asc())
                      .offset(envois - plafond).first()) if plafond > 0 else None
            fin = libere.created_at + duree if libere else maintenant + duree
            attentes.append((fin - maintenant).total_seconds())
    if attentes:
        # Toutes les fenêtres pleines doivent se libérer : la plus longue
        # attente fait foi. Le message ne dit rien du mécanisme.
        attente = max(attentes)
        return reponse_trop_de_requetes(
            "Le service d'envoi de codes est momentanément saturé. "
            f"Réessayez dans {formater_delai(attente)}.", attente), fenetres
    return None, fenetres


def _alerter_plafond_global(fenetres):
    """Journalise l'approche puis l'atteinte du plafond global, une fois un
    envoi enregistré (d'où `envois + 1`). Un log par envoi accepté au-delà du
    seuil : le volume reste borné par le plafond lui-même, et aucun
    franchissement n'est manqué sous concurrence. Rien sur les refus, qu'un
    attaquant peut répéter sans limite. Aucun numéro, seulement des totaux."""
    for libelle, plafond, envois in fenetres:
        total = envois + 1
        if total >= plafond:
            current_app.logger.error(
                "Plafond global des SMS d'OTP atteint : %d codes envoyés %s (plafond %d). "
                "Les demandes suivantes sont refusées (429) jusqu'à ce que la fenêtre "
                "se libère. Vérifiez les destinations et le solde dans le tableau de "
                "bord Africa's Talking.", total, libelle, plafond)
        elif total >= plafond * OTP_PLAFOND_GLOBAL_SEUIL_ALERTE:
            current_app.logger.warning(
                "Plafond global des SMS d'OTP bientôt atteint : %d codes envoyés %s "
                "(plafond %d).", total, libelle, plafond)


@auth_bp.route("/send-otp", methods=["POST"])
@current_user_required
@valider_corps(EnvoiOTP)
def send_otp(current_user, corps):
    # Verrou sur la ligne du compte (PostgreSQL ; sans effet sur SQLite) : deux
    # envois simultanés du même compte sont traités l'un après l'autre, ce qui
    # rend exacts l'anti-spam, les quotas et le numéro enregistré.
    current_user = (User.query.filter_by(id=current_user.id)
                    .with_for_update().populate_existing().one())

    # Permet de renseigner (ou corriger) le numéro au moment de la vérification
    phone = current_user.phone
    if corps.phone:
        phone = normaliser_phone(corps.phone)
        if not PHONE_RE.match(phone or ""):
            return jsonify({"error": "Numéro de téléphone invalide"}), 400

    if not phone:
        return jsonify({"error": "Aucun numéro de téléphone associé au compte"}), 400

    if current_user.phone_verified:
        return jsonify({"message": "Téléphone déjà vérifié",
                        "trust_level": current_user.trust_level}), 200

    maintenant = datetime.utcnow()
    depuis = maintenant - timedelta(hours=24)

    # Anti-spam : un code toutes les 60 secondes au maximum
    dernier = (OTPCode.query.filter_by(user_id=current_user.id)
               .order_by(OTPCode.created_at.desc()).first())
    if dernier and (maintenant - dernier.created_at) < timedelta(seconds=OTP_ANTISPAM_SECONDES):
        attente = OTP_ANTISPAM_SECONDES - (maintenant - dernier.created_at).total_seconds()
        return reponse_trop_de_requetes(
            f"Patientez {formater_delai(attente)} avant de redemander un code", attente)

    def quota_atteint(filtre, maximum, message):
        """429 si `maximum` envois correspondent au filtre sur 24 h ; une
        place se libère quand le plus ancien sort de la fenêtre."""
        envois = (OTPCode.query.filter(filtre, OTPCode.created_at >= depuis)
                  .order_by(OTPCode.created_at.asc()).all())
        if len(envois) < maximum:
            return None
        attente = (envois[-maximum].created_at + timedelta(hours=24) - maintenant).total_seconds()
        return reponse_trop_de_requetes(
            f"{message} Réessayez dans {formater_delai(attente)}.", attente)

    # Quota par compte, puis par numéro (R7) : changer de numéro ne contourne
    # pas le premier, changer de compte ne remet pas le second à zéro ; chaque
    # SMS est facturé.
    refus = (quota_atteint(OTPCode.user_id == current_user.id, OTP_MAX_PAR_COMPTE_PAR_JOUR,
                           f"{OTP_MAX_PAR_COMPTE_PAR_JOUR} codes maximum par jour pour ce compte.")
             or quota_atteint(OTPCode.phone == phone, OTP_MAX_PAR_JOUR,
                              f"{OTP_MAX_PAR_JOUR} codes maximum par jour pour ce numéro."))
    if refus:
        return refus

    # Plafond global, après les quotas : un refus propre au compte ou au
    # numéro garde son message précis. Avant toute écriture et tout envoi.
    refus, fenetres = _plafond_global(maintenant)
    if refus:
        return refus

    # Après l'anti-spam et les quotas : tester si un numéro est inscrit
    # (énumération) est ainsi borné par le quota du compte.
    if phone != current_user.phone:
        existant = User.query.filter_by(phone=phone).first()
        if existant and existant.id != current_user.id:
            return jsonify({"error": "Ce numéro est déjà utilisé par un autre compte"}), 409
        current_user.phone = phone

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
    _alerter_plafond_global(fenetres)

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

    maintenant = datetime.utcnow()
    if otp.expires_at < maintenant:
        return jsonify({"error": "Code expiré. Demandez un nouveau code."}), 400

    # L'essai est décompté AVANT la comparaison, par un UPDATE conditionnel :
    # deux requêtes simultanées (deux workers) ne peuvent pas dépasser
    # OTP_MAX_ATTEMPTS comparaisons, ce que permettait la lecture puis
    # l'écriture de `attempts` en Python. Le code doit encore être valide au
    # moment de l'UPDATE : un send-otp concurrent a pu le remplacer depuis la
    # lecture ci-dessus.
    reserve = (OTPCode.query
               .filter(OTPCode.id == otp.id, OTPCode.attempts < OTP_MAX_ATTEMPTS,
                       OTPCode.is_used.is_(False), OTPCode.expires_at > maintenant)
               .update({OTPCode.attempts: OTPCode.attempts + 1}, synchronize_session=False))
    if not reserve:
        db.session.rollback()
        db.session.refresh(otp)
        if otp.is_used:
            return jsonify({"error": "Code déjà utilisé ou remplacé. Demandez un nouveau code.",
                            "details": []}), 400
        if otp.expires_at <= maintenant:
            return jsonify({"error": "Code expiré. Demandez un nouveau code.", "details": []}), 400
        OTPCode.query.filter_by(id=otp.id).update({"is_used": True}, synchronize_session=False)
        db.session.commit()
        return jsonify({"error": "Trop de tentatives. Demandez un nouveau code.", "details": []}), 429
    db.session.commit()

    # Comparaison à temps constant : la durée ne trahit pas le nombre de
    # caractères corrects.
    if not hmac.compare_digest(otp.code_hash, hacher_otp(otp.id, corps.code)):
        restantes = max(0, OTP_MAX_ATTEMPTS - otp.attempts)
        return jsonify({"error": f"Code incorrect ({restantes} tentative(s) restante(s))"}), 400

    # Consommation atomique : un même code ne valide qu'une fois, même reçu
    # deux fois en parallèle.
    consomme = (OTPCode.query.filter(OTPCode.id == otp.id, OTPCode.is_used.is_(False))
                .update({OTPCode.is_used: True}, synchronize_session=False))
    db.session.commit()
    if consomme != 1:
        return jsonify({"error": "Code déjà utilisé ou remplacé. Demandez un nouveau code.",
                        "details": []}), 400

    # Le numéro vérifié est celui auquel le code a été ENVOYÉ : si le compte a
    # changé de numéro entre-temps (send-otp concurrent), l'UPDATE ne touche
    # aucune ligne et le nouveau numéro, jamais prouvé, reste non vérifié.
    verifie = (User.query.filter(User.id == current_user.id, User.phone == otp.phone)
               .update({User.phone_verified: True}, synchronize_session=False))
    if verifie != 1:
        db.session.rollback()
        return jsonify({"error": "Le numéro du compte a changé depuis l'envoi du code. "
                                 "Demandez un nouveau code.", "details": []}), 409
    db.session.refresh(current_user)
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
