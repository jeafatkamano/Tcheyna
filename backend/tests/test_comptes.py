"""
tests/test_comptes.py — Lot 1.4 « Comptes » : limitation de débit, OTP haché,
révocation des jetons, décisions du back-office.

Les cas R1, R1 bis et R7 de l'audit sont dans test_audit_regressions.py ;
ce fichier couvre le reste du comportement livré par le lot.
"""
import re
from datetime import datetime, timedelta

import pytest

from app import create_app, db
from app.models import OTPCode, User
from app.routes import auth
from tests.conftest import HASH_MOT_DE_PASSE, MOT_DE_PASSE

# Méthode des vrais hachages (ex. « scrypt ») : le hachage factice doit coûter
# le même temps.
MOT_DE_PASSE_HASH_METHODE = HASH_MOT_DE_PASSE.split(":")[0]


def _bearer(jeton):
    return {"Authorization": f"Bearer {jeton}"}


@pytest.fixture
def mot_de_passe_toujours_faux(monkeypatch):
    # La limite se juge au nombre d'essais : inutile de payer scrypt à chaque
    # tentative.
    monkeypatch.setattr(auth, "check_password_hash", lambda *_: False)


def _connexion(client, email, xff=None, password="mauvais"):
    en_tetes = {"X-Forwarded-For": xff} if xff else {}
    return client.post("/api/auth/login", headers=en_tetes,
                       json={"email": email, "password": password})


# ─── Limitation de débit : connexion ─────────────────────────

def test_connexion_bloquee_au_onzieme_echec_en_json_francais(client, locataire,
                                                            mot_de_passe_toujours_faux):
    codes = [_connexion(client, locataire.email).status_code for _ in range(10)]
    assert codes == [401] * 10

    reponse = _connexion(client, locataire.email)

    assert reponse.status_code == 429
    corps = reponse.get_json()
    assert corps["details"] == []
    assert corps["error"].startswith("Trop de tentatives. Réessayez dans ")
    assert "minutes" in corps["error"]
    # Délai lisible par le front (autre origine) et par tout client HTTP.
    # (+1 : flask-limiter arrondit la fin de fenêtre à la seconde supérieure.)
    assert 0 < corps["reessayer_dans"] <= 15 * 60 + 1
    assert 0 < int(reponse.headers["Retry-After"]) <= 15 * 60 + 1


def test_connexion_bloquee_meme_avec_le_bon_mot_de_passe(client, locataire, monkeypatch):
    # `context` et non `undo` : `undo` lèverait aussi le blocage du réseau.
    with monkeypatch.context() as patch:
        patch.setattr(auth, "check_password_hash", lambda *_: False)
        for _ in range(10):
            _connexion(client, locataire.email)

    # Le 429 précède la vérification du mot de passe : l'attaquant ne peut
    # pas continuer à tester des mots de passe en lisant 429 / 200.
    assert _connexion(client, locataire.email, password=MOT_DE_PASSE).status_code == 429


def test_connexion_reussie_ne_consomme_pas_le_quota(client, locataire):
    for _ in range(12):
        assert _connexion(client, locataire.email, password=MOT_DE_PASSE).status_code == 200


def test_limite_par_couple_ip_email(client, fabrique, locataire, mot_de_passe_toujours_faux):
    for _ in range(10):
        _connexion(client, locataire.email)
    assert _connexion(client, locataire.email).status_code == 429

    # Un autre compte depuis la même IP n'est pas bloqué…
    assert _connexion(client, fabrique.bailleur().email).status_code == 401
    # … mais le même compte écrit autrement (casse, espaces) l'est toujours.
    assert _connexion(client, f"  {locataire.email.upper()} ").status_code == 429


def test_une_autre_ip_n_est_pas_bloquee(client, locataire, mot_de_passe_toujours_faux):
    # TRUSTED_PROXY_HOPS = 1 (défaut) : la dernière entrée de X-Forwarded-For,
    # posée par le proxy de Render, est l'IP du client.
    for _ in range(10):
        _connexion(client, locataire.email, xff="1.1.1.1")
    assert _connexion(client, locataire.email, xff="1.1.1.1").status_code == 429

    assert _connexion(client, locataire.email, xff="2.2.2.2").status_code == 401


