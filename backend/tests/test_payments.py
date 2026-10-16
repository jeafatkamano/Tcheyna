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


# ─── Lot 1.3b · Fonds à ne pas garder, doublons ──────────────

def _notifications(user, type_notif):
    return Notification.query.filter_by(user_id=user.id, type=type_notif).count()


@pytest.mark.parametrize("type_paiement", ["caution", "premier_loyer"])
def test_ancienne_caution_acceptee_passe_a_rembourser(client, fabrique, match, locataire, admin,
                                                      cinetpay, type_paiement):
    # D2 = A : une caution initiée avant la décision et encaissée après n'est
    # jamais confirmée, même si CinetPay l'accepte au montant exact.
    ancienne = fabrique.paiement(locataire, type_paiement=type_paiement, match_id=match.id,
                                 listing_id=match.listing_id, montant=4_000_000)
    cinetpay.statut("ACCEPTED", montant=4_000_000, devise="GNF")

    assert _callback(client, ancienne).status_code == 200

    paiement = Payment.query.get(ancienne.id)
    assert paiement.statut == payments.A_REMBOURSER
    assert paiement.paid_at is None
    assert _notifications_paiement(locataire) == 0
    assert _notifications(locataire, "paiement_a_rembourser") == 1
    assert _notifications(admin, "paiement_a_rembourser") == 1
    assert _callback(client, ancienne).get_json()["message"] == "Déjà traité"


def test_paiements_a_rembourser_comptes_pour_l_admin(client, fabrique, locataire, admin, entetes):
    fabrique.paiement(locataire, type_paiement="caution", montant=4_000_000,
                      statut=payments.A_REMBOURSER)

    stats = client.get("/api/admin/stats", headers=entetes(admin)).get_json()

    assert stats["file_de_verification"]["paiements_a_rembourser"] == 1
    # Ni revenu Tcheyna ni fonds de tiers encaissés.
    assert stats["revenus"]["total_encaisse"] == 0
    assert stats["revenus"]["fonds_de_tiers_historiques"] == 0


def test_ancienne_caution_via_verifier_passe_a_rembourser(client, fabrique, match, locataire,
                                                          entetes, cinetpay):
    ancienne = fabrique.paiement(locataire, type_paiement="caution", match_id=match.id,
                                 listing_id=match.listing_id, montant=4_000_000)
    cinetpay.statut("ACCEPTED", montant=4_000_000, devise="GNF")

    corps = _verifier(client, entetes, locataire, ancienne).get_json()

    assert corps["paiement"]["statut"] == payments.A_REMBOURSER


def test_ancienne_caution_refusee_passe_en_echec(client, fabrique, match, locataire, cinetpay):
    ancienne = fabrique.paiement(locataire, type_paiement="caution", match_id=match.id,
                                 listing_id=match.listing_id, montant=4_000_000)
    cinetpay.statut("REFUSED")

    _callback(client, ancienne)

    assert Payment.query.get(ancienne.id).statut == "failed"


def test_paiement_en_attente_recent_bloque_un_second(client, annonce, bailleur, entetes,
                                                     cinetpay):
    corps = {"type_paiement": "certification", "listing_id": annonce.id}
    assert client.post("/api/payments/initier", headers=entetes(bailleur),
                       json=corps).status_code == 200
    cinetpay.statut("PENDING")  # le client n'a pas encore validé sur son téléphone

    reponse = client.post("/api/payments/initier", headers=entetes(bailleur), json=corps)

    assert reponse.status_code == 409
    assert reponse.get_json()["paiement"]["statut"] == "pending"
    assert Payment.query.count() == 1
    assert len(cinetpay.verifications) == 1


def test_paiement_en_attente_ancien_n_empeche_plus_de_repayer(client, fabrique, annonce,
                                                              bailleur, entetes, cinetpay):
    ancien = fabrique.paiement(bailleur, listing_id=annonce.id,
                               created_at=datetime.utcnow() - timedelta(hours=2))
    cinetpay.statut("PENDING")

    reponse = client.post("/api/payments/initier", headers=entetes(bailleur),
                          json={"type_paiement": "certification", "listing_id": annonce.id})

    assert reponse.status_code == 200
    assert Payment.query.count() == 2
    assert Payment.query.get(ancien.id).statut == "pending"


