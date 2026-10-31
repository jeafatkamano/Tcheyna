"""
sms.py — Envoi des SMS (codes OTP) par le premier fournisseur qui réussit.

Fournisseurs, dans l'ordre (lot 1.27, 31/10/2026) :
  1. Nimba SMS — agrégateur guinéen, tous opérateurs (Orange, MTN, Cellcom),
     paiement local. Variables : NIMBA_SERVICE_ID, NIMBA_SECRET_TOKEN,
     NIMBA_SENDER_NAME (nom d'expéditeur validé par Nimba).
  2. Orange SMS API Guinée — secours, opérateur officiel. Variables :
     ORANGE_SMS_AUTH_HEADER (en-tête « Basic … » fourni par Orange Developer),
     ORANGE_SMS_SENDER_NAME, ORANGE_SMS_SENDER_ADDRESS.
  3. Africa's Talking — gardé pour les pays qu'il couvre (Côte d'Ivoire,
     Ghana, Nigeria…). Il ne couvre PAS la Guinée. Variable : AT_API_KEY.

Un fournisseur sans ses variables est ignoré ; un fournisseur qui échoue
passe la main au suivant. `envoyer_sms` renvoie le nom du fournisseur qui a
réussi, ou None si aucun n'a pu envoyer.

Ni le numéro ni le texte (qui contient le code) n'apparaissent jamais en
clair dans les journaux : seul un numéro masqué y figure.
"""
import time

import requests
from flask import current_app

DELAI_RESEAU = 15  # secondes, par appel au fournisseur


class EchecFournisseur(Exception):
    """Le fournisseur a refusé ou n'a pas pu traiter l'envoi."""


# ─── Utilitaires ─────────────────────────────────────────────

def masquer_numero(phone):
    """Numéro réduit à ses 4 premiers et 2 derniers caractères : un numéro,
    donnée personnelle, n'a rien à faire dans les journaux."""
    phone = phone or ""
    if len(phone) <= 6:
        return "…"
    return f"{phone[:4]}…{phone[-2:]}"


def _chiffres(phone):
    return "".join(c for c in (phone or "") if c.isdigit())


def numero_local_guinee(phone):
    """+224 622 52 92 52 → 622529252 : format attendu par Nimba SMS. Un
    numéro d'un autre pays est rendu tel quel (chiffres seuls)."""
    chiffres = _chiffres(phone)
    if chiffres.startswith("224") and len(chiffres) == 12:
        return chiffres[3:]
    return chiffres


def _expurger(message, remplacements):
    """Retire d'un message d'erreur de fournisseur ce qui ne doit pas être
    journalisé : texte du SMS, code, numéro. `remplacements` : paires
    (secret, remplaçant), appliquées dans l'ordre (le texte, qui contient le
    code, avant le code seul)."""
    message = str(message)
    for secret, remplacant in remplacements:
        if secret:
            message = message.replace(secret, remplacant)
    return message[:300]


# ─── Fournisseurs ────────────────────────────────────────────

def _nimba_configure(cfg):
    return bool(cfg.get("NIMBA_SERVICE_ID") and cfg.get("NIMBA_SECRET_TOKEN") and cfg.get("NIMBA_SENDER_NAME"))


def _envoyer_nimba(cfg, phone, texte):
    url = f"{cfg.get('NIMBA_BASE_URL', 'https://api.nimbasms.com/v1').rstrip('/')}/messages"
    try:
        reponse = requests.post(
            url,
            auth=(cfg["NIMBA_SERVICE_ID"], cfg["NIMBA_SECRET_TOKEN"]),
            json={
                "to": [numero_local_guinee(phone)],
                "sender_name": cfg["NIMBA_SENDER_NAME"],
                "message": texte,
                "channel": "sms",
            },
            timeout=DELAI_RESEAU,
        )
    except requests.RequestException as exc:
        raise EchecFournisseur(f"réseau : {exc.__class__.__name__}") from None
    if reponse.status_code not in (200, 201, 202):
        raise EchecFournisseur(f"HTTP {reponse.status_code} : {reponse.text}")


def _orange_configure(cfg):
    return bool(cfg.get("ORANGE_SMS_AUTH_HEADER"))


# Jeton OAuth d'Orange, valable une heure : gardé en mémoire du processus
# plutôt que redemandé à chaque SMS (Orange limite les demandes de jeton).
_jeton_orange = {"valeur": None, "expire": 0.0}


