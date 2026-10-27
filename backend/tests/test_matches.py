"""Blueprint matches : candidature, décision du bailleur, conclusion."""
from app.models import Conversation, Match, Notification


def test_candidature_d_un_locataire_basique(client, locataire, annonce, entetes):
    reponse = client.post("/api/matches/", headers=entetes(locataire),
                          json={"listing_id": annonce.id, "message": "Disponible dès lundi"})

    assert reponse.status_code == 201
    assert Match.query.filter_by(tenant_id=locataire.id).count() == 1
    assert Notification.query.filter_by(user_id=annonce.landlord_id,
                                        type="nouvelle_candidature").count() == 1


def test_candidature_refusee_sans_telephone_verifie(client, fabrique, annonce, entetes):
    novice = fabrique.locataire(niveau=0)
    reponse = client.post("/api/matches/", headers=entetes(novice),
                          json={"listing_id": annonce.id})

    assert reponse.status_code == 403
    assert reponse.get_json()["action_requise"] == "verifier_telephone"


def test_candidature_annonce_certifiee_exige_le_niveau_2(client, fabrique, locataire, entetes):
    certifiee = fabrique.annonce(certification_status="certified")
    reponse = client.post("/api/matches/", headers=entetes(locataire),
                          json={"listing_id": certifiee.id})
    assert reponse.status_code == 403


def test_acceptation_ouvre_la_conversation(client, fabrique, locataire, annonce, bailleur, entetes):
    candidature = fabrique.match(locataire, annonce)

    reponse = client.put(f"/api/matches/{candidature.id}/statut", headers=entetes(bailleur),
                         json={"statut": "accepted"})

    assert reponse.status_code == 200
    assert Conversation.query.filter_by(match_id=candidature.id).count() == 1


def test_decision_refusee_a_un_autre_bailleur(client, fabrique, locataire, annonce, entetes):
    candidature = fabrique.match(locataire, annonce)
    intrus = fabrique.bailleur()

    reponse = client.put(f"/api/matches/{candidature.id}/statut", headers=entetes(intrus),
                         json={"statut": "accepted"})

    assert reponse.status_code == 403
    assert candidature.status == "pending"


def test_candidature_illisible_par_un_tiers(client, fabrique, match, entetes):
    tiers = fabrique.locataire()
    # 404 et non 403 (lot 1.6) : pas d'oracle sur l'existence de la candidature.
    assert client.get(f"/api/matches/{match.id}", headers=entetes(tiers)).status_code == 404


def test_conclusion_libere_les_autres_candidats(client, fabrique, match, annonce, bailleur, entetes):
    autre = fabrique.match(fabrique.locataire(), annonce)

    reponse = client.put(f"/api/matches/{match.id}/conclure", headers=entetes(bailleur))

    assert reponse.status_code == 200
    assert match.status == "completed"
    assert annonce.status == "matched"
    assert autre.status == "rejected"


def test_mes_demandes_cote_bailleur(client, match, bailleur, entetes):
    reponse = client.get("/api/matches/mes-demandes", headers=entetes(bailleur))
    assert reponse.status_code == 200
    assert reponse.get_json()["stats"]["acceptees"] == 1
