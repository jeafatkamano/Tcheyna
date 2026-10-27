"""Lot 2.2 — Cycle de vie de l'annonce et re-soumission de certification (D4).

Retirer masque une annonce sans la supprimer ; réactiver la remet en ligne,
pour son seul propriétaire, au téléphone vérifié (D3), et jamais une fois le
bien loué ou vendu.

D4 (20/10/2026) : la re-soumission d'une certification refusée est gratuite
une fois, payante ensuite au tarif de la certification. Les refus se lisent
dans le journal `verifications`, les paiements dans `payments`.
"""
from datetime import datetime, timedelta

import pytest

from app import db
from app.models import Listing, Match, Payment, Verification
from app.routes import payments
from app.routes.listings import certification_a_payer, etats_certification
from app.services.acces import MESSAGE_TELEPHONE_NON_VERIFIE

DOCUMENT = "supabase://documents/titre.pdf"


def _retirer(client, entetes, user, annonce):
    return client.put(f"/api/listings/{annonce.id}/retirer", headers=entetes(user))


def _reactiver(client, entetes, user, annonce):
    return client.put(f"/api/listings/{annonce.id}/reactiver", headers=entetes(user))


def _ids_recherche(client):
    return [a["id"] for a in client.get("/api/listings/").get_json()["listings"]]


# ─── Retirer ─────────────────────────────────────────────────

def test_retrait_par_le_proprietaire(client, annonce, bailleur, entetes):
    reponse = _retirer(client, entetes, bailleur, annonce)

    assert reponse.status_code == 200
    corps = reponse.get_json()
    assert corps["message"] == "Annonce retirée"
    assert (corps["listing"]["status"], corps["listing"]["retiree"]) == ("closed", True)
    # Retrait logique : rien n'est supprimé.
    assert Listing.query.get(annonce.id) is not None
    assert (annonce.status, annonce.is_visible) == ("closed", False)


def test_retrait_idempotent(client, annonce, bailleur, entetes):
    _retirer(client, entetes, bailleur, annonce)

    reponse = _retirer(client, entetes, bailleur, annonce)

    assert reponse.status_code == 200
    assert reponse.get_json()["message"] == "Annonce déjà retirée"
    assert (annonce.status, annonce.is_visible) == ("closed", False)


def test_annonce_retiree_absente_du_public_visible_du_proprietaire(client, fabrique, annonce,
                                                                   bailleur, entetes):
    autre = fabrique.annonce(bailleur)
    _retirer(client, entetes, bailleur, annonce)

    assert _ids_recherche(client) == [autre.id]
    # Détail : introuvable pour un visiteur, un locataire sans candidature,
    # un autre bailleur ; lisible par son propriétaire.
    assert client.get(f"/api/listings/{annonce.id}").status_code == 404
    for tiers in (fabrique.locataire(), fabrique.bailleur()):
        assert client.get(f"/api/listings/{annonce.id}",
                          headers=entetes(tiers)).status_code == 404
    detail = client.get(f"/api/listings/{annonce.id}", headers=entetes(bailleur))
    assert detail.status_code == 200
    assert (detail.get_json()["is_owner"], detail.get_json()["retiree"]) == (True, True)


def test_mes_annonces_retirees_sur_demande(client, fabrique, annonce, bailleur, entetes):
    en_ligne = fabrique.annonce(bailleur)
    _retirer(client, entetes, bailleur, annonce)

    # Par défaut, comme avant le lot : les annonces en ligne seules.
    defaut = client.get("/api/listings/mes-annonces", headers=entetes(bailleur)).get_json()
    assert [a["id"] for a in defaut["listings"]] == [en_ligne.id]

    tout = client.get("/api/listings/mes-annonces?inclure_retirees=1",
                      headers=entetes(bailleur)).get_json()
    assert {a["id"]: a["retiree"] for a in tout["listings"]} == {annonce.id: True,
                                                                 en_ligne.id: False}
    # Les statistiques portent sur les annonces en ligne.
    assert tout["stats"]["actives"] == defaut["stats"]["actives"] == 1


