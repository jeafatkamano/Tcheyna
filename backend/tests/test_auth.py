"""Blueprint auth : inscription, connexion, jetons, vérification du téléphone,
connexion par téléphone et mot de passe oublié par SMS."""
import re
from datetime import datetime, timedelta

import pytest

from app import db
from app.models import OTPCode, TenantPassport, User
from app.routes import auth
from tests.conftest import MOT_DE_PASSE


def _inscription(client, **surcharges):
    corps = {"email": "awa@exemple.test", "password": "motdepasse-solide",
             "full_name": "Awa Camara", "role": "tenant", "phone": "622000111"}
    corps.update(surcharges)
    return client.post("/api/auth/register", json=corps)


def test_inscription_locataire_cree_compte_passeport_et_jetons(client):
    reponse = _inscription(client)

    assert reponse.status_code == 201
    corps = reponse.get_json()
    assert corps["access_token"] and corps["refresh_token"]
    # Le numéro local est normalisé en +224 (Guinée par défaut).
    assert corps["user"]["phone"] == "+224622000111"
    user = User.query.filter_by(email="awa@exemple.test").one()
    assert user.trust_level == 0
    assert TenantPassport.query.filter_by(tenant_id=user.id).count() == 1


def test_inscription_refuse_le_role_admin(client):
    # Un compte administrateur ne s'obtient jamais par l'inscription publique.
    reponse = _inscription(client, role="admin")

    assert reponse.status_code == 422
    assert User.query.count() == 0


def test_inscription_refuse_un_email_deja_pris(client, locataire):
    reponse = _inscription(client, email=locataire.email)
    assert reponse.status_code == 409


def test_connexion_par_la_vraie_route_donne_un_jeton_utilisable(client, locataire):
    reponse = client.post("/api/auth/login",
                          json={"email": locataire.email.upper(), "password": MOT_DE_PASSE})

    assert reponse.status_code == 200
    jeton = reponse.get_json()["access_token"]
    moi = client.get("/api/auth/me", headers={"Authorization": f"Bearer {jeton}"})
    assert moi.status_code == 200
    assert moi.get_json()["id"] == locataire.id


def test_connexion_mauvais_mot_de_passe_refusee(client, locataire):
    reponse = client.post("/api/auth/login",
                          json={"email": locataire.email, "password": "pas-le-bon"})
    assert reponse.status_code == 401


def test_connexion_compte_desactive_refusee(client, fabrique):
    user = fabrique.locataire(is_active=False)
    reponse = client.post("/api/auth/login", json={"email": user.email, "password": MOT_DE_PASSE})
    assert reponse.status_code == 403


def test_refresh_accepte_le_jeton_de_rafraichissement_seulement(client, locataire, entetes):
    assert client.post("/api/auth/refresh",
                       headers=entetes(locataire, refresh=True)).status_code == 200
    assert client.post("/api/auth/refresh", headers=entetes(locataire)).status_code in (401, 422)


def test_changement_mot_de_passe_exige_l_ancien(client, locataire, entetes):
    en_tetes = entetes(locataire)
    reponse = client.put("/api/auth/password", headers=en_tetes,
                         json={"ancien_mot_de_passe": "faux", "nouveau_mot_de_passe": "nouveau-mdp"})
    # 422 et non 401 : le front lirait un 401 comme une session expirée et
    # déconnecterait l'utilisateur pour une faute de frappe.
    assert reponse.status_code == 422
    assert reponse.get_json()["details"][0] == {
        "champ": "ancien_mot_de_passe", "code": "mot_de_passe_incorrect",
        "message": "Ancien mot de passe incorrect"}
    # Rien n'est révoqué : la session reste ouverte.
    assert client.get("/api/auth/me", headers=en_tetes).status_code == 200