def test_fausse_ip_en_tete_de_x_forwarded_for_ne_contourne_pas(client, locataire,
                                                               mot_de_passe_toujours_faux):
    for _ in range(10):
        _connexion(client, locataire.email, xff="1.1.1.1")

    # Le client ajoute une IP de son choix en tête : le proxy, lui, ajoute
    # toujours la vraie à la fin. Seule celle-ci compte.
    for fausse in ("9.9.9.9", "8.8.8.8", "7.7.7.7"):
        assert _connexion(client, locataire.email,
                          xff=f"{fausse}, 1.1.1.1").status_code == 429


def test_preflight_cors_non_decompte(client, locataire, mot_de_passe_toujours_faux):
    for _ in range(20):
        client.options("/api/auth/login", headers={
            "Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"})

    assert _connexion(client, locataire.email).status_code == 401


def test_proxy_desactive_ignore_x_forwarded_for(tmp_path):
    # TRUSTED_PROXY_HOPS = 0 (API exposée sans proxy) : l'en-tête, écrit par
    # le client, n'est jamais cru.
    from config import TestingConfig

    class SansProxy(TestingConfig):
        TRUSTED_PROXY_HOPS = 0
        UPLOAD_FOLDER = str(tmp_path)

    application = create_app(SansProxy)
    with application.test_request_context(
            "/", environ_base={"REMOTE_ADDR": "10.0.0.1"},
            headers={"X-Forwarded-For": "9.9.9.9"}):
        from flask import request
        assert request.remote_addr == "10.0.0.1"


def test_diagnostic_expose_le_reglage_proxy(client, admin, entetes):
    reponse = client.get("/api/admin/diagnostic",
                         headers={**entetes(admin), "X-Forwarded-For": "9.9.9.9, 1.1.1.1"})

    reseau = reponse.get_json()["reseau"]
    assert reseau["trusted_proxy_hops"] == 1
    assert reseau["remote_addr"] == "1.1.1.1"
    assert reseau["x_forwarded_for_entrees"] == 2
    assert reseau["limites_stockage"] == "memory"


# ─── OTP ─────────────────────────────────────────────────────

def test_otp_genere_par_secrets(monkeypatch):
    tirages = []

    def randbelow(n):
        tirages.append(n)
        return 42

    monkeypatch.setattr(auth.secrets, "randbelow", randbelow)

    assert auth.generate_otp() == "000042"
    assert tirages == [10 ** 6]


def test_otp_jamais_en_clair_en_base(client, fabrique, entetes, codes_otp):
    user = fabrique.locataire(niveau=0)
    assert client.post("/api/auth/send-otp", headers=entetes(user), json={}).status_code == 200

    otp = OTPCode.query.filter_by(user_id=user.id).one()
    code = codes_otp[-1]
    assert otp.code is None
    assert re.fullmatch(r"[0-9a-f]{64}", otp.code_hash)
    assert code not in otp.code_hash
    assert otp.phone == user.phone
    # Le code est le seul secret : le chiffrer avec la même clé sur une autre
    # ligne donne une autre empreinte.
    assert auth.hacher_otp("autre-ligne", code) != otp.code_hash


def test_otp_cle_dediee(app, client, fabrique, entetes, codes_otp):
    user = fabrique.locataire(niveau=0)
    client.post("/api/auth/send-otp", headers=entetes(user), json={})
    avant = OTPCode.query.filter_by(user_id=user.id).one()

    # Changer de clé invalide le code en cours (10 minutes au plus).
    app.config["OTP_HMAC_KEY"] = "cle-otp-dediee-de-test"
    reponse = client.post("/api/auth/verify-otp", headers=entetes(user),
                          json={"code": codes_otp[-1]})
    assert reponse.status_code == 400
    assert OTPCode.query.get(avant.id).attempts == 1


