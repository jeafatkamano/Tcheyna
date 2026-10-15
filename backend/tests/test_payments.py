"""Blueprint payments : CinetPay simulé, aucun appel réel."""
from datetime import datetime, timedelta

import pytest
from sqlalchemy.dialects import postgresql

from app import db
from app.models import Listing, Notification, Payment
from app.routes import payments


def test_tarifs_publics(client):
    reponse = client.get("/api/payments/tarifs")
    assert reponse.status_code == 200
    corps = reponse.get_json()
    assert corps["devise"] == "GNF"
    # D2 = A : caution et premier loyer ne sont pas des services Tcheyna.
    types = {service["type"] for service in corps["services"]}
    assert types == {"certification", "mise_en_avant", "abonnement_passeport"}


# ─── D2 = A · Caution et premier loyer hors plateforme ───────

@pytest.mark.parametrize("type_paiement", ["caution", "premier_loyer"])
@pytest.mark.parametrize("payeur", ["locataire", "bailleur"])
def test_caution_et_loyer_refuses(client, match, entetes, cinetpay, request, type_paiement,
                                  payeur):
    user = request.getfixturevalue(payeur)
    reponse = client.post("/api/payments/initier", headers=entetes(user), json={
        "type_paiement": type_paiement, "match_id": match.id, "methode": "orange_money",
    })

    assert reponse.status_code == 422
    corps = reponse.get_json()
    assert corps["error"] == ("La caution et le loyer ne se paient pas via Tcheyna : ils se "
                              "règlent directement entre le bailleur et le locataire.")
    assert corps["details"][0]["champ"] == "type_paiement"
    assert corps["details"][0]["code"] == "hors_plateforme"
    assert Payment.query.count() == 0
    assert cinetpay.reseau.appels_vers(cinetpay.url_init) == []


def test_type_de_paiement_requis(client, locataire, entetes):
    # Le type valait « caution » par défaut : un corps sans type est désormais refusé.
    reponse = client.post("/api/payments/initier", headers=entetes(locataire), json={})

    assert reponse.status_code == 422
    assert reponse.get_json()["details"][0]["code"] == "missing"
    assert Payment.query.count() == 0


def test_ancienne_caution_reste_lisible(client, fabrique, match, locataire, bailleur, admin,
                                        entetes):
    ancienne = fabrique.paiement(locataire, type_paiement="caution", match_id=match.id,
                                 listing_id=match.listing_id, montant=4_000_000,
                                 statut="success", paid_at=datetime(2026, 9, 1),
                                 description="Caution — Appartement")

    historique = client.get("/api/payments/mes-paiements", headers=entetes(locataire)).get_json()
    assert historique["total"] == 1 and historique["total_paye"] == 4_000_000
    (ligne,) = historique["paiements"]
    assert (ligne["type_paiement"], ligne["type_label"]) == ("caution", "Dépôt de garantie")

    # Reçu : le payeur, l'autre partie du match et l'administration.
    for user in (locataire, bailleur, admin):
        recu = client.get(f"/api/payments/{ancienne.id}", headers=entetes(user))
        assert recu.status_code == 200
        corps = recu.get_json()
        assert (corps["reference"], corps["montant"], corps["statut"]) == (
            ancienne.reference, 4_000_000, "success")
        assert corps["payeur"]["id"] == locataire.id
        assert corps["listing"]["id"] == match.listing_id

    assert Payment.query.get(ancienne.id).statut == "success"


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


# ─── Lot 1.3 · Paiements fiables ─────────────────────────────

def _callback(client, paiement):
    return client.post("/api/payments/callback",
                       json={"cpm_trans_id": paiement.cinetpay_transaction_id})


def _verifier(client, entetes, user, paiement):
    return client.post(f"/api/payments/{paiement.id}/verifier", headers=entetes(user))


def _notifications_paiement(user):
    return Notification.query.filter_by(user_id=user.id, type="paiement_recu").count()


# Issue inconnue : le paiement reste en attente, un client a peut-être été débité.

def test_callback_panne_reseau_laisse_en_attente(client, fabrique, bailleur, cinetpay):
    paiement = fabrique.paiement(bailleur)
    cinetpay.panne()

    assert _callback(client, paiement).status_code == 200
    assert Payment.query.get(paiement.id).statut == "pending"


def test_callback_reponse_illisible_laisse_en_attente(client, fabrique, bailleur, cinetpay, reseau):
    paiement = fabrique.paiement(bailleur)
    reseau.repondre("POST", cinetpay.url_check, status=502, texte="<html>Bad gateway</html>")

    _callback(client, paiement)
    assert Payment.query.get(paiement.id).statut == "pending"