def test_otp_envoye_par_sms_puis_verifie(app, client, fabrique, entetes, sms):
    app.config["AT_API_KEY"] = "cle-at-de-test"
    user = fabrique.locataire(niveau=0)

    envoi = client.post("/api/auth/send-otp", headers=entetes(user), json={})
    assert envoi.status_code == 200
    # Le code ne doit jamais apparaître dans la réponse hors mode debug.
    assert "debug_code" not in envoi.get_json()
    assert len(sms) == 1 and sms[0]["destinataires"] == [user.phone]

    # La base ne garde qu'une empreinte : le code se lit dans le SMS.
    code = re.search(r"\b(\d{6})\b", sms[0]["message"]).group(1)
    verif = client.post("/api/auth/verify-otp", headers=entetes(user), json={"code": code})

    assert verif.status_code == 200
    assert verif.get_json()["trust_level"] == 1


def test_otp_incorrect_refuse(client, fabrique, entetes, codes_otp):
    user = fabrique.locataire(niveau=0)
    client.post("/api/auth/send-otp", headers=entetes(user), json={})

    code = codes_otp[-1]
    faux = "000000" if code != "000000" else "111111"
    reponse = client.post("/api/auth/verify-otp", headers=entetes(user), json={"code": faux})

    assert reponse.status_code == 400
    assert User.query.get(user.id).trust_level == 0


def test_niveaux_publics(client):
    reponse = client.get("/api/auth/niveaux")
    assert reponse.status_code == 200
    assert [n["niveau"] for n in reponse.get_json()["niveaux"]] == [0, 1, 2, 3, 4]


# ─── Connexion par téléphone (lot 3.8) ───────────────────────

TELEPHONE = "+224622529252"
# Le même numéro, tel qu'un utilisateur peut l'écrire.
ECRITURES = ["+224622529252", "+224 622 52 92 52", "622 52 92 52", "622529252",
             "00224622529252", "0622-52-92-52", "(+224) 622.52.92.52"]
NOUVEAU = "nouveau-mot-de-passe"


def _connexion(client, identifiant, password=MOT_DE_PASSE, xff=None):
    en_tetes = {"X-Forwarded-For": xff} if xff else {}
    return client.post("/api/auth/login", headers=en_tetes,
                       json={"email": identifiant, "password": password})


@pytest.fixture
def mot_de_passe_toujours_faux(monkeypatch):
    # Les limites se jugent au nombre d'essais : inutile de payer scrypt.
    monkeypatch.setattr(auth, "check_password_hash", lambda *_: False)


@pytest.fixture
def avec_sms(app):
    """Clé Africa's Talking renseignée : les SMS partent (dans le faux module)."""
    app.config["AT_API_KEY"] = "cle-at-de-test"


def test_connexion_par_telephone_verifie_sous_toutes_ses_ecritures(client, fabrique):
    user = fabrique.locataire(niveau=1, phone=TELEPHONE)

    for ecriture in ECRITURES:
        reponse = _connexion(client, ecriture)
        assert reponse.status_code == 200, ecriture
        assert reponse.get_json()["user"]["id"] == user.id

    jeton = reponse.get_json()["access_token"]
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {jeton}"}).status_code == 200


def test_connexion_par_telephone_mauvais_mot_de_passe(client, fabrique):
    fabrique.locataire(niveau=1, phone=TELEPHONE)
    reponse = _connexion(client, TELEPHONE, password="pas-le-bon")
    assert reponse.status_code == 401
    assert reponse.get_json()["error"] == "Identifiants incorrects"


def test_connexion_par_telephone_non_verifie_comme_un_inconnu(client, fabrique, monkeypatch):
    fabrique.locataire(niveau=0, phone=TELEPHONE)

    # Même avec le bon mot de passe : un numéro non vérifié n'ouvre rien.
    non_verifie = _connexion(client, TELEPHONE)
    inconnu = _connexion(client, "+224620000999")
    assert non_verifie.status_code == inconnu.status_code == 401
    assert non_verifie.get_json() == inconnu.get_json()

    # Même coût : le hachage factice est vérifié, comme pour un inconnu,
    # même si le mot de passe saisi était le bon.
    appels = []
    monkeypatch.setattr(auth, "check_password_hash", lambda h, mdp: appels.append(h) or True)
    assert _connexion(client, TELEPHONE).status_code == 401
    assert appels == [auth.HASH_FACTICE]


