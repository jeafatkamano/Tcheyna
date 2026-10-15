"""Blueprint payments : CinetPay simulé, aucun appel réel."""
from app.models import Payment


def test_tarifs_publics(client):
    reponse = client.get("/api/payments/tarifs")
    assert reponse.status_code == 200
    assert reponse.get_json()["devise"] == "GNF"


def test_initiation_sans_passerelle_reste_en_attente(client, annonce, bailleur, entetes, reseau):
    reponse = client.post("/api/payments/initier", headers=entetes(bailleur),
                          json={"type_paiement": "certification", "listing_id": annonce.id})

    assert reponse.status_code == 200
    assert reponse.get_json()["mode"] == "hors_ligne"
    assert reseau.appels == []


def test_initiation_avec_cinetpay_simule(client, annonce, bailleur, entetes, cinetpay):
    reponse = client.post("/api/payments/initier", headers=entetes(bailleur),
                          json={"type_paiement": "certification", "listing_id": annonce.id})

    assert reponse.status_code == 200
    assert reponse.get_json()["payment_url"] == "https://checkout.cinetpay.test/paiement"
    envoi = cinetpay.reseau.appels_vers(cinetpay.url_init)[0]["json"]
    # Le montant est fixé par le serveur, jamais par le client.
    assert (envoi["amount"], envoi["currency"]) == (250_000, "GNF")


def test_initiation_refusee_pour_l_annonce_d_un_autre(client, fabrique, annonce, entetes):
    intrus = fabrique.bailleur()
    reponse = client.post("/api/payments/initier", headers=entetes(intrus),
                          json={"type_paiement": "certification", "listing_id": annonce.id})

    assert reponse.status_code == 403
    assert Payment.query.count() == 0


def test_callback_verifie_aupres_de_cinetpay_puis_applique(client, fabrique, annonce, bailleur,
                                                           cinetpay):
    paiement = fabrique.paiement(bailleur, listing_id=annonce.id)

    # Le corps du webhook ne porte que l'identifiant : le statut vient de CinetPay.
    reponse = client.post("/api/payments/callback",
                          json={"cpm_trans_id": paiement.cinetpay_transaction_id})

    assert reponse.status_code == 200
    assert len(cinetpay.verifications) == 1
    assert paiement.statut == "success"
    assert annonce.certification_status == "pending"


def test_callback_transaction_inconnue_ignoree(client, cinetpay):
    reponse = client.post("/api/payments/callback", json={"cpm_trans_id": "INCONNUE"})

    assert reponse.status_code == 200
    assert cinetpay.verifications == []


def test_recu_illisible_par_un_tiers(client, fabrique, bailleur, entetes):
    paiement = fabrique.paiement(bailleur)
    tiers = fabrique.locataire()

    assert client.get(f"/api/payments/{paiement.id}", headers=entetes(tiers)).status_code == 403
    assert client.get(f"/api/payments/{paiement.id}", headers=entetes(bailleur)).status_code == 200


def test_mes_paiements(client, fabrique, bailleur, entetes):
    fabrique.paiement(bailleur, statut="success")
    corps = client.get("/api/payments/mes-paiements", headers=entetes(bailleur)).get_json()
    assert corps["total"] == 1 and corps["total_paye"] == 250_000