def test_otp_cinq_essais_puis_code_invalide(client, fabrique, entetes, codes_otp):
    user = fabrique.locataire(niveau=0)
    en_tetes = entetes(user)
    client.post("/api/auth/send-otp", headers=en_tetes, json={})
    bon = codes_otp[-1]
    faux = "000000" if bon != "000000" else "111111"

    messages = []
    for _ in range(5):
        reponse = client.post("/api/auth/verify-otp", headers=en_tetes, json={"code": faux})
        assert reponse.status_code == 400
        messages.append(reponse.get_json()["error"])
    assert messages[0] == "Code incorrect (4 tentative(s) restante(s))"
    assert messages[-1] == "Code incorrect (0 tentative(s) restante(s))"

    # Sixième essai, même avec le bon code : refusé, et le code est grillé.
    reponse = client.post("/api/auth/verify-otp", headers=en_tetes, json={"code": bon})
    assert reponse.status_code == 429
    otp = OTPCode.query.filter_by(user_id=user.id).one()
    assert otp.is_used is True and otp.attempts == 5
    assert User.query.get(user.id).phone_verified is False


def test_otp_bon_code_au_cinquieme_essai(client, fabrique, entetes, codes_otp):
    user = fabrique.locataire(niveau=0)
    en_tetes = entetes(user)
    client.post("/api/auth/send-otp", headers=en_tetes, json={})
    bon = codes_otp[-1]
    faux = "000000" if bon != "000000" else "111111"
    for _ in range(4):
        client.post("/api/auth/verify-otp", headers=en_tetes, json={"code": faux})

    assert client.post("/api/auth/verify-otp", headers=en_tetes,
                       json={"code": bon}).status_code == 200
    assert User.query.get(user.id).phone_verified is True


def test_otp_expire(client, fabrique, entetes, codes_otp):
    user = fabrique.locataire(niveau=0)
    client.post("/api/auth/send-otp", headers=entetes(user), json={})
    otp = OTPCode.query.filter_by(user_id=user.id).one()
    otp.expires_at = datetime.utcnow() - timedelta(seconds=1)
    db.session.commit()

    reponse = client.post("/api/auth/verify-otp", headers=entetes(user),
                          json={"code": codes_otp[-1]})

    assert reponse.status_code == 400
    assert "expiré" in reponse.get_json()["error"]
    assert User.query.get(user.id).phone_verified is False


def test_otp_herite_en_clair_refuse(client, fabrique, entetes):
    # Ligne écrite avant le lot 1.4 : code en clair, sans empreinte.
    user = fabrique.locataire(niveau=0)
    db.session.add(OTPCode(user_id=user.id, code="123456", attempts=0,
                           expires_at=datetime.utcnow() + timedelta(minutes=5)))
    db.session.commit()

    reponse = client.post("/api/auth/verify-otp", headers=entetes(user), json={"code": "123456"})

    assert reponse.status_code == 400
    assert "Demandez un nouveau code" in reponse.get_json()["error"]


def test_otp_antispam_60_secondes_en_json(client, fabrique, entetes):
    user = fabrique.locataire(niveau=0)
    client.post("/api/auth/send-otp", headers=entetes(user), json={})

    reponse = client.post("/api/auth/send-otp", headers=entetes(user), json={})

    assert reponse.status_code == 429
    assert reponse.get_json()["error"].startswith("Patientez ")
    assert 0 < int(reponse.headers["Retry-After"]) <= 60


def test_quota_otp_message_et_delai(app, client, fabrique, entetes):
    user = fabrique.locataire(niveau=0)
    # Envois faits au même numéro par un autre compte (qui l'a libéré depuis) :
    # seul le quota par numéro est en jeu.
    ancien = fabrique.locataire(niveau=0, phone=None, phone_verified=False)
    il_y_a_23h = datetime.utcnow() - timedelta(hours=23)
    for _ in range(5):
        db.session.add(OTPCode(user_id=ancien.id, phone=user.phone, code_hash="x" * 64,
                               is_used=True, created_at=il_y_a_23h,
                               expires_at=il_y_a_23h + timedelta(minutes=10)))
    db.session.commit()

    reponse = client.post("/api/auth/send-otp", headers=entetes(user), json={})

    assert reponse.status_code == 429
    corps = reponse.get_json()
    assert corps["error"].startswith("5 codes maximum par jour pour ce numéro.")
    # La plus ancienne sort de la fenêtre dans une heure environ.
    assert 3500 < corps["reessayer_dans"] <= 3600


def test_quota_otp_fenetre_de_24_heures(client, fabrique, entetes):
    user = fabrique.locataire(niveau=0)
    il_y_a_25h = datetime.utcnow() - timedelta(hours=25)
    for _ in range(5):
        db.session.add(OTPCode(user_id=user.id, phone=user.phone, code_hash="x" * 64,
                               is_used=True, created_at=il_y_a_25h,
                               expires_at=il_y_a_25h + timedelta(minutes=10)))
    db.session.commit()

    assert client.post("/api/auth/send-otp", headers=entetes(user), json={}).status_code == 200