def test_connexion_par_telephone_compte_desactive(client, fabrique):
    fabrique.locataire(niveau=1, phone=TELEPHONE, is_active=False)
    assert _connexion(client, TELEPHONE).status_code == 403


def test_connexion_par_telephone_limitee_sur_le_numero_normalise(client, fabrique,
                                                                 mot_de_passe_toujours_faux):
    # Numéro non vérifié : il est limité comme un compte existant.
    fabrique.locataire(niveau=0, phone=TELEPHONE)

    # Dix échecs sous des écritures différentes : la limite par saisie brute
    # ne suffirait pas, chaque écriture aurait son propre compteur.
    codes = [_connexion(client, ECRITURES[i % len(ECRITURES)]).status_code for i in range(10)]
    assert codes == [401] * 10

    reponse = _connexion(client, "622529252")
    assert reponse.status_code == 429
    assert reponse.get_json()["error"].startswith("Trop de tentatives.")
    assert 0 < int(reponse.headers["Retry-After"]) <= 15 * 60 + 1

    # Un autre numéro, depuis la même IP, n'est pas bloqué.
    assert _connexion(client, "+224620000999").status_code == 401


def test_connexion_par_telephone_limitee_toutes_ip_confondues(client, fabrique,
                                                              mot_de_passe_toujours_faux):
    user = fabrique.locataire(niveau=1, phone=TELEPHONE)
    for ip in ("1.1.1.1", "2.2.2.2", "3.3.3.3"):
        for i in range(10):
            assert _connexion(client, ECRITURES[i % len(ECRITURES)], xff=ip).status_code == 401

    # Trentième échec atteint : une quatrième IP est bloquée sur ce numéro…
    reponse = _connexion(client, TELEPHONE, xff="4.4.4.4")
    assert reponse.status_code == 429
    assert int(reponse.headers["Retry-After"]) > 0
    # … mais pas sur l'e-mail du même compte, que cette limite ne vise pas.
    assert _connexion(client, user.email, xff="4.4.4.4").status_code == 401


def test_connexion_par_email_hors_des_limites_par_telephone(client, locataire,
                                                            mot_de_passe_toujours_faux):
    # Les limites par numéro ne s'appliquent pas aux e-mails : la limite par
    # e-mail reste la seule, et tombe au onzième échec comme avant.
    codes = [_connexion(client, locataire.email).status_code for _ in range(11)]
    assert codes == [401] * 10 + [429]


# ─── Mot de passe oublié par SMS (lot 3.8) ───────────────────

def _demander(client, phone, xff=None):
    en_tetes = {"X-Forwarded-For": xff} if xff else {}
    reponse = client.post("/api/auth/mot-de-passe-oublie", headers=en_tetes, json={"phone": phone})
    # Le SMS part à la fermeture de la réponse (après sa transmission), que
    # le client de test ne fait pas de lui-même.
    reponse.close()
    return reponse


def _confirmer(client, phone, code, mot_de_passe=NOUVEAU, xff=None):
    en_tetes = {"X-Forwarded-For": xff} if xff else {}
    return client.post("/api/auth/mot-de-passe-oublie/confirmer", headers=en_tetes,
                       json={"phone": phone, "code": code, "nouveau_mot_de_passe": mot_de_passe})


def _code(sms):
    return re.search(r"\b(\d{6})\b", sms[-1]["message"]).group(1)


def _faux(code):
    return "000000" if code != "000000" else "111111"


def _reculer(user, minutes=2):
    # Recule les envois du compte : l'anti-spam de 60 s ne masque pas le quota.
    for otp in OTPCode.query.filter_by(user_id=user.id).all():
        otp.created_at -= timedelta(minutes=minutes)
    db.session.commit()


