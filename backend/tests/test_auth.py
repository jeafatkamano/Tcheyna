"""Blueprint auth : inscription, connexion, jetons, vérification du téléphone."""
from app.models import OTPCode, TenantPassport, User
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

    assert reponse.status_code == 400
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
    reponse = client.put("/api/auth/password", headers=entetes(locataire),
                         json={"ancien_mot_de_passe": "faux", "nouveau_mot_de_passe": "nouveau-mdp"})
    assert reponse.status_code == 401


def test_otp_envoye_par_sms_puis_verifie(app, client, fabrique, entetes, sms):
    app.config["AT_API_KEY"] = "cle-at-de-test"
    user = fabrique.locataire(niveau=0)

    envoi = client.post("/api/auth/send-otp", headers=entetes(user), json={})
    assert envoi.status_code == 200
    # Le code ne doit jamais apparaître dans la réponse hors mode debug.
    assert "debug_code" not in envoi.get_json()
    assert len(sms) == 1 and sms[0]["destinataires"] == [user.phone]

    code = OTPCode.query.filter_by(user_id=user.id, is_used=False).one().code
    assert code in sms[0]["message"]
    verif = client.post("/api/auth/verify-otp", headers=entetes(user), json={"code": code})

    assert verif.status_code == 200
    assert verif.get_json()["trust_level"] == 1


def test_otp_incorrect_refuse(client, fabrique, entetes):
    user = fabrique.locataire(niveau=0)
    client.post("/api/auth/send-otp", headers=entetes(user), json={})

    code = OTPCode.query.filter_by(user_id=user.id).one().code
    faux = "000000" if code != "000000" else "111111"
    reponse = client.post("/api/auth/verify-otp", headers=entetes(user), json={"code": faux})

    assert reponse.status_code == 400
    assert User.query.get(user.id).trust_level == 0


def test_niveaux_publics(client):
    reponse = client.get("/api/auth/niveaux")
    assert reponse.status_code == 200
    assert [n["niveau"] for n in reponse.get_json()["niveaux"]] == [0, 1, 2, 3, 4]