def _vieillir(user):
    # Recule les envois du compte : l'anti-spam de 60 s ne masque pas le quota.
    for otp in OTPCode.query.filter_by(user_id=user.id).all():
        otp.created_at -= timedelta(minutes=2)
    db.session.commit()


def test_quota_otp_par_compte_quel_que_soit_le_numero(app, client, fabrique, entetes, sms):
    app.config["AT_API_KEY"] = "cle-at-de-test"
    user = fabrique.locataire(niveau=0, phone=None, phone_verified=False)

    codes = []
    for i in range(12):
        reponse = client.post("/api/auth/send-otp", headers=entetes(user),
                              json={"phone": f"+2246200001{i:02d}"})
        codes.append(reponse.status_code)
        _vieillir(user)

    assert codes == [200] * 5 + [429] * 7, "un SMS par minute en changeant de numéro"
    assert len(sms) == 5
    assert reponse.get_json()["error"].startswith("5 codes maximum par jour pour ce compte.")


# ─── Plafond global des envois (lot 1.21, SMS pumping) ────────

SATURE = "Le service d'envoi de codes est momentanément saturé."


def _envois_d_autres_comptes(fabrique, *anciennetes):
    """Un code envoyé par compte, chacun à son propre numéro, il y a
    `anciennete` : aucun quota par compte ni par numéro n'est en jeu."""
    maintenant = datetime.utcnow()
    for anciennete in anciennetes:
        autre = fabrique.locataire(niveau=0)
        envoi = maintenant - anciennete
        db.session.add(OTPCode(user_id=autre.id, phone=autre.phone, code_hash="x" * 64,
                               is_used=True, created_at=envoi,
                               expires_at=envoi + timedelta(minutes=10)))
    db.session.commit()


def _demander(client, entetes, user):
    return client.post("/api/auth/send-otp", headers=entetes(user), json={})


def test_plafond_global_horaire(app, client, fabrique, entetes, sms):
    app.config["AT_API_KEY"] = "cle-at-de-test"
    app.config["OTP_PLAFOND_GLOBAL_PAR_HEURE"] = 3
    _envois_d_autres_comptes(fabrique, *(timedelta(minutes=m) for m in (50, 40, 30)))
    user = fabrique.locataire(niveau=0)

    reponse = _demander(client, entetes, user)

    assert reponse.status_code == 429
    corps = reponse.get_json()
    assert corps["error"].startswith(SATURE)
    assert "compte" not in corps["error"] and "numéro" not in corps["error"]
    # Le plus ancien des trois envois sort de l'heure glissante dans 10 minutes.
    assert 590 < int(reponse.headers["Retry-After"]) <= 600
    assert corps["reessayer_dans"] == int(reponse.headers["Retry-After"])
    assert sms == []
    assert OTPCode.query.filter_by(user_id=user.id).count() == 0


def test_plafond_global_24_heures(app, client, fabrique, entetes, sms):
    app.config["AT_API_KEY"] = "cle-at-de-test"
    app.config["OTP_PLAFOND_GLOBAL_PAR_JOUR"] = 3
    _envois_d_autres_comptes(fabrique, *(timedelta(hours=h) for h in (23, 22, 21)))

    reponse = _demander(client, entetes, fabrique.locataire(niveau=0))

    assert reponse.status_code == 429
    assert reponse.get_json()["error"].startswith(SATURE)
    assert 3500 < int(reponse.headers["Retry-After"]) <= 3600
    assert sms == []


def test_plafond_global_attente_la_plus_longue(app, client, fabrique, entetes):
    # Les deux fenêtres sont pleines : l'heure se libère dans 30 minutes, la
    # journée dans une heure. Revenir dans 30 minutes serait refusé.
    app.config["OTP_PLAFOND_GLOBAL_PAR_HEURE"] = 2
    app.config["OTP_PLAFOND_GLOBAL_PAR_JOUR"] = 3
    _envois_d_autres_comptes(fabrique, timedelta(hours=23), timedelta(minutes=30),
                             timedelta(minutes=20))

    reponse = _demander(client, entetes, fabrique.locataire(niveau=0))

    assert reponse.status_code == 429
    assert 3500 < int(reponse.headers["Retry-After"]) <= 3600