def test_delete_reste_un_retrait_reversible(client, annonce, bailleur, entetes):
    reponse = client.delete(f"/api/listings/{annonce.id}", headers=entetes(bailleur))

    assert reponse.status_code == 200
    assert reponse.get_json() == {"message": "Annonce retirée"}
    assert (annonce.status, annonce.is_visible) == ("closed", False)

    assert _reactiver(client, entetes, bailleur, annonce).status_code == 200
    assert (annonce.status, annonce.is_visible) == ("active", True)


def test_retrait_laisse_les_candidatures_en_l_etat(client, fabrique, annonce, bailleur,
                                                   entetes):
    # Comportement de DELETE depuis toujours, gardé faute de décision.
    en_attente = fabrique.match(annonce=annonce, status="pending")
    acceptee = fabrique.match(annonce=annonce, status="accepted")

    _retirer(client, entetes, bailleur, annonce)

    assert (Match.query.get(en_attente.id).status,
            Match.query.get(acceptee.id).status) == ("pending", "accepted")


def test_candidature_refusee_sur_une_annonce_retiree(client, annonce, bailleur, locataire,
                                                     entetes):
    _retirer(client, entetes, bailleur, annonce)

    reponse = client.post("/api/matches/", headers=entetes(locataire),
                          json={"listing_id": annonce.id})

    assert reponse.status_code == 400
    assert Match.query.count() == 0


# ─── Réactiver ───────────────────────────────────────────────

def test_reactivation_par_le_proprietaire(client, annonce, bailleur, entetes):
    _retirer(client, entetes, bailleur, annonce)

    reponse = _reactiver(client, entetes, bailleur, annonce)

    assert reponse.status_code == 200
    corps = reponse.get_json()
    assert corps["message"] == "Annonce remise en ligne"
    assert (corps["listing"]["status"], corps["listing"]["retiree"]) == ("active", False)
    assert _ids_recherche(client) == [annonce.id]
    assert client.get(f"/api/listings/{annonce.id}").status_code == 200


def test_reactivation_idempotente(client, annonce, bailleur, entetes):
    reponse = _reactiver(client, entetes, bailleur, annonce)

    assert reponse.status_code == 200
    assert reponse.get_json()["message"] == "Annonce déjà en ligne"
    assert (annonce.status, annonce.is_visible) == ("active", True)


@pytest.mark.parametrize("action", [_retirer, _reactiver])
def test_actions_refusees_a_un_autre_bailleur_et_a_un_locataire(client, fabrique, bailleur,
                                                                 entetes, action):
    annonce = fabrique.annonce(bailleur, status="closed", is_visible=False)
    intrus = fabrique.bailleur(phone="+224621000555", phone_verified=True, trust_level=1)

    for user in (intrus, fabrique.agence(phone="+224621000556", phone_verified=True),
                 fabrique.locataire()):
        assert action(client, entetes, user, annonce).status_code == 403

    assert (annonce.status, annonce.is_visible) == ("closed", False)


@pytest.mark.parametrize("action", [_retirer, _reactiver])
def test_actions_sur_une_annonce_inexistante(client, bailleur, entetes, action):
    class Absente:
        id = "inexistante"

    assert action(client, entetes, bailleur, Absente).status_code == 404


def test_reactivation_refusee_sans_telephone_verifie(client, fabrique, entetes):
    # Un bailleur d'avant D3, au téléphone non vérifié : il peut retirer son
    # annonce, pas la remettre en ligne.
    bailleur = fabrique.bailleur(phone_verified=False)
    annonce = fabrique.annonce(bailleur)
    assert _retirer(client, entetes, bailleur, annonce).status_code == 200

    reponse = _reactiver(client, entetes, bailleur, annonce)

    assert reponse.status_code == 403
    assert reponse.get_json()["error"] == MESSAGE_TELEPHONE_NON_VERIFIE
    assert reponse.get_json()["details"][0]["code"] == "telephone_non_verifie"
    assert (annonce.status, annonce.is_visible) == ("closed", False)


def test_reactivation_refusee_pour_un_bien_loue(client, fabrique, bailleur, entetes):
    annonce = fabrique.annonce(bailleur, status="matched")

    reponse = _reactiver(client, entetes, bailleur, annonce)

    assert reponse.status_code == 409
    assert reponse.get_json()["details"][0]["code"] == "annonce_conclue"
    assert annonce.status == "matched"


