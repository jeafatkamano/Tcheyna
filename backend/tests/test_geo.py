"""Blueprint geo : référentiel public."""


def test_referentiel_complet(client):
    reponse = client.get("/api/geo/referentiel")

    assert reponse.status_code == 200
    corps = reponse.get_json()
    assert corps["marches_ouverts"] == ["Guinée"]
    assert "Kipé" in corps["locations"]["Guinée"]["Conakry"]


def test_quartiers_d_une_ville(client):
    reponse = client.get("/api/geo/quartiers/Guinée/Conakry")
    assert reponse.status_code == 200
    assert "Kaloum Centre" in reponse.get_json()["quartiers"]


def test_pays_inconnu_introuvable(client):
    assert client.get("/api/geo/villes/Mars").status_code == 404
    assert client.get("/api/geo/quartiers/Guinée/Atlantis").status_code == 404