def _mot_de_passe_est(user_id, mot_de_passe):
    from werkzeug.security import check_password_hash
    return check_password_hash(db.session.get(User, user_id).password_hash, mot_de_passe)


def test_mot_de_passe_oublie_reponse_identique_sans_enumeration(client, fabrique, avec_sms, sms):
    verifie = fabrique.locataire(niveau=1, phone="+224620000001")
    non_verifie = fabrique.locataire(niveau=0, phone="+224620000002")
    desactive = fabrique.locataire(niveau=1, phone="+224620000003", is_active=False)

    reponses = [_demander(client, p) for p in
                ("620000001", "620000002", "620000003", "620000004")]

    assert {r.status_code for r in reponses} == {200}
    assert all(r.get_json() == reponses[0].get_json() for r in reponses)
    assert "debug_code" not in reponses[0].get_json()
    # Un seul SMS, au seul compte vérifié et actif, avec un texte propre à la
    # réinitialisation.
    assert [s["destinataires"] for s in sms] == [[verifie.phone]]
    assert "reinitialisation" in sms[0]["message"]
    assert OTPCode.query.filter(OTPCode.user_id.in_([non_verifie.id, desactive.id])).count() == 0


def test_mot_de_passe_oublie_le_sms_part_apres_la_reponse(client, fabrique, avec_sms, sms):
    # Sa durée ne doit pas s'ajouter à celle de la réponse : elle révélerait,
    # au chronomètre, que le numéro est inscrit.
    fabrique.locataire(niveau=1, phone=TELEPHONE)
    reponse = client.post("/api/auth/mot-de-passe-oublie", json={"phone": TELEPHONE})
    assert reponse.status_code == 200 and sms == []

    reponse.close()
    assert len(sms) == 1


def test_mot_de_passe_oublie_jamais_de_code_en_mode_debug(app, client, fabrique, sms):
    app.config["DEBUG"] = True  # sans AT_API_KEY : le SMS ne part pas
    fabrique.locataire(niveau=1, phone=TELEPHONE)

    reponse = _demander(client, TELEPHONE)

    assert reponse.status_code == 200
    assert set(reponse.get_json()) == {"message", "expire_dans"}


def test_reinitialisation_complete_revoque_tous_les_jetons(client, fabrique, entetes, avec_sms, sms):
    user = fabrique.locataire(niveau=1, phone=TELEPHONE)
    acces, rafraichissement = entetes(user), entetes(user, refresh=True)
    _demander(client, "622 52 92 52")

    reponse = _confirmer(client, "+224 622 52 92 52", _code(sms))

    assert reponse.status_code == 200
    assert set(reponse.get_json()) == {"message"}  # pas de session ouverte d'office
    assert _mot_de_passe_est(user.id, NOUVEAU)
    # Anciens jetons d'accès et de rafraîchissement refusés.
    assert client.get("/api/auth/me", headers=acces).status_code == 401
    assert client.post("/api/auth/refresh", headers=rafraichissement).status_code == 401
    # L'ancien mot de passe ne sert plus, le nouveau ouvre une session.
    assert _connexion(client, TELEPHONE).status_code == 401
    assert _connexion(client, TELEPHONE, password=NOUVEAU).status_code == 200
    assert _connexion(client, user.email, password=NOUVEAU).status_code == 200