def test_callback_perdu_le_paiement_existant_est_confirme_pas_repaye(client, fabrique, match,
                                                                     bailleur, entetes, cinetpay):
    # Le client a payé, le callback ne nous est jamais parvenu : la seconde
    # tentative découvre le succès au lieu de débiter une seconde fois.
    commission = int(match.listing.prix * payments.COMMISSION_RATE)
    premier = fabrique.paiement(bailleur, type_paiement="commission", match_id=match.id,
                                listing_id=match.listing_id, montant=commission)
    cinetpay.statut("ACCEPTED", montant=commission, devise="GNF")

    reponse = client.post("/api/payments/initier", headers=entetes(bailleur),
                          json={"type_paiement": "commission", "match_id": match.id})

    assert reponse.status_code == 409
    assert Payment.query.get(premier.id).statut == "success"
    assert Payment.query.count() == 1
    # `url_init` est un préfixe de `url_check` : comparer l'URL exacte.
    assert [a for a in cinetpay.reseau.appels if a["url"] == cinetpay.url_init] == []


def test_certification_deja_payee_ne_se_repaye_pas(client, fabrique, bailleur, entetes, cinetpay):
    # Un refus de certification n'oblige pas à repayer : la nouvelle demande
    # s'appuie sur le paiement déjà réussi (listings.demander_certification).
    annonce = fabrique.annonce(bailleur, certification_status="rejected")
    fabrique.paiement(bailleur, listing_id=annonce.id, statut="success",
                      paid_at=datetime.utcnow())

    reponse = client.post("/api/payments/initier", headers=entetes(bailleur),
                          json={"type_paiement": "certification", "listing_id": annonce.id})

    assert reponse.status_code == 409
    assert Payment.query.count() == 1


def test_ancien_paiement_accepte_apres_un_second_passe_a_rembourser(client, fabrique, match,
                                                                    bailleur, admin, cinetpay):
    commission = int(match.listing.prix * payments.COMMISSION_RATE)
    fabrique.paiement(bailleur, type_paiement="commission", match_id=match.id,
                      listing_id=match.listing_id, montant=commission, statut="success",
                      paid_at=datetime.utcnow())
    tardif = fabrique.paiement(bailleur, type_paiement="commission", match_id=match.id,
                               listing_id=match.listing_id, montant=commission)
    cinetpay.statut("ACCEPTED", montant=commission, devise="GNF")

    _callback(client, tardif)

    assert Payment.query.get(tardif.id).statut == payments.A_REMBOURSER
    assert _notifications(admin, "paiement_a_rembourser") == 1


def test_abonnement_paye_deux_fois_passe_a_rembourser(client, fabrique, locataire, cinetpay):
    fabrique.paiement(locataire, type_paiement="abonnement_passeport", montant=150_000,
                      statut="success", paid_at=datetime.utcnow())
    second = fabrique.paiement(locataire, type_paiement="abonnement_passeport", montant=150_000)
    cinetpay.statut("ACCEPTED", montant=150_000, devise="GNF")

    _callback(client, second)

    assert Payment.query.get(second.id).statut == payments.A_REMBOURSER


def test_deux_mises_en_avant_se_cumulent(client, fabrique, annonce, bailleur, cinetpay):
    # Chaque mise en avant achetée prolonge l'annonce : ce n'est pas un doublon.
    fabrique.paiement(bailleur, type_paiement="mise_en_avant", listing_id=annonce.id,
                      montant=200_000, statut="success", paid_at=datetime.utcnow())
    seconde = fabrique.paiement(bailleur, type_paiement="mise_en_avant", listing_id=annonce.id,
                                montant=200_000)
    cinetpay.statut("ACCEPTED", montant=200_000, devise="GNF")

    _callback(client, seconde)

    assert Payment.query.get(seconde.id).statut == "success"


@pytest.mark.parametrize("statut", ["pending", "rejected", "cancelled"])
def test_commission_refusee_hors_match_conclu(client, fabrique, locataire, annonce, bailleur,
                                              entetes, cinetpay, statut):
    candidature = fabrique.match(locataire, annonce, status=statut)

    reponse = client.post("/api/payments/initier", headers=entetes(bailleur),
                          json={"type_paiement": "commission", "match_id": candidature.id})

    assert reponse.status_code == 400
    assert Payment.query.count() == 0


def test_initiation_plafonnee_par_compte(client, fabrique, bailleur, entetes, cinetpay):
    plafond = int(payments.LIMITE_INITIATION.split()[0])
    for _ in range(plafond):
        client.post("/api/payments/initier", headers=entetes(bailleur), json={})

    assert client.post("/api/payments/initier", headers=entetes(bailleur),
                       json={}).status_code == 429
    # Même IP (CGNAT des opérateurs mobiles), autre compte : pas bloqué.
    autre = fabrique.bailleur()
    assert client.post("/api/payments/initier", headers=entetes(autre),
                       json={}).status_code == 422