@pytest.mark.parametrize("reponse", [
    ["pas", "un", "objet"],
    {"code": "00"},
    {"code": "00", "data": "ACCEPTED"},
])
def test_callback_reponse_mal_formee_laisse_en_attente(client, fabrique, bailleur, cinetpay, reseau,
                                                       reponse):
    paiement = fabrique.paiement(bailleur)
    reseau.repondre("POST", cinetpay.url_check, json=reponse)

    _callback(client, paiement)
    assert Payment.query.get(paiement.id).statut == "pending"


@pytest.mark.parametrize("code, statut", [("662", "WAITING_FOR_CUSTOMER"), ("00", "PENDING"),
                                          ("623", None)])
def test_transaction_en_cours_chez_cinetpay_reste_en_attente(client, fabrique, bailleur, entetes,
                                                             cinetpay, code, statut):
    paiement = fabrique.paiement(bailleur)
    cinetpay.statut(statut, code=code, montant=250_000, devise="GNF")

    _callback(client, paiement)
    corps = _verifier(client, entetes, bailleur, paiement).get_json()

    assert corps["paiement"]["statut"] == "pending"
    assert corps["message"] == "Paiement toujours en attente"


def test_callback_sans_passerelle_configuree_laisse_en_attente(client, fabrique, bailleur):
    paiement = fabrique.paiement(bailleur)

    _callback(client, paiement)
    assert Payment.query.get(paiement.id).statut == "pending"


def test_refus_explicite_passe_en_echec(client, fabrique, bailleur, entetes, cinetpay):
    paiement = fabrique.paiement(bailleur)
    cinetpay.statut("REFUSED", code="600", montant=250_000, devise="GNF")

    corps = _verifier(client, entetes, bailleur, paiement).get_json()

    assert corps["paiement"]["statut"] == "failed"
    assert corps["message"] == "Paiement refusé"
    assert _notifications_paiement(bailleur) == 0


def test_verifier_apres_panne_confirme_le_paiement(client, fabrique, bailleur, entetes, cinetpay):
    paiement = fabrique.paiement(bailleur)
    cinetpay.panne()
    _callback(client, paiement)

    cinetpay.statut("ACCEPTED", montant=250_000, devise="GNF")
    corps = _verifier(client, entetes, bailleur, paiement).get_json()

    assert corps["paiement"]["statut"] == "success"
    assert corps["message"] == "Paiement confirmé"


# Montant et devise renvoyés par CinetPay.

@pytest.mark.parametrize("montant, devise", [
    (1_000, "GNF"),          # montant modifié en cours de route
    (250_000, "XOF"),        # bonne somme, mauvaise devise
    (None, "GNF"),           # montant absent : rien à contrôler, pas de succès
    (250_000, None),
    ("NaN", "GNF"),
    ("deux cent mille", "GNF"),
])
def test_acceptation_avec_ecart_ne_vaut_pas_succes(client, fabrique, annonce, bailleur, entetes,
                                                    cinetpay, caplog, montant, devise):
    paiement = fabrique.paiement(bailleur, listing_id=annonce.id)
    cinetpay.statut("ACCEPTED", montant=montant, devise=devise)

    _callback(client, paiement)
    corps = _verifier(client, entetes, bailleur, paiement).get_json()

    assert corps["paiement"]["statut"] == "pending"
    assert Listing.query.get(annonce.id).certification_status != "pending"
    assert _notifications_paiement(bailleur) == 0
    assert any(r.levelname == "ERROR" and "écart" in r.getMessage() for r in caplog.records)


@pytest.mark.parametrize("montant, devise", [("250000", "GNF"), ("250000.00", "gnf"), (250_000, "GNF")])
def test_acceptation_conforme_tolere_les_formats(client, fabrique, bailleur, cinetpay, montant,
                                                 devise):
    paiement = fabrique.paiement(bailleur)
    cinetpay.reseau.repondre("POST", cinetpay.url_check, json={
        "code": "00", "data": {"status": "ACCEPTED", "amount": montant, "currency": devise}})

    _callback(client, paiement)
    assert Payment.query.get(paiement.id).statut == "success"


# Application idempotente sous verrou.

def test_relecture_sous_verrou_for_update():
    requete = payments._requete_verrouillee("id-quelconque")
    assert "FOR UPDATE" in str(requete.compile(dialect=postgresql.dialect()))
    assert requete.get_execution_options()["populate_existing"] is True


def test_application_relit_le_statut_en_base(app, fabrique, annonce, bailleur):
    """Un objet périmé dans la session (« pending ») ne doit pas faire oublier
    que l'autre appel a déjà validé le paiement en base."""
    paiement = fabrique.paiement(bailleur, type_paiement="mise_en_avant", montant=200_000,
                                 listing_id=annonce.id)
    assert paiement.statut == "pending"
    # Écriture concurrente, invisible de l'identity map de cette session.
    db.session.connection().exec_driver_sql(
        "UPDATE payments SET statut = 'success' WHERE id = ?", (paiement.id,))

    payments._appliquer_verification(paiement.id, payments.ACCEPTE,
                                      {"amount": "200000", "currency": "GNF"})

    assert Listing.query.get(annonce.id).premium_until is None
    assert _notifications_paiement(bailleur) == 0