def test_reinitialisation_invalide_les_autres_codes_du_compte(client, fabrique, avec_sms, sms):
    user = fabrique.locataire(niveau=1, phone=TELEPHONE)
    _demander(client, TELEPHONE)
    # Second code en attente (demande concurrente, par exemple).
    autre_id = "autre-code"
    maintenant = datetime.utcnow()
    db.session.add(OTPCode(id=autre_id, user_id=user.id, phone=TELEPHONE, attempts=0,
                           code_hash=auth.hacher_otp_reinitialisation(autre_id, "123456"),
                           created_at=maintenant - timedelta(seconds=5),
                           expires_at=maintenant + timedelta(minutes=5)))
    db.session.commit()

    assert _confirmer(client, TELEPHONE, _code(sms)).status_code == 200

    assert OTPCode.query.filter_by(user_id=user.id, is_used=False).count() == 0
    assert _confirmer(client, TELEPHONE, "123456", mot_de_passe="encore-un-autre").status_code == 400
    assert _mot_de_passe_est(user.id, NOUVEAU)


def test_confirmation_mauvais_code_essais_limites(client, fabrique, avec_sms, sms):
    user = fabrique.locataire(niveau=1, phone=TELEPHONE)
    _demander(client, TELEPHONE)
    bon = _code(sms)

    reponses = [_confirmer(client, TELEPHONE, _faux(bon)) for _ in range(5)]
    assert [r.status_code for r in reponses] == [400] * 5
    # Le refus ne dit pas combien d'essais restent : ce serait avouer qu'un
    # code est en attente, donc que le numéro est inscrit.
    assert reponses[0].get_json() == {"error": auth.REFUS_CONFIRMATION, "details": []}

    # Sixième essai, même avec le bon code : refusé, le code est grillé.
    assert _confirmer(client, TELEPHONE, bon).status_code == 400
    otp = OTPCode.query.filter_by(user_id=user.id).one()
    assert otp.is_used is True and otp.attempts == 5
    assert _mot_de_passe_est(user.id, MOT_DE_PASSE)


def test_confirmation_bon_code_au_cinquieme_essai(client, fabrique, avec_sms, sms):
    user = fabrique.locataire(niveau=1, phone=TELEPHONE)
    _demander(client, TELEPHONE)
    for _ in range(4):
        _confirmer(client, TELEPHONE, _faux(_code(sms)))

    assert _confirmer(client, TELEPHONE, _code(sms)).status_code == 200
    assert _mot_de_passe_est(user.id, NOUVEAU)


def test_confirmation_refus_identique_quel_que_soit_le_cas(client, fabrique, avec_sms, sms):
    fabrique.locataire(niveau=1, phone=TELEPHONE)
    fabrique.locataire(niveau=0, phone="+224620000002")
    _demander(client, TELEPHONE)

    reponses = [
        _confirmer(client, TELEPHONE, _faux(_code(sms))),     # code incorrect
        _confirmer(client, "+224620000002", "123456"),        # numéro non vérifié
        _confirmer(client, "+224620000004", "123456"),        # numéro inconnu
    ]
    assert {r.status_code for r in reponses} == {400}
    assert all(r.get_json() == reponses[0].get_json() for r in reponses)


def test_confirmation_code_expire(client, fabrique, avec_sms, sms):
    user = fabrique.locataire(niveau=1, phone=TELEPHONE)
    _demander(client, TELEPHONE)
    otp = OTPCode.query.filter_by(user_id=user.id).one()
    otp.expires_at = datetime.utcnow() - timedelta(seconds=1)
    db.session.commit()

    assert _confirmer(client, TELEPHONE, _code(sms)).status_code == 400
    assert _mot_de_passe_est(user.id, MOT_DE_PASSE)


def test_confirmation_code_deja_utilise(client, fabrique, avec_sms, sms):
    user = fabrique.locataire(niveau=1, phone=TELEPHONE)
    _demander(client, TELEPHONE)
    code = _code(sms)
    assert _confirmer(client, TELEPHONE, code).status_code == 200

    reponse = _confirmer(client, TELEPHONE, code, mot_de_passe="celui-d-un-tiers")

    assert reponse.status_code == 400
    assert _mot_de_passe_est(user.id, NOUVEAU)


