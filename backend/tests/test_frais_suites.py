"""Lot 2.12 : suites de D1 (décisions de Kamano du 27/10/2026).

  • frais remboursés si le bailleur refuse ou écarte une candidature après
    les avoir payés ; pas remboursés si le locataire se retire ;
  • GNF seulement : sur une annonce en XOF, GHS ou NGN, les services
    payants sont refusés (422 `devise_non_prise_en_charge`).
"""
from datetime import datetime

import pytest

from app.models import Match, Notification, Payment
from tests.test_cycle_annonce import _verrous_pendant

FRAIS = "frais_mise_en_relation"


def _notifications(user, type_notif):
    return Notification.query.filter_by(user_id=user.id, type=type_notif).all()


@pytest.fixture
def acceptee_payee(fabrique, locataire, annonce, bailleur):
    """Candidature acceptée par la confirmation des frais du bailleur."""
    candidature = fabrique.match(locataire, annonce, status="accepted")
    fabrique.paiement(bailleur, type_paiement=FRAIS, match_id=candidature.id,
                      listing_id=annonce.id, statut="success", paid_at=datetime.utcnow())
    return candidature


def _frais(candidature):
    return Payment.query.filter_by(match_id=candidature.id, type_paiement=FRAIS).one()


# ─── Refus par le bailleur : remboursés ──────────────────────

def test_refus_apres_paiement_frais_a_rembourser(client, acceptee_payee, bailleur, admin,
                                                 entetes):
    reponse = client.put(f"/api/matches/{acceptee_payee.id}/statut", headers=entetes(bailleur),
                         json={"statut": "rejected"})

    assert reponse.status_code == 200
    corps = reponse.get_json()
    assert "remboursés" in corps["message"]
    assert [p["statut"] for p in corps["frais_a_rembourser"]] == ["a_rembourser"]
    assert Match.query.get(acceptee_payee.id).status == "rejected"
    assert _frais(acceptee_payee).statut == "a_rembourser"
    # Les administrateurs remboursent (circuit du lot 1.3b), le bailleur est prévenu.
    [pour_admin] = _notifications(admin, "paiement_a_rembourser")
    assert _frais(acceptee_payee).reference in pour_admin.contenu
    [pour_bailleur] = _notifications(bailleur, "paiement_a_rembourser")
    assert "la candidature a été écartée après le paiement des frais" in pour_bailleur.contenu
    # Le paiement figure parmi les remboursements à faire.
    file_admin = client.get("/api/admin/paiements-a-rembourser", headers=entetes(admin))
    assert file_admin.status_code == 200
    [ligne] = file_admin.get_json()
    assert (ligne["id"], ligne["motif"]) == (_frais(acceptee_payee).id, "ecartee_par_le_bailleur")


def test_refus_sans_frais_payes_ne_rembourse_rien(client, fabrique, locataire, annonce,
                                                  bailleur, admin, entetes):
    candidature = fabrique.match(locataire, annonce)

    reponse = client.put(f"/api/matches/{candidature.id}/statut", headers=entetes(bailleur),
                         json={"statut": "rejected"})

    assert reponse.status_code == 200
    assert reponse.get_json()["message"] == "Candidature refusée"
    assert reponse.get_json()["frais_a_rembourser"] == []
    assert _notifications(admin, "paiement_a_rembourser") == []


def test_un_autre_bailleur_ne_peut_ni_refuser_ni_declencher_un_remboursement(
        client, fabrique, acceptee_payee, entetes):
    intrus = fabrique.bailleur()

    reponse = client.put(f"/api/matches/{acceptee_payee.id}/statut", headers=entetes(intrus),
                         json={"statut": "rejected"})

    assert reponse.status_code == 403
    assert Match.query.get(acceptee_payee.id).status == "accepted"
    assert _frais(acceptee_payee).statut == "success"


def test_conclure_avec_un_autre_rembourse_les_frais_des_candidatures_ecartees(
        client, fabrique, acceptee_payee, annonce, bailleur, admin, entetes):
    retenue = fabrique.match(fabrique.locataire(niveau=1), annonce, status="accepted")
    fabrique.paiement(bailleur, type_paiement=FRAIS, match_id=retenue.id,
                      listing_id=annonce.id, statut="success")

    reponse = client.put(f"/api/matches/{retenue.id}/conclure", headers=entetes(bailleur))

    assert reponse.status_code == 200
    assert Match.query.get(acceptee_payee.id).status == "rejected"
    assert _frais(acceptee_payee).statut == "a_rembourser"
    # Les frais de la location conclue sont dus.
    assert _frais(retenue).statut == "success"
    assert len(_notifications(admin, "paiement_a_rembourser")) == 1


def test_un_autre_bailleur_ne_peut_pas_conclure_ni_rembourser(client, fabrique, acceptee_payee,
                                                             annonce, entetes):
    retenue = fabrique.match(fabrique.locataire(niveau=1), annonce, status="accepted")
    intrus = fabrique.bailleur()

    reponse = client.put(f"/api/matches/{retenue.id}/conclure", headers=entetes(intrus))

    assert reponse.status_code == 403
    assert Match.query.get(acceptee_payee.id).status == "accepted"
    assert Match.query.get(retenue.id).status == "accepted"
    assert _frais(acceptee_payee).statut == "success"