def test_plafond_global_compte_tous_les_comptes(app, client, fabrique, entetes, sms):
    app.config["AT_API_KEY"] = "cle-at-de-test"
    app.config["OTP_PLAFOND_GLOBAL_PAR_HEURE"] = 3
    # Deux envois dans l'heure ; ceux d'il y a deux heures en sont sortis.
    _envois_d_autres_comptes(fabrique, timedelta(minutes=30), timedelta(minutes=20),
                             *(timedelta(hours=2) for _ in range(3)))
    premier = fabrique.locataire(niveau=0)
    second = fabrique.locataire(niveau=0)

    assert _demander(client, entetes, premier).status_code == 200
    assert len(sms) == 1 and sms[0]["destinataires"] == [premier.phone]
    # Le code du premier compte remplit le plafond : un autre compte, à un
    # autre numéro, est refusé.
    reponse = _demander(client, entetes, second)
    assert reponse.status_code == 429
    assert reponse.get_json()["error"].startswith(SATURE)
    assert len(sms) == 1


def test_plafond_global_valeurs_par_defaut_et_surcharge(app, client, fabrique, entetes,
                                                        monkeypatch):
    # Sans réglage dans `app.config`, la constante du module s'applique.
    assert "OTP_PLAFOND_GLOBAL_PAR_HEURE" not in app.config
    monkeypatch.setattr(auth, "OTP_PLAFOND_GLOBAL_PAR_HEURE", 1)
    _envois_d_autres_comptes(fabrique, timedelta(minutes=5))
    assert _demander(client, entetes, fabrique.locataire(niveau=0)).status_code == 429

    # Un réglage dans `app.config` l'emporte sur la constante.
    app.config["OTP_PLAFOND_GLOBAL_PAR_HEURE"] = 2
    assert _demander(client, entetes, fabrique.locataire(niveau=0)).status_code == 200


def test_plafond_global_alertes_sans_numero(app, client, fabrique, entetes, caplog):
    app.config["OTP_PLAFOND_GLOBAL_PAR_HEURE"] = 5
    _envois_d_autres_comptes(fabrique, timedelta(minutes=20), timedelta(minutes=10))
    users = [fabrique.locataire(niveau=0) for _ in range(4)]

    def alertes():
        return [(r.levelname, r.getMessage()) for r in caplog.records
                if "Plafond global" in r.getMessage()]

    # 3/5 : sous le seuil de 80 %, aucun log.
    assert _demander(client, entetes, users[0]).status_code == 200
    assert alertes() == []

    # 4/5 : avertissement.
    assert _demander(client, entetes, users[1]).status_code == 200
    assert alertes() == [("WARNING", "Plafond global des SMS d'OTP bientôt atteint : "
                                     "4 codes envoyés sur une heure (plafond 5).")]

    # 5/5 : erreur, les demandes suivantes seront refusées.
    assert _demander(client, entetes, users[2]).status_code == 200
    niveau, message = alertes()[-1]
    assert niveau == "ERROR"
    assert message.startswith("Plafond global des SMS d'OTP atteint : 5 codes envoyés "
                              "sur une heure (plafond 5).")

    # Les refus ne journalisent rien : un attaquant les répète à volonté.
    assert _demander(client, entetes, users[3]).status_code == 429
    assert len(alertes()) == 2

    # Aucun numéro, même partiel, dans les logs d'alerte.
    for _, message in alertes():
        for user in users:
            assert user.phone not in message and user.phone[-6:] not in message


def test_numero_deja_pris_apres_les_quotas(client, fabrique, entetes):
    # L'énumération des numéros inscrits est bornée par le quota du compte.
    pris = fabrique.locataire(niveau=1)
    curieux = fabrique.locataire(niveau=0, phone=None, phone_verified=False)
    for _ in range(5):
        db.session.add(OTPCode(user_id=curieux.id, phone="+224620000777", code_hash="x" * 64,
                               is_used=True, created_at=datetime.utcnow() - timedelta(hours=1),
                               expires_at=datetime.utcnow()))
    db.session.commit()

    reponse = client.post("/api/auth/send-otp", headers=entetes(curieux),
                          json={"phone": pris.phone})

    assert reponse.status_code == 429