def test_confirmation_respecte_la_politique_du_mot_de_passe(client, fabrique, avec_sms, sms):
    user = fabrique.locataire(niveau=1, phone=TELEPHONE)
    _demander(client, TELEPHONE)

    reponse = _confirmer(client, TELEPHONE, _code(sms), mot_de_passe="court")

    # Même règle qu'à l'inscription (8 caractères au moins), refusée avant
    # toute lecture du code : aucun essai n'est consommé.
    assert reponse.status_code == 422
    assert reponse.get_json()["details"][0]["champ"] == "nouveau_mot_de_passe"
    assert OTPCode.query.filter_by(user_id=user.id).one().attempts == 0
    assert _confirmer(client, TELEPHONE, _code(sms)).status_code == 200


def test_numero_invalide_refuse_en_422(client):
    for route, corps in (("/api/auth/mot-de-passe-oublie", {"phone": "abc"}),
                         ("/api/auth/mot-de-passe-oublie/confirmer",
                          {"phone": "abc", "code": "123456", "nouveau_mot_de_passe": NOUVEAU})):
        reponse = client.post(route, json=corps)
        assert reponse.status_code == 422
        assert reponse.get_json() == {"error": "Numéro de téléphone invalide", "details": [
            {"champ": "phone", "code": "telephone_invalide",
             "message": "Numéro de téléphone invalide"}]}


def test_code_de_verification_refuse_pour_la_reinitialisation(client, fabrique, entetes, codes_otp):
    user = fabrique.locataire(niveau=0, phone=TELEPHONE)
    assert client.post("/api/auth/send-otp", headers=entetes(user), json={}).status_code == 200
    code_de_verification = codes_otp[-1]
    # Le numéro est vérifié par ailleurs, le code de vérification encore en
    # attente : il ne doit pas réinitialiser le mot de passe.
    db.session.get(User, user.id).phone_verified = True
    db.session.commit()

    assert _confirmer(client, TELEPHONE, code_de_verification).status_code == 400
    assert _mot_de_passe_est(user.id, MOT_DE_PASSE)


def test_code_de_reinitialisation_refuse_pour_la_verification(client, fabrique, entetes,
                                                              avec_sms, sms):
    user = fabrique.locataire(niveau=1, phone=TELEPHONE)
    _demander(client, TELEPHONE)
    # Le compte repasse non vérifié, le code de réinitialisation est encore
    # en attente : il ne doit pas vérifier le numéro.
    db.session.get(User, user.id).phone_verified = False
    db.session.commit()

    reponse = client.post("/api/auth/verify-otp", headers=entetes(user), json={"code": _code(sms)})

    assert reponse.status_code == 400
    assert db.session.get(User, user.id).phone_verified is False


def test_empreintes_distinctes_selon_l_usage(app):
    assert auth.hacher_otp("ligne", "123456") != auth.hacher_otp_reinitialisation("ligne", "123456")


def test_quotas_partages_verification_puis_reinitialisation(client, fabrique, entetes,
                                                            avec_sms, sms):
    user = fabrique.locataire(niveau=0, phone=TELEPHONE)
    for _ in range(4):
        assert client.post("/api/auth/send-otp", headers=entetes(user), json={}).status_code == 200
        _reculer(user)
    assert client.post("/api/auth/verify-otp", headers=entetes(user),
                       json={"code": _code(sms)}).status_code == 200

    _demander(client, TELEPHONE)  # 5e code du jour pour ce compte
    _reculer(user)
    reponse = _demander(client, TELEPHONE)

    # Quota du compte atteint : rien n'est envoyé, et la réponse ne le dit pas.
    assert reponse.status_code == 200
    assert reponse.get_json()["message"] == auth.MESSAGE_OUBLI
    assert len(sms) == 5


def test_quotas_partages_reinitialisation_puis_verification(client, fabrique, entetes,
                                                            avec_sms, sms):
    user = fabrique.locataire(niveau=1, phone=TELEPHONE)
    for _ in range(5):
        _demander(client, TELEPHONE)
        _reculer(user)
    assert len(sms) == 5

    db.session.get(User, user.id).phone_verified = False
    db.session.commit()
    reponse = client.post("/api/auth/send-otp", headers=entetes(user), json={})

    assert reponse.status_code == 429
    assert reponse.get_json()["error"].startswith("5 codes maximum par jour pour ce compte.")
    assert len(sms) == 5


