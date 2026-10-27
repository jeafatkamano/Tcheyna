"""Blueprint matches : candidature, décision du bailleur, conclusion."""
import pytest
from sqlalchemy.dialects import postgresql

from app import db
from app.models import Conversation, Listing, Match, Notification
from app.routes import matches


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


# ─── Lot 2.4 · Frais de mise en relation (D1) ────────────────

def test_bascule_en_vente_refusee_pour_contourner_les_frais(client, fabrique, locataire,
                                                            annonce, bailleur, entetes):
    # Scénario de contournement : passer l'annonce en « vente », accepter
    # gratuitement, puis revenir en location.
    candidature = fabrique.match(locataire, annonce)

    bascule = client.put(f"/api/listings/{annonce.id}", headers=entetes(bailleur),
                         json={"type_transaction": "vente"})
    acceptation = client.put(f"/api/matches/{candidature.id}/statut", headers=entetes(bailleur),
                             json={"statut": "accepted"})

    assert bascule.status_code == 409
    assert "type de transaction" in bascule.get_json()["error"]
    assert Listing.query.get(annonce.id).type_transaction == "location"
    assert acceptation.status_code == 402
    assert Match.query.get(candidature.id).status == "pending"
    assert Conversation.query.filter_by(match_id=candidature.id).count() == 0


def test_retour_en_location_refuse_avec_une_candidature_acceptee(client, fabrique, locataire,
                                                                 bailleur, entetes):
    vente = fabrique.annonce(bailleur, type_transaction="vente", caution=None, charges=0)
    candidature = fabrique.match(locataire, vente)
    assert client.put(f"/api/matches/{candidature.id}/statut", headers=entetes(bailleur),
                      json={"statut": "accepted"}).status_code == 200

    reponse = client.put(f"/api/listings/{vente.id}", headers=entetes(bailleur),
                         json={"type_transaction": "location"})

    assert reponse.status_code == 409
    assert Listing.query.get(vente.id).type_transaction == "vente"


def test_type_de_transaction_modifiable_sans_candidature_en_cours(client, fabrique, locataire,
                                                                  annonce, bailleur, entetes):
    fabrique.match(locataire, annonce, status="rejected")
    fabrique.match(fabrique.locataire(), annonce, status="cancelled")

    reponse = client.put(f"/api/listings/{annonce.id}", headers=entetes(bailleur),
                         json={"type_transaction": "vente"})

    assert reponse.status_code == 200
    assert Listing.query.get(annonce.id).type_transaction == "vente"


def test_meme_type_de_transaction_renvoye_reste_accepte(client, fabrique, locataire, annonce,
                                                        bailleur, entetes):
    # Le front renvoie le corps complet : un type inchangé ne bloque rien.
    fabrique.match(locataire, annonce)

    reponse = client.put(f"/api/listings/{annonce.id}", headers=entetes(bailleur),
                         json={"type_transaction": "location", "prix": 2_100_000})

    assert reponse.status_code == 200
    assert Listing.query.get(annonce.id).prix == 2_100_000


def test_decision_relit_la_candidature_sous_verrou():
    requete = matches._requete_candidature_verrouillee("id-quelconque")
    sql = str(requete.compile(dialect=postgresql.dialect()))
    assert "FOR NO KEY UPDATE" in sql
    assert requete.get_execution_options()["populate_existing"] is True


def test_decision_passe_par_la_relecture_verrouillee(client, fabrique, locataire, annonce,
                                                     bailleur, entetes, monkeypatch):
    candidature = fabrique.match(locataire, annonce)
    lues = []
    origine = matches._requete_candidature_verrouillee

    def espion(match_id):
        lues.append(match_id)
        return origine(match_id)

    monkeypatch.setattr(matches, "_requete_candidature_verrouillee", espion)
    client.put(f"/api/matches/{candidature.id}/statut", headers=entetes(bailleur),
               json={"statut": "rejected"})

    assert lues == [candidature.id]


def test_decision_sur_une_candidature_inexistante(client, bailleur, entetes):
    reponse = client.put("/api/matches/inexistante/statut", headers=entetes(bailleur),
                         json={"statut": "accepted"})
    assert reponse.status_code == 404