def test_callback_et_verifier_concurrents_n_appliquent_qu_une_fois(
        client, fabrique, annonce, bailleur, entetes, cinetpay, monkeypatch):
    """Le « vérifier » du client arrive pendant que le callback attend la
    réponse de CinetPay : la mise en avant n'est prolongée qu'une fois."""
    paiement = fabrique.paiement(bailleur, type_paiement="mise_en_avant", montant=200_000,
                                 listing_id=annonce.id)
    cinetpay.statut("ACCEPTED", montant=200_000, devise="GNF")
    verification_reelle = payments._verifier_aupres_de_cinetpay
    reponses_verifier = []

    def verification_pendant_laquelle_le_client_verifie(transaction_id):
        resultat = verification_reelle(transaction_id)
        # Seul le premier appel (celui du callback) déclenche le « vérifier » :
        # celui-ci repasse par cette fonction, qui doit alors répondre simplement.
        if not reponses_verifier:
            reponses_verifier.append(None)
            reponses_verifier[0] = _verifier(client, entetes, bailleur, paiement)
        return resultat

    monkeypatch.setattr(payments, "_verifier_aupres_de_cinetpay",
                        verification_pendant_laquelle_le_client_verifie)
    avant = datetime.utcnow()
    _callback(client, paiement)

    assert reponses_verifier[0].get_json()["paiement"]["statut"] == "success"
    assert len(cinetpay.verifications) == 2       # les deux appels ont bien interrogé CinetPay
    premium_until = Listing.query.get(annonce.id).premium_until
    assert premium_until < avant + payments.DUREE_MISE_EN_AVANT + timedelta(minutes=1)
    assert _notifications_paiement(bailleur) == 1


def test_double_callback_n_applique_qu_une_fois(client, fabrique, annonce, bailleur, cinetpay):
    paiement = fabrique.paiement(bailleur, type_paiement="mise_en_avant", montant=200_000,
                                 listing_id=annonce.id)
    cinetpay.statut("ACCEPTED", montant=200_000, devise="GNF")

    _callback(client, paiement)
    _callback(client, paiement)

    assert len(cinetpay.verifications) == 1
    assert _notifications_paiement(bailleur) == 1


def test_paiement_echoue_n_est_pas_rouvert(client, fabrique, bailleur, entetes, cinetpay):
    paiement = fabrique.paiement(bailleur, statut="failed")

    _callback(client, paiement)
    _verifier(client, entetes, bailleur, paiement)

    assert cinetpay.verifications == []
    assert Payment.query.get(paiement.id).statut == "failed"


# Payeur imposé par le type.

def test_locataire_ne_peut_pas_payer_la_commission(client, match, locataire, entetes, cinetpay):
    reponse = client.post("/api/payments/initier", headers=entetes(locataire),
                          json={"type_paiement": "commission", "match_id": match.id})

    assert reponse.status_code == 403
    assert Payment.query.count() == 0


def test_bailleur_paie_la_commission(client, match, bailleur, entetes, cinetpay):
    reponse = client.post("/api/payments/initier", headers=entetes(bailleur),
                          json={"type_paiement": "commission", "match_id": match.id})

    assert reponse.status_code == 200
    assert reponse.get_json()["paiement"]["type_paiement"] == "commission"


def test_bailleur_ne_peut_pas_prendre_l_abonnement_passeport(client, bailleur, entetes, cinetpay):
    reponse = client.post("/api/payments/initier", headers=entetes(bailleur),
                          json={"type_paiement": "abonnement_passeport"})

    assert reponse.status_code == 400
    assert Payment.query.count() == 0


# Tarifs fixes : GNF uniquement.

@pytest.mark.parametrize("type_paiement", ["certification", "mise_en_avant"])
def test_tarif_refuse_hors_gnf(client, fabrique, bailleur, entetes, cinetpay, type_paiement):
    annonce_xof = fabrique.annonce(bailleur, devise="XOF")

    reponse = client.post("/api/payments/initier", headers=entetes(bailleur),
                          json={"type_paiement": type_paiement, "listing_id": annonce_xof.id})

    assert reponse.status_code == 400
    assert Payment.query.count() == 0
    assert cinetpay.reseau.appels_vers(cinetpay.url_init) == []


def test_callback_plafonne_par_ip(client, cinetpay):
    # Chaque callback déclenche un appel sortant : un rejeu massif est coupé.
    plafond = int(payments.LIMITE_CALLBACK.split()[0])
    for _ in range(plafond):
        client.post("/api/payments/callback", json={"cpm_trans_id": "INCONNUE"})

    reponse = client.post("/api/payments/callback", json={"cpm_trans_id": "INCONNUE"})

    assert reponse.status_code == 429