def test_course_paiement_puis_refus_motif_candidature_close(client, fabrique, locataire, annonce,
                                                           bailleur, admin, entetes):
    # Frais encaissés alors que la candidature n'était plus en attente : jamais
    # confirmés (pas de `paid_at`), le motif reste celui du lot 2.4.
    candidature = fabrique.match(locataire, annonce, status="rejected")
    fabrique.paiement(bailleur, type_paiement=FRAIS, match_id=candidature.id,
                      listing_id=annonce.id, statut="a_rembourser")

    [ligne] = client.get("/api/admin/paiements-a-rembourser", headers=entetes(admin)).get_json()

    assert ligne["motif"] == "candidature_close"


# ─── Retrait par le locataire : pas de remboursement ─────────

def test_retrait_du_locataire_frais_gardes_et_bailleur_prevenu(client, acceptee_payee, locataire,
                                                               bailleur, admin, entetes):
    reponse = client.delete(f"/api/matches/{acceptee_payee.id}", headers=entetes(locataire))

    assert reponse.status_code == 200
    assert Match.query.get(acceptee_payee.id).status == "cancelled"
    assert _frais(acceptee_payee).statut == "success"
    assert _notifications(admin, "paiement_a_rembourser") == []
    [retrait] = _notifications(bailleur, "candidature_retiree")
    assert locataire.full_name in retrait.contenu
    assert "ne sont pas remboursés" in retrait.contenu
    assert retrait.lien == f"/owner/matches?match={acceptee_payee.id}"


def test_retrait_d_une_acceptation_sans_frais_previent_sans_parler_de_frais(
        client, fabrique, locataire, bailleur, entetes):
    vente = fabrique.annonce(bailleur, type_transaction="vente")
    candidature = fabrique.match(locataire, vente, status="accepted")

    client.delete(f"/api/matches/{candidature.id}", headers=entetes(locataire))

    [retrait] = _notifications(bailleur, "candidature_retiree")
    assert "frais" not in retrait.contenu


def test_retrait_d_une_candidature_en_attente_ne_previent_pas(client, fabrique, locataire,
                                                              annonce, bailleur, entetes):
    candidature = fabrique.match(locataire, annonce)

    assert client.delete(f"/api/matches/{candidature.id}",
                         headers=entetes(locataire)).status_code == 200
    assert _notifications(bailleur, "candidature_retiree") == []


def test_retrait_verrouille_l_annonce_puis_la_candidature_puis_les_frais(
        client, acceptee_payee, locataire, entetes):
    reponse, verrous = _verrous_pendant(
        client, lambda: client.delete(f"/api/matches/{acceptee_payee.id}",
                                      headers=entetes(locataire)))

    assert reponse.status_code == 200
    assert ["FROM listings" in v for v in verrous] == [True, False, False]
    assert "FROM matches" in verrous[1] and verrous[1].endswith("FOR NO KEY UPDATE")
    assert "FROM payments" in verrous[2]


def test_retrait_par_un_autre_locataire_refuse(client, fabrique, acceptee_payee, bailleur,
                                               entetes):
    intrus = fabrique.locataire(niveau=1)

    reponse = client.delete(f"/api/matches/{acceptee_payee.id}", headers=entetes(intrus))

    assert reponse.status_code == 403
    assert Match.query.get(acceptee_payee.id).status == "accepted"
    assert _notifications(bailleur, "candidature_retiree") == []


# ─── GNF seulement ───────────────────────────────────────────

@pytest.mark.parametrize("devise", ["XOF", "GHS", "NGN"])
@pytest.mark.parametrize("type_paiement", ["certification", "mise_en_avant", FRAIS])
def test_services_payants_refuses_hors_gnf(client, fabrique, locataire, bailleur, entetes,
                                           cinetpay, devise, type_paiement):
    annonce = fabrique.annonce(bailleur, devise=devise)
    corps = {"type_paiement": type_paiement, "listing_id": annonce.id}
    if type_paiement == FRAIS:
        corps = {"type_paiement": FRAIS, "match_id": fabrique.match(locataire, annonce).id}

    reponse = client.post("/api/payments/initier", headers=entetes(bailleur), json=corps)

    assert reponse.status_code == 422
    erreur = reponse.get_json()
    [detail] = erreur["details"]
    assert detail["code"] == "devise_non_prise_en_charge"
    assert detail["champ"] == ("match_id" if type_paiement == FRAIS else "listing_id")
    assert erreur["error"].endswith(f"cette annonce est en {devise}.")
    assert Payment.query.count() == 0
    assert cinetpay.reseau.appels == []


def test_devise_controlee_avant_la_reprise_d_un_paiement_en_attente(client, fabrique, bailleur,
                                                                  entetes, cinetpay):
    annonce_xof = fabrique.annonce(bailleur, devise="XOF")
    fabrique.paiement(bailleur, type_paiement="mise_en_avant", listing_id=annonce_xof.id,
                      devise="XOF", montant=200_000)

    reponse = client.post("/api/payments/initier", headers=entetes(bailleur),
                          json={"type_paiement": "mise_en_avant", "listing_id": annonce_xof.id})

    assert reponse.status_code == 422
    # Aucune vérification du paiement en attente auprès de CinetPay.
    assert cinetpay.reseau.appels == []


def test_abonnement_passeport_toujours_en_gnf(client, locataire, entetes, cinetpay):
    reponse = client.post("/api/payments/initier", headers=entetes(locataire),
                          json={"type_paiement": "abonnement_passeport", "methode": "orange_money"})

    assert reponse.status_code == 200
    assert Payment.query.one().devise == "GNF"


def test_tarifs_en_gnf_seulement(client):
    corps = client.get("/api/payments/tarifs").get_json()

    assert corps["devise"] == "GNF"
    assert corps["devises_prises_en_charge"] == ["GNF"]
    assert {s["type"] for s in corps["services"]} == {
        FRAIS, "certification", "mise_en_avant", "abonnement_passeport"}