def test_decision_relit_le_statut_en_base(app, client, fabrique, locataire, annonce, bailleur,
                                          entetes):
    """Confirmation des frais écrite par un autre processus : la décision
    du bailleur lit l'état en base, pas un objet périmé de la session."""
    candidature = fabrique.match(locataire, annonce)
    db.session.connection().exec_driver_sql(
        "UPDATE matches SET status = 'accepted' WHERE id = ?", (candidature.id,))

    reponse = client.put(f"/api/matches/{candidature.id}/statut", headers=entetes(bailleur),
                         json={"statut": "accepted"})

    # Acceptée entre-temps : plus de frais à demander.
    assert reponse.status_code == 200


# Ordre des verrous : l'annonce PUIS la candidature, dans chaque route qui
# lit le type de transaction pour décider. SQLite ignore `FOR UPDATE` : on
# compile en PostgreSQL chaque requête ORM émise pendant la route.

@pytest.fixture
def requetes_pg(app):
    """Requêtes ORM émises pendant le test, compilées en dialecte PostgreSQL."""
    from sqlalchemy import event

    emises = []

    def capturer(etat):
        emises.append(str(etat.statement.compile(dialect=postgresql.dialect())))

    event.listen(db.session, "do_orm_execute", capturer)
    yield emises
    event.remove(db.session, "do_orm_execute", capturer)


def _rang(requetes, table, verrou):
    rangs = [i for i, sql in enumerate(requetes)
             if f"FROM {table}" in sql and sql.rstrip().endswith(verrou)]
    assert rangs, f"aucun verrou {verrou} sur {table}"
    return rangs[0]


def test_verrous_de_la_decision(client, fabrique, locataire, annonce, bailleur, entetes,
                                requetes_pg):
    candidature = fabrique.match(locataire, annonce)
    requetes_pg.clear()

    client.put(f"/api/matches/{candidature.id}/statut", headers=entetes(bailleur),
               json={"statut": "accepted"})

    assert (_rang(requetes_pg, "listings", "FOR UPDATE")
            < _rang(requetes_pg, "matches", "FOR NO KEY UPDATE"))


def test_verrou_de_la_candidature(client, locataire, annonce, entetes, requetes_pg):
    reponse = client.post("/api/matches/", headers=entetes(locataire),
                          json={"listing_id": annonce.id})

    assert reponse.status_code == 201
    rang_annonce = _rang(requetes_pg, "listings", "FOR UPDATE")
    # Le contrôle « déjà candidaté » se fait sous ce verrou.
    assert any(i > rang_annonce and "FROM matches" in sql
               for i, sql in enumerate(requetes_pg))


def test_verrou_du_changement_de_type(client, fabrique, locataire, annonce, bailleur, entetes,
                                      requetes_pg):
    fabrique.match(locataire, annonce)
    requetes_pg.clear()

    client.put(f"/api/listings/{annonce.id}", headers=entetes(bailleur),
               json={"type_transaction": "vente"})

    rang_annonce = _rang(requetes_pg, "listings", "FOR UPDATE")
    # Les candidatures sont lues après le verrou, pas avant.
    lectures = [i for i, sql in enumerate(requetes_pg) if "FROM matches" in sql]
    assert lectures and min(lectures) > rang_annonce


def test_verrous_de_la_confirmation_des_frais(client, fabrique, locataire, annonce, bailleur,
                                              cinetpay, requetes_pg):
    candidature = fabrique.match(locataire, annonce)
    paiement = fabrique.paiement(bailleur, type_paiement="frais_mise_en_relation",
                                 match_id=candidature.id, listing_id=annonce.id)
    requetes_pg.clear()

    client.post("/api/payments/callback", json={"cpm_trans_id": paiement.cinetpay_transaction_id})

    rang_paiement = _rang(requetes_pg, "payments", "FOR UPDATE")
    rang_annonce = _rang(requetes_pg, "listings", "FOR UPDATE")
    rang_candidature = _rang(requetes_pg, "matches", "FOR NO KEY UPDATE")
    assert rang_paiement < rang_annonce < rang_candidature
    assert Match.query.get(candidature.id).status == "accepted"