def test_otp_code_reutilise_refuse(client, fabrique, entetes, codes_otp):
    user = fabrique.locataire(niveau=0)
    en_tetes = entetes(user)
    client.post("/api/auth/send-otp", headers=en_tetes, json={})
    code = codes_otp[-1]
    assert client.post("/api/auth/verify-otp", headers=en_tetes,
                       json={"code": code}).status_code == 200

    # Même si le compte repasse non vérifié, le code consommé ne resservira pas.
    User.query.get(user.id).phone_verified = False
    db.session.commit()
    reponse = client.post("/api/auth/verify-otp", headers=en_tetes, json={"code": code})

    assert reponse.status_code == 400
    assert User.query.get(user.id).phone_verified is False


def test_otp_numero_change_entre_envoi_et_verification(client, fabrique, entetes, codes_otp):
    # Course : un send-otp concurrent remplace le numéro du compte après la
    # lecture du code par verify-otp. Le code prouve l'ancien numéro, pas le
    # nouveau, qui ne doit pas être marqué vérifié.
    user = fabrique.locataire(niveau=0)
    client.post("/api/auth/send-otp", headers=entetes(user), json={})
    User.query.get(user.id).phone = "+224620000555"
    db.session.commit()

    reponse = client.post("/api/auth/verify-otp", headers=entetes(user),
                          json={"code": codes_otp[-1]})

    assert reponse.status_code == 409
    assert "a changé" in reponse.get_json()["error"]
    relu = User.query.get(user.id)
    assert relu.phone_verified is False and relu.trust_level == 0


def test_otp_remplace_pendant_la_verification(client, fabrique, entetes, codes_otp, monkeypatch):
    # Course : le code est lu, puis invalidé par un send-otp concurrent avant
    # la réservation de l'essai. La réservation exige `is_used = False`.
    user = fabrique.locataire(niveau=0)
    client.post("/api/auth/send-otp", headers=entetes(user), json={})
    otp = OTPCode.query.filter_by(user_id=user.id).one()
    otp_id = otp.id

    original = auth.datetime

    class Horloge(original):
        @classmethod
        def utcnow(cls):
            # Appelée juste avant la réservation : simule l'envoi concurrent.
            OTPCode.query.filter_by(id=otp_id).update({"is_used": True})
            db.session.commit()  # l'autre requête a validé sa transaction
            return original.utcnow()

    monkeypatch.setattr(auth, "datetime", Horloge)
    reponse = client.post("/api/auth/verify-otp", headers=entetes(user),
                          json={"code": codes_otp[-1]})

    assert reponse.status_code == 400
    assert "déjà utilisé ou remplacé" in reponse.get_json()["error"]
    assert User.query.get(user.id).phone_verified is False


def test_connexion_email_inconnu_verifie_quand_meme_un_hachage(client, monkeypatch):
    # Temps de réponse égalisé : un e-mail inconnu paie aussi la vérification.
    appels = []
    monkeypatch.setattr(auth, "check_password_hash",
                        lambda h, mdp: appels.append(h) or False)

    reponse = _connexion(client, "personne@exemple.test")

    assert reponse.status_code == 401
    assert appels == [auth.HASH_FACTICE]
    assert auth.HASH_FACTICE.split(":")[0] == MOT_DE_PASSE_HASH_METHODE


def test_formater_delai():
    from app import formater_delai

    assert formater_delai(0.2) == "1 seconde"
    assert formater_delai(58.5) == "59 secondes"
    assert formater_delai(59.1) == "1 minute"
    assert formater_delai(900) == "15 minutes"
    assert formater_delai(901) == "15 minutes"
    assert formater_delai(89) == "1 minute"
    assert formater_delai(90) == "2 minutes"
    assert formater_delai(3600) == "1 heure"
    assert formater_delai(23.6 * 3600) == "24 heures"


# ─── Révocation des jetons ───────────────────────────────────

