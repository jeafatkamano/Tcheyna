"""Blueprint reviews : avis croisés après une location conclue."""
from app.models import Review


def test_avis_du_locataire_apres_conclusion(client, fabrique, locataire, annonce, bailleur, entetes):
    conclu = fabrique.match(locataire, annonce, status="completed")

    reponse = client.post("/api/reviews/", headers=entetes(locataire),
                          json={"match_id": conclu.id, "note": 5, "commentaire": "Très sérieux"})

    assert reponse.status_code == 201
    publics = client.get(f"/api/reviews/user/{bailleur.id}").get_json()
    assert publics["total"] == 1 and publics["moyenne"] == 5


def test_avis_impossible_avant_conclusion(client, match, locataire, entetes):
    reponse = client.post("/api/reviews/", headers=entetes(locataire),
                          json={"match_id": match.id, "note": 4})
    assert reponse.status_code == 400


def test_avis_refuse_a_un_tiers(client, fabrique, locataire, annonce, entetes):
    conclu = fabrique.match(locataire, annonce, status="completed")
    tiers = fabrique.locataire()

    reponse = client.post("/api/reviews/", headers=entetes(tiers),
                          json={"match_id": conclu.id, "note": 1})

    assert reponse.status_code == 403
    assert Review.query.count() == 0


def test_avis_a_donner(client, fabrique, locataire, annonce, bailleur, entetes):
    fabrique.match(locataire, annonce, status="completed")
    reponse = client.get("/api/reviews/a-donner", headers=entetes(bailleur))
    assert reponse.get_json()["total"] == 1
