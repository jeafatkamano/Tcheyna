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


def test_acceptation_ouvre_la_conversation(client, fabrique, locataire, bailleur, entetes):
    # Une vente s'accepte sans frais (D1) : l'acceptation prend effet tout de suite.
    candidature = fabrique.match(locataire, fabrique.annonce(bailleur, type_transaction="vente"))

    reponse = client.put(f"/api/matches/{candidature.id}/statut", headers=entetes(bailleur),
                         json={"statut": "accepted"})

    assert reponse.status_code == 200
    assert reponse.get_json()["match"]["status"] == "accepted"
    assert Conversation.query.filter_by(match_id=candidature.id).count() == 1
    assert Notification.query.filter_by(user_id=locataire.id,
                                        type="candidature_acceptee").count() == 1


def test_acceptation_d_une_location_attend_les_frais(client, fabrique, locataire, annonce,
                                                     bailleur, entetes):
    # D1 : la décision du bailleur ne prend effet qu'au paiement confirmé des
    # frais de mise en relation (parcours complet dans test_payments.py).
    candidature = fabrique.match(locataire, annonce)

    reponse = client.put(f"/api/matches/{candidature.id}/statut", headers=entetes(bailleur),
                         json={"statut": "accepted"})

    assert reponse.status_code == 402
    assert reponse.get_json()["action_requise"] == "payer_frais_mise_en_relation"
    assert Match.query.get(candidature.id).status == "pending"
    assert Conversation.query.filter_by(match_id=candidature.id).count() == 0
    assert Notification.query.filter_by(user_id=locataire.id).count() == 0


def test_refus_d_une_location_reste_libre(client, fabrique, locataire, annonce, bailleur,
                                          entetes):
    candidature = fabrique.match(locataire, annonce)

    reponse = client.put(f"/api/matches/{candidature.id}/statut", headers=entetes(bailleur),
                         json={"statut": "rejected"})

    assert reponse.status_code == 200
    assert Match.query.get(candidature.id).status == "rejected"
    assert Notification.query.filter_by(user_id=locataire.id,
                                        type="candidature_refusee").count() == 1


def test_location_acceptee_avant_d1_reste_acceptee(client, match, bailleur, entetes):
    # Candidature acceptée avant D1 : la décision est maintenue, sans frais.
    reponse = client.put(f"/api/matches/{match.id}/statut", headers=entetes(bailleur),
                         json={"statut": "accepted"})

    assert reponse.status_code == 200
    assert reponse.get_json()["match"]["commission"] == 0


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