def test_reactivation_refusee_pour_un_bien_loue_puis_retire(client, fabrique, bailleur,
                                                           entetes):
    # DELETE passe une annonce louée en « closed » : la candidature conclue
    # empêche de la remettre sur le marché par ce détour.
    annonce = fabrique.annonce(bailleur, status="matched")
    fabrique.match(annonce=annonce, status="completed")
    client.delete(f"/api/listings/{annonce.id}", headers=entetes(bailleur))
    assert annonce.status == "closed"

    reponse = _reactiver(client, entetes, bailleur, annonce)

    assert reponse.status_code == 409
    assert (annonce.status, annonce.is_visible) == ("closed", False)


def test_compte_desactive_ne_reactive_rien(client, annonce, bailleur, entetes):
    _retirer(client, entetes, bailleur, annonce)
    bailleur.is_active = False
    db.session.commit()

    reponse = _reactiver(client, entetes, bailleur, annonce)

    assert reponse.status_code == 403
    assert (annonce.status, annonce.is_visible) == ("closed", False)


def test_compte_reactive_retrouve_ses_annonces(client, fabrique, admin, bailleur, entetes):
    # Désactivation par le titulaire : ses annonces sont retirées. Réactivé
    # par l'admin, il peut les remettre en ligne.
    annonce = fabrique.annonce(bailleur)
    assert client.delete("/api/users/me", headers=entetes(bailleur)).status_code == 200
    assert (annonce.status, annonce.is_visible) == ("closed", False)
    client.put(f"/api/admin/users/{bailleur.id}/statut", headers=entetes(admin),
               json={"is_active": True})

    assert _reactiver(client, entetes, bailleur, annonce).status_code == 200
    assert (annonce.status, annonce.is_visible) == ("active", True)


# ─── Re-soumission de certification (D4) ─────────────────────

def _demander(client, entetes, bailleur, annonce):
    return client.post(f"/api/listings/{annonce.id}/certification", headers=entetes(bailleur))


def _initier(client, entetes, bailleur, annonce):
    return client.post("/api/payments/initier", headers=entetes(bailleur),
                       json={"type_paiement": "certification", "listing_id": annonce.id})


def _payer(client, entetes, bailleur, annonce):
    """Paiement de certification complet, CinetPay simulé (ACCEPTED)."""
    reponse = _initier(client, entetes, bailleur, annonce)
    assert reponse.status_code == 200, reponse.get_json()
    paiement = Payment.query.get(reponse.get_json()["paiement"]["id"])
    client.post("/api/payments/callback", json={"cpm_trans_id": paiement.cinetpay_transaction_id})
    return Payment.query.get(paiement.id)


def _trancher(client, entetes, admin, annonce, approuve):
    reponse = client.put(f"/api/admin/certifier/{annonce.id}", headers=entetes(admin),
                         json={"approuve": approuve,
                               "motif": None if approuve else "Titre foncier illisible"})
    assert reponse.status_code == 200
    return Listing.query.get(annonce.id)


def _etat(client, entetes, bailleur, annonce):
    detail = client.get(f"/api/listings/{annonce.id}", headers=entetes(bailleur)).get_json()
    return detail["certification_resoumission"]


@pytest.fixture
def a_certifier(fabrique, bailleur):
    return fabrique.annonce(bailleur, documents_urls=DOCUMENT)