def test_ancienne_mise_en_avant_confirmee_pendant_l_initiation(client, fabrique, annonce,
                                                               bailleur, entetes, cinetpay):
    # Ancienne de plus de 30 min, acceptée entre-temps : on ne débite pas une
    # seconde fois sans que le client l'ait vu.
    ancienne = fabrique.paiement(bailleur, type_paiement="mise_en_avant", listing_id=annonce.id,
                                 montant=200_000,
                                 created_at=datetime.utcnow() - timedelta(hours=2))
    cinetpay.statut("ACCEPTED", montant=200_000, devise="GNF")

    reponse = client.post("/api/payments/initier", headers=entetes(bailleur),
                          json={"type_paiement": "mise_en_avant", "listing_id": annonce.id})

    assert reponse.status_code == 409
    assert reponse.get_json()["paiement"]["id"] == ancienne.id
    assert Payment.query.get(ancienne.id).statut == "success"
    assert Payment.query.count() == 1


def test_reprise_bornee_en_nombre_et_en_age(client, fabrique, annonce, bailleur, entetes,
                                            cinetpay):
    vieux = datetime.utcnow() - timedelta(hours=2)
    for _ in range(payments.REPRISE_MAX_VERIFICATIONS + 2):
        fabrique.paiement(bailleur, listing_id=annonce.id, created_at=vieux)
    fabrique.paiement(bailleur, listing_id=annonce.id,
                      created_at=datetime.utcnow() - timedelta(days=3))
    cinetpay.statut("PENDING")

    reponse = client.post("/api/payments/initier", headers=entetes(bailleur),
                          json={"type_paiement": "certification", "listing_id": annonce.id})

    assert reponse.status_code == 200
    assert len(cinetpay.verifications) == payments.REPRISE_MAX_VERIFICATIONS


def test_commission_hors_match_conclu_sans_appel_sortant(client, fabrique, locataire, annonce,
                                                         bailleur, entetes, cinetpay):
    candidature = fabrique.match(locataire, annonce, status="rejected")
    fabrique.paiement(bailleur, type_paiement="commission", match_id=candidature.id,
                      listing_id=annonce.id)

    client.post("/api/payments/initier", headers=entetes(bailleur),
                json={"type_paiement": "commission", "match_id": candidature.id})

    assert cinetpay.verifications == []


def test_verifier_annonce_le_remboursement(client, fabrique, match, locataire, entetes,
                                           cinetpay):
    ancienne = fabrique.paiement(locataire, type_paiement="caution", match_id=match.id,
                                 listing_id=match.listing_id, montant=4_000_000)
    cinetpay.statut("ACCEPTED", montant=4_000_000, devise="GNF")

    corps = _verifier(client, entetes, locataire, ancienne).get_json()

    assert "rembours" in corps["message"]



# ─── Remboursement manuel par l'administration ───────────────

def test_admin_liste_et_clot_un_remboursement(client, fabrique, locataire, admin, entetes):
    paiement = fabrique.paiement(locataire, type_paiement="caution", montant=4_000_000,
                                 statut=payments.A_REMBOURSER)

    (ligne,) = client.get("/api/admin/paiements-a-rembourser", headers=entetes(admin)).get_json()
    assert (ligne["id"], ligne["motif"]) == (paiement.id, "hors_plateforme")
    assert ligne["payeur"]["id"] == locataire.id

    reponse = client.put(f"/api/admin/paiements/{paiement.id}/rembourse", headers=entetes(admin),
                         json={"reference_remboursement": "CP-REMB-001"})

    assert reponse.status_code == 200
    assert Payment.query.get(paiement.id).statut == "rembourse"
    assert _notifications(locataire, "paiement_rembourse") == 1
    assert client.get("/api/admin/paiements-a-rembourser", headers=entetes(admin)).get_json() == []


@pytest.mark.parametrize("statut", ["pending", "success", "failed", "rembourse"])
def test_seul_un_paiement_a_rembourser_se_clot(client, fabrique, locataire, admin, entetes,
                                               statut):
    paiement = fabrique.paiement(locataire, statut=statut)

    reponse = client.put(f"/api/admin/paiements/{paiement.id}/rembourse", headers=entetes(admin),
                         json={})

    assert reponse.status_code == 409
    assert Payment.query.get(paiement.id).statut == statut


def test_remboursement_reserve_a_l_admin(client, fabrique, locataire, entetes):
    paiement = fabrique.paiement(locataire, statut=payments.A_REMBOURSER)

    assert client.get("/api/admin/paiements-a-rembourser",
                      headers=entetes(locataire)).status_code == 403
    assert client.put(f"/api/admin/paiements/{paiement.id}/rembourse",
                      headers=entetes(locataire), json={}).status_code == 403
    assert Payment.query.get(paiement.id).statut == payments.A_REMBOURSER
