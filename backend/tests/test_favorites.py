"""Blueprint favorites : annonces sauvegardées."""


def test_ajout_liste_et_retrait_d_un_favori(client, locataire, annonce, entetes):
    assert client.post(f"/api/favorites/{annonce.id}", headers=entetes(locataire)).status_code == 201
    # Idempotent : un second ajout ne crée pas de doublon.
    assert client.post(f"/api/favorites/{annonce.id}", headers=entetes(locataire)).status_code == 200

    liste = client.get("/api/favorites/", headers=entetes(locataire)).get_json()
    assert [a["id"] for a in liste["listings"]] == [annonce.id]

    assert client.delete(f"/api/favorites/{annonce.id}", headers=entetes(locataire)).status_code == 200
    assert client.get("/api/favorites/", headers=entetes(locataire)).get_json()["total"] == 0


def test_favoris_exigent_un_compte(client, annonce):
    assert client.get("/api/favorites/").status_code == 401
    assert client.post(f"/api/favorites/{annonce.id}").status_code == 401


def test_favori_sur_annonce_inexistante(client, locataire, entetes):
    assert client.post("/api/favorites/inexistante", headers=entetes(locataire)).status_code == 404