def test_parcours_d4(client, a_certifier, bailleur, admin, entetes, cinetpay):
    annonce = a_certifier

    # 1. Première demande : payante.
    reponse = _demander(client, entetes, bailleur, annonce)
    assert reponse.status_code == 402
    assert reponse.get_json()["paiement_requis"] == "certification"
    paiement = _payer(client, entetes, bailleur, annonce)
    assert paiement.statut == "success"
    assert annonce.certification_status == "pending"  # le paiement ouvre l'examen

    # 2. Premier refus : la re-soumission est gratuite.
    _trancher(client, entetes, admin, annonce, approuve=False)
    assert _etat(client, entetes, bailleur, annonce) == {
        "nb_refus": 1, "nb_paiements": 1, "paiement_requis": False,
        "resoumission_gratuite": True}
    assert _demander(client, entetes, bailleur, annonce).status_code == 200
    assert annonce.certification_status == "pending"
    # Pendant l'examen gratuit, rien à payer : un paiement serait un doublon.
    assert _initier(client, entetes, bailleur, annonce).status_code == 409

    # 3. Deuxième refus : un nouveau paiement est exigé.
    _trancher(client, entetes, admin, annonce, approuve=False)
    reponse = _demander(client, entetes, bailleur, annonce)
    assert reponse.status_code == 402
    corps = reponse.get_json()
    assert corps["paiement_requis"] == "certification"
    assert "re-soumission gratuite" in corps["error"]
    assert corps["certification_resoumission"] == {
        "nb_refus": 2, "nb_paiements": 1, "paiement_requis": True,
        "resoumission_gratuite": False}
    assert annonce.certification_status == "rejected"

    # 4. Le nouveau paiement est admis et rouvre l'examen.
    second = _payer(client, entetes, bailleur, annonce)
    assert second.statut == "success"
    assert second.montant == payments.TARIFS_GNF["certification"]
    assert annonce.certification_status == "pending"
    assert _trancher(client, entetes, admin, annonce, approuve=True).is_certified

    # 5. Un troisième refus (après le second paiement) exige encore un paiement :
    #    la gratuité ne vaut qu'une fois.
    annonce.certification_status = "rejected"
    db.session.add(Verification(cible_id=annonce.id, objet="certification_annonce",
                                decision="refusee", motif="Nouveau refus"))
    db.session.commit()
    assert _demander(client, entetes, bailleur, annonce).status_code == 402


def test_compteur_resiste_aux_detours(client, a_certifier, bailleur, admin, entetes, cinetpay):
    annonce = a_certifier
    _payer(client, entetes, bailleur, annonce)
    _trancher(client, entetes, admin, annonce, approuve=False)
    assert _demander(client, entetes, bailleur, annonce).status_code == 200
    _trancher(client, entetes, admin, annonce, approuve=False)

    # Compléter les pièces (remet le statut à « none »), retirer puis remettre
    # en ligne, passer par DELETE : aucun détour n'efface un refus.
    annonce.certification_status = "none"  # effet de POST /<id>/documents après un refus
    db.session.commit()
    _retirer(client, entetes, bailleur, annonce)
    _reactiver(client, entetes, bailleur, annonce)
    client.delete(f"/api/listings/{annonce.id}", headers=entetes(bailleur))
    _reactiver(client, entetes, bailleur, annonce)

    assert _demander(client, entetes, bailleur, annonce).status_code == 402
    assert annonce.certification_status == "none"


def test_un_seul_nouveau_paiement_couvre_la_demande(client, fabrique, a_certifier, bailleur,
                                                    admin, entetes, cinetpay):
    # Deux paiements lancés pendant que la demande est payante (le second
    # après la fenêtre de reprise) : le premier confirmé ouvre l'examen, le
    # second est un doublon, remboursé.
    annonce = a_certifier
    _payer(client, entetes, bailleur, annonce)
    _trancher(client, entetes, admin, annonce, approuve=False)
    _demander(client, entetes, bailleur, annonce)
    _trancher(client, entetes, admin, annonce, approuve=False)
    premier = fabrique.paiement(bailleur, listing_id=annonce.id)
    second = fabrique.paiement(bailleur, listing_id=annonce.id)

    for paiement in (premier, second):
        client.post("/api/payments/callback",
                    json={"cpm_trans_id": paiement.cinetpay_transaction_id})

    assert Payment.query.get(premier.id).statut == "success"
    assert Payment.query.get(second.id).statut == payments.A_REMBOURSER
    assert annonce.certification_status == "pending"


def test_paiement_admis_seulement_quand_la_demande_l_exige(client, fabrique, a_certifier,
                                                         bailleur, entetes, cinetpay):
    annonce = a_certifier
    # Aucun paiement : le premier est admis.
    assert certification_a_payer(annonce)
    _payer(client, entetes, bailleur, annonce)
    # Payée, pas encore refusée : un second paiement ferait double emploi.
    annonce.certification_status = "none"
    db.session.commit()
    assert not certification_a_payer(annonce)
    assert _initier(client, entetes, bailleur, annonce).status_code == 409
    assert Payment.query.count() == 1


