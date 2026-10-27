"""Blueprint reviews : avis croisés après une location conclue."""
from datetime import datetime, timedelta

from app import db
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


# ─── D8 : avis possible pendant 30 jours après la conclusion ─

def _conclue_il_y_a(fabrique, locataire, annonce, jours):
    conclu = fabrique.match(locataire, annonce, status="completed")
    conclu.completed_at = datetime.utcnow() - timedelta(days=jours)
    db.session.commit()
    return conclu


def test_avis_possible_avant_30_jours(client, fabrique, locataire, annonce, entetes):
    conclu = _conclue_il_y_a(fabrique, locataire, annonce, 29)

    reponse = client.post("/api/reviews/", headers=entetes(locataire),
                          json={"match_id": conclu.id, "note": 4})

    assert reponse.status_code == 201


def test_avis_refuse_apres_30_jours(client, fabrique, locataire, annonce, bailleur, entetes):
    conclu = _conclue_il_y_a(fabrique, locataire, annonce, 31)

    for auteur in (locataire, bailleur):
        reponse = client.post("/api/reviews/", headers=entetes(auteur),
                              json={"match_id": conclu.id, "note": 5})
        assert reponse.status_code == 400
        assert "30 jours" in reponse.get_json()["error"]
    assert Review.query.count() == 0


def test_avis_a_donner_sans_les_locations_hors_delai(client, fabrique, locataire, annonce,
                                                     bailleur, entetes):
    _conclue_il_y_a(fabrique, locataire, annonce, 31)

    for partie in (locataire, bailleur):
        assert client.get("/api/reviews/a-donner",
                          headers=entetes(partie)).get_json()["total"] == 0


def test_tiers_refuse_meme_hors_delai(client, fabrique, locataire, annonce, entetes):
    # Le tiers reçoit le refus d'accès, pas l'état du délai de cette location.
    conclu = _conclue_il_y_a(fabrique, locataire, annonce, 31)

    reponse = client.post("/api/reviews/", headers=entetes(fabrique.locataire()),
                          json={"match_id": conclu.id, "note": 1})

    assert reponse.status_code == 403


def test_conclusion_sans_date_se_rabat_sur_la_mise_a_jour(client, fabrique, locataire,
                                                          annonce, entetes):
    conclu = fabrique.match(locataire, annonce, status="completed")
    conclu.completed_at = None
    conclu.updated_at = datetime.utcnow() - timedelta(days=31)
    db.session.commit()

    reponse = client.post("/api/reviews/", headers=entetes(locataire),
                          json={"match_id": conclu.id, "note": 5})

    assert reponse.status_code == 400