def test_quota_par_numero_partage_entre_comptes(client, fabrique, avec_sms, sms):
    user = fabrique.locataire(niveau=1, phone=TELEPHONE)
    # Cinq codes envoyés à ce numéro, il y a une heure, à un autre compte qui
    # l'a libéré depuis.
    ancien = fabrique.locataire(niveau=0, phone=None, phone_verified=False)
    il_y_a_1h = datetime.utcnow() - timedelta(hours=1)
    for _ in range(5):
        db.session.add(OTPCode(user_id=ancien.id, phone=TELEPHONE, code_hash="x" * 64,
                               is_used=True, created_at=il_y_a_1h, expires_at=il_y_a_1h))
    db.session.commit()

    assert _demander(client, TELEPHONE).status_code == 200
    assert sms == []
    assert OTPCode.query.filter_by(user_id=user.id).count() == 0


def test_antispam_de_60_secondes(client, fabrique, avec_sms, sms):
    fabrique.locataire(niveau=1, phone=TELEPHONE)
    _demander(client, TELEPHONE)
    assert _demander(client, TELEPHONE).status_code == 200
    assert len(sms) == 1


def test_compte_desactive_pas_de_reinitialisation(client, fabrique, avec_sms, sms):
    user = fabrique.locataire(niveau=1, phone=TELEPHONE)
    _demander(client, TELEPHONE)
    # Désactivé par l'administration après l'envoi du code.
    db.session.get(User, user.id).is_active = False
    db.session.commit()

    assert _confirmer(client, TELEPHONE, _code(sms)).status_code == 400
    assert _mot_de_passe_est(user.id, MOT_DE_PASSE)
    # Et un compte désactivé ne reçoit plus de code.
    _reculer(user)
    _demander(client, TELEPHONE)
    assert len(sms) == 1


def test_mot_de_passe_oublie_limite_par_numero(client, fabrique):
    # Même limite pour un numéro inscrit ou non : le 429 ne révèle rien.
    fabrique.locataire(niveau=1, phone=TELEPHONE)
    # Une IP par demande : seule la limite par numéro est en jeu. Le numéro
    # inscrit est écrit de six façons, qui comptent comme un seul numéro.
    for n, ecritures in enumerate((ECRITURES[:6], ["620000004"] * 6)):
        codes = [_demander(client, ecriture, xff=f"{n + 1}.1.1.{i}").status_code
                 for i, ecriture in enumerate(ecritures)]
        assert codes == [200] * 5 + [429], ecritures[0]


def test_mot_de_passe_oublie_limite_par_ip(client):
    codes = [_demander(client, f"+2246200001{i:02d}").status_code for i in range(11)]
    assert codes == [200] * 10 + [429]
    reponse = _demander(client, "+224620000200")
    assert int(reponse.headers["Retry-After"]) > 0
    assert _demander(client, "+224620000200", xff="9.9.9.9").status_code == 200


def test_confirmation_limitee_par_ip_sur_les_echecs(client):
    codes = [_confirmer(client, f"+2246200001{i:02d}", "123456").status_code for i in range(21)]
    assert codes == [400] * 20 + [429]
    # Une autre IP n'est pas concernée.
    assert _confirmer(client, "+224620000200", "123456", xff="9.9.9.9").status_code == 400


def test_confirmation_limitee_par_numero_toutes_ip(client, fabrique, avec_sms, sms):
    user = fabrique.locataire(niveau=1, phone=TELEPHONE)
    codes = [_confirmer(client, ECRITURES[i % len(ECRITURES)], "123456",
                        xff=f"1.1.1.{i}").status_code for i in range(11)]
    assert codes == [400] * 10 + [429]

    # La limite tombe avant la lecture du code : même le bon est refusé.
    _demander(client, TELEPHONE, xff="5.5.5.5")
    assert _confirmer(client, TELEPHONE, _code(sms), xff="6.6.6.6").status_code == 429
    assert _mot_de_passe_est(user.id, MOT_DE_PASSE)