def test_refus_sans_examen_paye_ne_consomme_rien(app, fabrique, bailleur):
    # Refus prononcés avant l'activation de la passerelle (demande gratuite)
    # ou avant le journal : le premier paiement couvre toujours deux examens.
    annonce = fabrique.annonce(bailleur, documents_urls=DOCUMENT, certification_status="rejected")
    debut = datetime.utcnow() - timedelta(days=10)
    for jours in (0, 1):
        db.session.add(Verification(cible_id=annonce.id, objet="certification_annonce",
                                    decision="refusee", created_at=debut + timedelta(days=jours)))
    fabrique.paiement(bailleur, listing_id=annonce.id, statut="success",
                      paid_at=debut + timedelta(days=2))
    db.session.add(Verification(cible_id=annonce.id, objet="certification_annonce",
                                decision="refusee", created_at=debut + timedelta(days=3)))
    db.session.commit()

    assert etats_certification([annonce])[annonce.id] == {
        "nb_refus": 3, "nb_paiements": 1, "paiement_requis": False,
        "resoumission_gratuite": True}


def test_seuls_les_refus_de_cette_annonce_comptent(app, fabrique, bailleur):
    annonce, autre = (fabrique.annonce(bailleur, documents_urls=DOCUMENT) for _ in range(2))
    fabrique.paiement(bailleur, listing_id=annonce.id, statut="success",
                      paid_at=datetime.utcnow() - timedelta(days=1))
    for objet, decision, cible in (("certification_annonce", "refusee", autre.id),
                                   ("certification_annonce", "approuvee", annonce.id),
                                   ("identite", "refusee", annonce.id)):
        db.session.add(Verification(cible_id=cible, objet=objet, decision=decision))
    # Un paiement échoué ou remboursé ne couvre aucun examen.
    for statut in ("failed", payments.A_REMBOURSER, "rembourse"):
        fabrique.paiement(bailleur, listing_id=autre.id, statut=statut)
    db.session.commit()

    etats = etats_certification([annonce, autre])
    assert etats[annonce.id] == {"nb_refus": 0, "nb_paiements": 1, "paiement_requis": False,
                                 "resoumission_gratuite": False}
    assert etats[autre.id] == {"nb_refus": 1, "nb_paiements": 0, "paiement_requis": True,
                               "resoumission_gratuite": False}


def test_sans_passerelle_la_demande_reste_libre(client, fabrique, a_certifier, bailleur,
                                                entetes):
    # Comportement d'avant le lot : sans clé CinetPay, aucune demande n'est
    # bloquée, même après deux refus.
    annonce = a_certifier
    for _ in range(2):
        db.session.add(Verification(cible_id=annonce.id, objet="certification_annonce",
                                    decision="refusee"))
    db.session.commit()

    assert _demander(client, entetes, bailleur, annonce).status_code == 200


def test_etat_de_resoumission_reserve_au_proprietaire(client, fabrique, a_certifier, bailleur,
                                                      entetes):
    annonce = a_certifier
    mes = client.get("/api/listings/mes-annonces", headers=entetes(bailleur)).get_json()
    assert mes["listings"][0]["certification_resoumission"]["paiement_requis"] is True

    for lecteur in (None, fabrique.locataire(), fabrique.bailleur()):
        detail = client.get(f"/api/listings/{annonce.id}",
                            headers=entetes(lecteur) if lecteur else None).get_json()
        assert "certification_resoumission" not in detail
        assert "retiree" not in detail


# ─── Retrait : absente de toutes les vitrines ────────────────

def test_annonce_retiree_absente_des_favoris(client, annonce, bailleur, locataire, entetes):
    client.post(f"/api/favorites/{annonce.id}", headers=entetes(locataire))

    def favoris():
        return [a["id"] for a in client.get("/api/favorites/",
                                            headers=entetes(locataire)).get_json()["listings"]]

    assert favoris() == [annonce.id]
    _retirer(client, entetes, bailleur, annonce)
    assert favoris() == []
    # Le favori est gardé : l'annonce remise en ligne y revient.
    _reactiver(client, entetes, bailleur, annonce)
    assert favoris() == [annonce.id]