def _jeton_orange_valide(cfg):
    if _jeton_orange["valeur"] and _jeton_orange["expire"] > time.time() + 60:
        return _jeton_orange["valeur"]
    try:
        reponse = requests.post(
            "https://api.orange.com/oauth/v3/token",
            headers={"Authorization": cfg["ORANGE_SMS_AUTH_HEADER"], "Accept": "application/json"},
            data={"grant_type": "client_credentials"},
            timeout=DELAI_RESEAU,
        )
    except requests.RequestException as exc:
        raise EchecFournisseur(f"jeton, réseau : {exc.__class__.__name__}") from None
    if reponse.status_code != 200:
        raise EchecFournisseur(f"jeton, HTTP {reponse.status_code}")
    corps = reponse.json()
    _jeton_orange["valeur"] = corps["access_token"]
    _jeton_orange["expire"] = time.time() + int(corps.get("expires_in", 3600))
    return _jeton_orange["valeur"]


def _envoyer_orange(cfg, phone, texte):
    jeton = _jeton_orange_valide(cfg)
    expediteur = cfg.get("ORANGE_SMS_SENDER_ADDRESS") or "tel:+2240000"
    url = (
        "https://api.orange.com/smsmessaging/v1/outbound/"
        f"{requests.utils.quote(expediteur, safe='')}/requests"
    )
    message = {
        "address": f"tel:+{_chiffres(phone)}",
        "senderAddress": expediteur,
        "outboundSMSTextMessage": {"message": texte},
    }
    if cfg.get("ORANGE_SMS_SENDER_NAME"):
        message["senderName"] = cfg["ORANGE_SMS_SENDER_NAME"]
    try:
        reponse = requests.post(
            url,
            headers={"Authorization": f"Bearer {jeton}", "Content-Type": "application/json"},
            json={"outboundSMSMessageRequest": message},
            timeout=DELAI_RESEAU,
        )
    except requests.RequestException as exc:
        raise EchecFournisseur(f"réseau : {exc.__class__.__name__}") from None
    if reponse.status_code == 401:
        _jeton_orange["valeur"] = None  # jeton révoqué : le prochain envoi en redemande un
    if reponse.status_code not in (200, 201):
        raise EchecFournisseur(f"HTTP {reponse.status_code} : {reponse.text}")


def _africastalking_configure(cfg):
    return bool(cfg.get("AT_API_KEY"))


def _envoyer_africastalking(cfg, phone, texte):
    import africastalking

    africastalking.initialize(cfg["AT_USERNAME"], cfg["AT_API_KEY"])
    try:
        africastalking.SMS.send(texte, [phone], sender_id=cfg["AT_SENDER_ID"])
    except Exception as exc:  # noqa: BLE001 — le SDK lève des exceptions de toute nature
        raise EchecFournisseur(str(exc)) from None


FOURNISSEURS = (
    ("nimba", _nimba_configure, _envoyer_nimba),
    ("orange", _orange_configure, _envoyer_orange),
    ("africastalking", _africastalking_configure, _envoyer_africastalking),
)


# ─── API du module ───────────────────────────────────────────

def fournisseurs_configures():
    """Noms des fournisseurs dont les variables sont renseignées, dans l'ordre d'essai."""
    cfg = current_app.config
    return [nom for nom, configure, _ in FOURNISSEURS if configure(cfg)]


def envoyer_sms(phone, texte, code=None):
    """Envoie `texte` à `phone` par le premier fournisseur qui réussit.

    Renvoie le nom de ce fournisseur, ou None si aucun n'est configuré ou si
    tous ont échoué (chaque échec est journalisé, numéro et code masqués)."""
    cfg = current_app.config
    masque = masquer_numero(phone)
    configures = [(nom, envoyer) for nom, configure, envoyer in FOURNISSEURS if configure(cfg)]
    if not configures:
        current_app.logger.warning("Aucun fournisseur SMS configuré — SMS non envoyé à %s", masque)
        return None
    for nom, envoyer in configures:
        try:
            envoyer(cfg, phone, texte)
        except EchecFournisseur as exc:
            detail = _expurger(exc, [
                (texte, "«texte du SMS»"), (code, "******"),
                (phone, masque), (_chiffres(phone), masque), (numero_local_guinee(phone), masque),
            ])
            current_app.logger.error("Échec envoi OTP via %s à %s : %s", nom, masque, detail)
            continue
        current_app.logger.info("SMS envoyé via %s à %s", nom, masque)
        return nom
    return None