def test_changement_de_mot_de_passe_revoque_les_anciens_jetons(client, locataire, entetes):
    acces, rafraichissement = entetes(locataire), entetes(locataire, refresh=True)

    reponse = client.put("/api/auth/password", headers=acces, json={
        "ancien_mot_de_passe": MOT_DE_PASSE, "nouveau_mot_de_passe": "nouveau-mdp-123"})

    assert reponse.status_code == 200
    corps = reponse.get_json()
    revoque = client.get("/api/auth/me", headers=acces)
    assert revoque.status_code == 401
    assert revoque.get_json() == {"error": "Session révoquée, veuillez vous reconnecter",
                                  "details": []}
    assert client.post("/api/auth/refresh", headers=rafraichissement).status_code == 401

    # Les jetons renvoyés gardent l'appareil courant connecté.
    assert client.get("/api/auth/me", headers=_bearer(corps["access_token"])).status_code == 200
    nouveau = client.post("/api/auth/refresh", headers=_bearer(corps["refresh_token"]))
    assert nouveau.status_code == 200
    assert client.get("/api/auth/me",
                      headers=_bearer(nouveau.get_json()["access_token"])).status_code == 200


def test_desactivation_par_l_admin_revoque_les_jetons(client, admin, locataire, entetes):
    acces, rafraichissement = entetes(locataire), entetes(locataire, refresh=True)

    assert client.put(f"/api/admin/users/{locataire.id}/statut", headers=entetes(admin),
                      json={"is_active": False}).status_code == 200

    assert client.get("/api/auth/me", headers=acces).status_code == 401
    assert client.post("/api/auth/refresh", headers=rafraichissement).status_code == 401

    # La réactivation ne ressuscite pas les anciens jetons.
    assert client.put(f"/api/admin/users/{locataire.id}/statut", headers=entetes(admin),
                      json={"is_active": True}).status_code == 200
    assert client.get("/api/auth/me", headers=acces).status_code == 401
    assert client.post("/api/auth/refresh", headers=rafraichissement).status_code == 401


def test_refresh_refuse_a_un_compte_desactive(client, locataire, entetes):
    # Désactivé hors des routes qui révoquent (base modifiée à la main, compte
    # désactivé avant le déploiement du lot) : la version n'a pas bougé.
    rafraichissement = entetes(locataire, refresh=True)
    locataire.is_active = False
    db.session.commit()

    reponse = client.post("/api/auth/refresh", headers=rafraichissement)

    assert reponse.status_code == 403
    assert reponse.get_json()["error"] == "Compte désactivé. Contactez le support."


def test_refresh_emet_un_jeton_a_la_version_courante(client, locataire, entetes):
    from flask_jwt_extended import decode_token

    locataire.token_version = 3
    db.session.commit()

    reponse = client.post("/api/auth/refresh", headers=entetes(locataire, refresh=True))

    jeton = reponse.get_json()["access_token"]
    assert decode_token(jeton)["tv"] == 3
    assert client.get("/api/auth/me", headers=_bearer(jeton)).status_code == 200


def test_jeton_sans_claim_vaut_version_zero(client, locataire):
    # Jetons émis avant le lot 1.4 : valides tant que rien n'a été révoqué.
    from flask_jwt_extended import create_access_token

    ancien = _bearer(create_access_token(identity=locataire.id))
    assert client.get("/api/auth/me", headers=ancien).status_code == 200

    locataire.revoquer_jetons()
    db.session.commit()
    assert client.get("/api/auth/me", headers=ancien).status_code == 401


def test_jeton_d_un_compte_supprime_refuse(client, fabrique, entetes):
    user = fabrique.locataire(niveau=0, passeport=False)
    en_tetes = entetes(user)
    db.session.delete(user)
    db.session.commit()

    assert client.get("/api/auth/me", headers=en_tetes).status_code == 401


def test_recherche_avec_jeton_revoque_reste_publique(client, annonce, locataire, entetes):
    en_tetes = entetes(locataire)
    locataire.revoquer_jetons()
    db.session.commit()

    reponse = client.get("/api/listings/", headers=en_tetes)

    assert reponse.status_code == 200
    assert len(reponse.get_json()["listings"]) == 1


def test_controle_de_version_sans_requete_sql_supplementaire(client, locataire, entetes,
                                                             compteur_sql):
    en_tetes = entetes(locataire)
    # Comme en production : la session part vide à chaque requête.
    db.session.expunge_all()

    with compteur_sql() as requetes:
        assert client.get("/api/auth/me", headers=en_tetes).status_code == 200

    # Le chargeur JWT lit le compte ; `role_required` le reprend de
    # l'identity map au lieu de le relire.
    lectures_users = [r for r in requetes if re.search(r"FROM users\s+WHERE users\.id", r)]
    assert len(lectures_users) == 1, requetes


