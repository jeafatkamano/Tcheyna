"""Fournisseurs SMS (lot 1.27) : Nimba SMS, Orange en secours, Africa's
Talking ; et refus explicite (503) en production quand rien ne part.
Aucun appel réseau réel : `requests.post` est remplacé."""
import pytest

from app.models import OTPCode
from app.services import sms


class Reponse:
    def __init__(self, status, corps=None, texte=""):
        self.status_code = status
        self._corps = corps or {}
        self.text = texte

    def json(self):
        return self._corps


@pytest.fixture
def appels(monkeypatch):
    """Remplace requests.post : chaque appel est noté, la réponse vient de la file `reponses`."""
    journal = {"appels": [], "reponses": []}

    def faux_post(url, **kwargs):
        journal["appels"].append((url, kwargs))
        reponse = journal["reponses"].pop(0)
        if isinstance(reponse, Exception):
            raise reponse
        return reponse

    monkeypatch.setattr(sms.requests, "post", faux_post)
    sms._jeton_orange.update(valeur=None, expire=0.0)
    return journal


def configurer_nimba(app):
    app.config.update(NIMBA_SERVICE_ID="sid-test", NIMBA_SECRET_TOKEN="secret-test", NIMBA_SENDER_NAME="TCHEYNA")


def configurer_orange(app):
    app.config.update(ORANGE_SMS_AUTH_HEADER="Basic dGVzdDp0ZXN0", ORANGE_SMS_SENDER_NAME="TCHEYNA")


def test_numero_local_guinee():
    assert sms.numero_local_guinee("+224 622 52 92 52") == "622529252"
    assert sms.numero_local_guinee("+2250707070707") == "2250707070707"


def test_aucun_fournisseur(app):
    assert sms.fournisseurs_configures() == []
    assert sms.envoyer_sms("+224622529252", "bonjour") is None


def test_nimba_format_et_identifiants(app, appels):
    configurer_nimba(app)
    appels["reponses"] = [Reponse(201)]
    assert sms.envoyer_sms("+224622529252", "Votre code : 123456", code="123456") == "nimba"
    url, kwargs = appels["appels"][0]
    assert url == "https://api.nimbasms.com/v1/messages"
    assert kwargs["auth"] == ("sid-test", "secret-test")
    assert kwargs["json"] == {
        "to": ["622529252"], "sender_name": "TCHEYNA", "message": "Votre code : 123456", "channel": "sms",
    }
    assert kwargs["timeout"] == sms.DELAI_RESEAU


def test_nimba_echoue_orange_prend_le_relais(app, appels, caplog):
    configurer_nimba(app)
    configurer_orange(app)
    appels["reponses"] = [
        Reponse(402, texte="Solde insuffisant pour 622529252 : Votre code : 123456"),
        Reponse(200, {"access_token": "jeton-o", "expires_in": 3600}),
        Reponse(201),
    ]
    assert sms.envoyer_sms("+224622529252", "Votre code : 123456", code="123456") == "orange"
    jeton_url, jeton = appels["appels"][1]
    assert jeton_url == "https://api.orange.com/oauth/v3/token"
    assert jeton["headers"]["Authorization"] == "Basic dGVzdDp0ZXN0"
    url, kwargs = appels["appels"][2]
    assert url == "https://api.orange.com/smsmessaging/v1/outbound/tel%3A%2B2240000/requests"
    assert kwargs["headers"]["Authorization"] == "Bearer jeton-o"
    message = kwargs["json"]["outboundSMSMessageRequest"]
    assert message["address"] == "tel:+224622529252"
    assert message["senderAddress"] == "tel:+2240000"
    assert message["senderName"] == "TCHEYNA"
    # L'échec de Nimba est journalisé sans numéro ni code.
    echec = next(r.getMessage() for r in caplog.records if "via nimba" in r.getMessage())
    assert "622529252" not in echec and "123456" not in echec
    assert "HTTP 402" in echec


def test_jeton_orange_reutilise(app, appels):
    configurer_orange(app)
    appels["reponses"] = [Reponse(200, {"access_token": "j1", "expires_in": 3600}), Reponse(201), Reponse(201)]
    assert sms.envoyer_sms("+224622529252", "a") == "orange"
    assert sms.envoyer_sms("+224622529252", "b") == "orange"
    assert [u for u, _ in appels["appels"]].count("https://api.orange.com/oauth/v3/token") == 1


def test_erreur_reseau_tous_echouent(app, appels):
    configurer_nimba(app)
    appels["reponses"] = [sms.requests.ConnectionError("hors ligne")]
    assert sms.envoyer_sms("+224622529252", "a") is None


def test_ordre_des_fournisseurs(app):
    app.config["AT_API_KEY"] = "cle"
    configurer_orange(app)
    configurer_nimba(app)
    assert sms.fournisseurs_configures() == ["nimba", "orange", "africastalking"]


# ─── Routes ─────────────────────────────────────────────────

def test_send_otp_503_en_production_sans_fournisseur(app, client, fabrique, entetes):
    app.config["SMS_OBLIGATOIRE"] = True
    user = fabrique.locataire(niveau=0)
    reponse = client.post("/api/auth/send-otp", headers=entetes(user), json={})
    assert reponse.status_code == 503
    assert "indisponible" in reponse.get_json()["error"]
    # Le code que personne n'a reçu est annulé.
    assert OTPCode.query.filter_by(user_id=user.id, is_used=False).count() == 0


def test_send_otp_200_quand_nimba_envoie(app, client, fabrique, entetes, appels):
    app.config["SMS_OBLIGATOIRE"] = True
    configurer_nimba(app)
    appels["reponses"] = [Reponse(201)]
    user = fabrique.locataire(niveau=0)
    reponse = client.post("/api/auth/send-otp", headers=entetes(user), json={})
    assert reponse.status_code == 200
    assert reponse.get_json()["message"] == "Code envoyé par SMS"
    assert "debug_code" not in reponse.get_json()


def test_mot_de_passe_oublie_503_sans_fournisseur(app, client):
    app.config["SMS_OBLIGATOIRE"] = True
    reponse = client.post("/api/auth/mot-de-passe-oublie", json={"phone": "622529252"})
    assert reponse.status_code == 503


def test_production_exige_les_sms():
    from config import Config, ProductionConfig

    assert ProductionConfig.SMS_OBLIGATOIRE is True
    assert Config.SMS_OBLIGATOIRE is False