def test_plafond_global_bloque_la_reinitialisation_en_silence(app, client, fabrique, avec_sms, sms):
    # Plafond global des SMS (lot 1.21) ramené à un code par heure.
    app.config["OTP_PLAFOND_GLOBAL_PAR_HEURE"] = 1
    fabrique.locataire(niveau=1, phone=TELEPHONE)
    autre = fabrique.locataire(niveau=1, phone="+224620000001")
    premier = _demander(client, TELEPHONE)

    reponse = _demander(client, autre.phone)

    # Refus silencieux : même réponse, aucun code, aucun SMS.
    assert reponse.status_code == 200
    assert reponse.get_json() == premier.get_json()
    assert len(sms) == 1
    assert OTPCode.query.filter_by(user_id=autre.id).count() == 0


def test_reinitialisation_comptee_par_le_plafond_global(app, client, fabrique, entetes,
                                                        avec_sms, sms):
    # Le code de réinitialisation occupe la place : la vérification d'un
    # autre compte est refusée par le plafond.
    app.config["OTP_PLAFOND_GLOBAL_PAR_HEURE"] = 1
    fabrique.locataire(niveau=1, phone=TELEPHONE)
    _demander(client, TELEPHONE)
    autre = fabrique.locataire(niveau=0, phone="+224620000001")

    reponse = client.post("/api/auth/send-otp", headers=entetes(autre), json={})

    assert reponse.status_code == 429
    assert "saturé" in reponse.get_json()["error"]


# ─── Comptes administrateurs : ni connexion par téléphone, ni SMS ──

def test_admin_pas_de_connexion_par_telephone(client, fabrique, monkeypatch):
    admin = fabrique.admin(phone=TELEPHONE, phone_verified=True)

    par_telephone = _connexion(client, TELEPHONE)
    inconnu = _connexion(client, "+224620000999")
    assert par_telephone.status_code == inconnu.status_code == 401
    assert par_telephone.get_json() == inconnu.get_json()
    # L'e-mail reste la voie de connexion de l'administrateur.
    assert _connexion(client, admin.email).status_code == 200

    appels = []
    monkeypatch.setattr(auth, "check_password_hash", lambda h, mdp: appels.append(h) or True)
    assert _connexion(client, TELEPHONE).status_code == 401
    assert appels == [auth.HASH_FACTICE]


def test_admin_pas_de_reinitialisation_par_sms(client, fabrique, avec_sms, sms):
    admin = fabrique.admin(phone=TELEPHONE, phone_verified=True)

    reponse = _demander(client, TELEPHONE)
    inconnu = _demander(client, "+224620000999")

    assert reponse.status_code == 200 and reponse.get_json() == inconnu.get_json()
    assert sms == []
    assert OTPCode.query.filter_by(user_id=admin.id).count() == 0

    # Même un code de réinitialisation valide (émis avant la règle, par
    # exemple) ne sert pas.
    otp_id = "code-admin"
    maintenant = datetime.utcnow()
    db.session.add(OTPCode(id=otp_id, user_id=admin.id, phone=TELEPHONE, attempts=0,
                           code_hash=auth.hacher_otp_reinitialisation(otp_id, "123456"),
                           created_at=maintenant - timedelta(minutes=2),
                           expires_at=maintenant + timedelta(minutes=5)))
    db.session.commit()
    refus = _confirmer(client, TELEPHONE, "123456")
    assert refus.status_code == 400
    assert refus.get_json() == {"error": auth.REFUS_CONFIRMATION, "details": []}
    assert _mot_de_passe_est(admin.id, MOT_DE_PASSE)