def test_annonce_retiree_absente_des_recommandations(client, annonce, bailleur, locataire,
                                                     entetes):
    def recommandees():
        reponse = client.get("/api/listings/recommandations", headers=entetes(locataire))
        return [a["id"] for a in reponse.get_json()["listings"]]

    assert recommandees() == [annonce.id]
    _retirer(client, entetes, bailleur, annonce)
    assert recommandees() == []


def test_annonce_retiree_absente_du_profil_public(client, fabrique, annonce, bailleur, entetes):
    autre = fabrique.annonce(bailleur)
    _retirer(client, entetes, bailleur, annonce)

    for lecteur in (None, fabrique.locataire()):
        profil = client.get(f"/api/users/{bailleur.id}",
                            headers=entetes(lecteur) if lecteur else None).get_json()
        assert [a["id"] for a in profil["annonces"]] == [autre.id]
        assert profil["nb_annonces"] == 1


# ─── Verrous : conclusion et remise en ligne se sérialisent ──

def _verrous_pendant(client, appel):
    """Requêtes SELECT … FOR UPDATE émises pendant `appel`, compilées pour
    PostgreSQL (SQLite ignore le verrou : on vérifie qu'il est demandé)."""
    from sqlalchemy import event
    from sqlalchemy.dialects import postgresql

    verrous = []

    def observer(etat):
        if etat.is_select and etat.statement._for_update_arg is not None:
            verrous.append(str(etat.statement.compile(dialect=postgresql.dialect())))

    event.listen(db.session, "do_orm_execute", observer)
    try:
        reponse = appel()
    finally:
        event.remove(db.session, "do_orm_execute", observer)
    return reponse, verrous


def test_conclusion_verrouille_l_annonce_puis_la_candidature(client, match, bailleur, entetes):
    reponse, verrous = _verrous_pendant(
        client, lambda: client.put(f"/api/matches/{match.id}/conclure", headers=entetes(bailleur)))

    assert reponse.status_code == 200
    assert len(verrous) == 2
    assert "FROM listings" in verrous[0] and verrous[0].endswith("FOR UPDATE")
    assert "FROM matches" in verrous[1] and verrous[1].endswith("FOR NO KEY UPDATE")
    assert Listing.query.get(match.listing_id).status == "matched"


def test_reactivation_verrouille_l_annonce(client, annonce, bailleur, entetes):
    _retirer(client, entetes, bailleur, annonce)

    reponse, verrous = _verrous_pendant(client, lambda: _reactiver(client, entetes, bailleur,
                                                                   annonce))

    assert reponse.status_code == 200
    assert len(verrous) == 1 and "FROM listings" in verrous[0]


def test_reactivation_apres_une_conclusion_concurrente(client, annonce, bailleur, entetes):
    # La conclusion a été validée pendant que la remise en ligne attendait le
    # verrou : relue sous verrou, l'annonce est « matched » et reste conclue.
    # L'écriture contourne la session, dont la copie dit encore « closed ».
    _retirer(client, entetes, bailleur, annonce)
    db.session.connection().exec_driver_sql(
        "UPDATE listings SET status = 'matched' WHERE id = ?", (annonce.id,))

    reponse = _reactiver(client, entetes, bailleur, annonce)

    assert reponse.status_code == 409
    assert Listing.query.get(annonce.id).is_visible is False


# ─── Paiement de certification sans objet ────────────────────

@pytest.mark.parametrize("champs", [{"certification_status": "certified"},
                                    {"certification_status": "pending"},
                                    {"status": "closed", "is_visible": False}])
def test_paiement_de_certification_refuse_sans_examen_possible(client, fabrique, bailleur,
                                                              entetes, cinetpay, champs):
    annonce = fabrique.annonce(bailleur, documents_urls=DOCUMENT, **champs)
    assert certification_a_payer(annonce)  # aucun paiement : seul l'état l'empêche

    reponse = _initier(client, entetes, bailleur, annonce)

    assert reponse.status_code == 409
    assert Payment.query.count() == 0
    # `url_init` est un préfixe de `url_check` : comparer l'URL exacte.
    assert all(a["url"] != cinetpay.url_init for a in cinetpay.reseau.appels)