# ─── Back-office (R1, R1 bis) ────────────────────────────────

@pytest.mark.parametrize("corps, code", [({}, "missing"), ({"approuve": None}, "bool_type")],
                         ids=["absent", "null"])
@pytest.mark.parametrize("route", ["verify-cni", "verify-revenus", "certifier"])
def test_decision_explicite_exigee(client, fabrique, admin, entetes, route, corps, code):
    cible = fabrique.locataire(niveau=2, passeport=False)
    fabrique.passeport(cible, cni_recto_url="/uploads/cni.png", income_doc_url="/uploads/r.pdf")
    annonce = fabrique.annonce(certification_status="pending")
    ident = annonce.id if route == "certifier" else cible.id

    reponse = client.put(f"/api/admin/{route}/{ident}", headers=entetes(admin), json=corps)

    assert reponse.status_code == 422
    assert reponse.get_json()["details"][0]["code"] == code
    assert User.query.get(cible.id).trust_level == 2


def test_verify_cni_sans_piece_validation_impossible(client, fabrique, admin, entetes):
    # Drapeau `cni_uploaded` posé, mais aucune pièce dans le passeport : c'est
    # le passeport qui fait foi.
    cible = fabrique.locataire(niveau=1, cni_uploaded=True)

    reponse = client.put(f"/api/admin/verify-cni/{cible.id}", headers=entetes(admin),
                         json={"approuve": True})

    assert reponse.status_code == 422
    assert reponse.get_json()["details"][0] == {
        "champ": "approuve", "code": "piece_absente",
        "message": "Aucune pièce d'identité déposée"}
    relu = User.query.get(cible.id)
    assert relu.trust_level == 1 and relu.cni_verified is False and relu.cni_uploaded is True


def test_verify_cni_refus_sans_piece_vide_la_file(client, fabrique, admin, entetes):
    from app.models import Notification

    cible = fabrique.locataire(niveau=1, cni_uploaded=True)
    en_tetes = entetes(admin)
    assert len(client.get("/api/admin/cni-pending", headers=en_tetes).get_json()) == 1

    reponse = client.put(f"/api/admin/verify-cni/{cible.id}", headers=en_tetes,
                         json={"approuve": False, "motif": "Rien à examiner"})

    assert reponse.status_code == 200
    relu = User.query.get(cible.id)
    assert relu.cni_uploaded is False and relu.cni_verified is False and relu.trust_level == 1
    assert client.get("/api/admin/cni-pending", headers=en_tetes).get_json() == []
    # Aucune notification de rejet d'une pièce qui n'existe pas.
    assert Notification.query.filter_by(user_id=cible.id).count() == 0


def test_verify_cni_refus_ecarte_la_piece(client, fabrique, admin, entetes):
    cible = fabrique.locataire(niveau=1, cni_uploaded=True, passeport=False)
    fabrique.passeport(cible, passport_url="/uploads/passeport.png", docs_uploaded=True)

    reponse = client.put(f"/api/admin/verify-cni/{cible.id}", headers=entetes(admin),
                         json={"approuve": False, "motif": "Photo floue"})

    assert reponse.status_code == 200
    relu = User.query.get(cible.id)
    assert relu.cni_uploaded is False and relu.passport.passport_url is None


def test_verify_revenus_avec_et_sans_justificatif(client, fabrique, admin, entetes):
    sans = fabrique.locataire(niveau=2)
    reponse = client.put(f"/api/admin/verify-revenus/{sans.id}", headers=entetes(admin),
                         json={"approuve": True})
    assert reponse.status_code == 422
    assert reponse.get_json()["error"] == "Aucun justificatif de revenus déposé"

    avec = fabrique.locataire(niveau=2, passeport=False)
    fabrique.passeport(avec, cni_recto_url="/uploads/cni.png",
                       income_doc_url="/uploads/revenus.pdf")
    reponse = client.put(f"/api/admin/verify-revenus/{avec.id}", headers=entetes(admin),
                         json={"approuve": True})
    assert reponse.status_code == 200
    assert User.query.get(avec.id).income_verified is True
