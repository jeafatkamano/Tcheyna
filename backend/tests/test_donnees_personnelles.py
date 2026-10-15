"""Lot 1.5 : journal des décisions, suppression des pièces, suppression de compte."""
from datetime import datetime, timedelta

import pytest
import requests

from app import db
from app.models import (
    Favorite,
    FichierASupprimer,
    Notification,
    OTPCode,
    TenantPassport,
    User,
    Verification,
)
from app.services import donnees_personnelles as dp
from tests.conftest import MOT_DE_PASSE, SUPABASE_URL_TEST

OBJETS = f"{SUPABASE_URL_TEST}/storage/v1/object/"
PRIVE = f"{OBJETS}tcheyna-documents/"
PUBLIC = f"{SUPABASE_URL_TEST}/storage/v1/object/public/tcheyna-photos/"


def _candidat(fabrique, **pieces):
    """Locataire niveau 1 ayant déposé des pièces dans le compartiment privé."""
    user = fabrique.locataire(niveau=1, cni_uploaded="cni_recto_url" in pieces, passeport=False)
    fabrique.passeport(user, docs_uploaded="cni_recto_url" in pieces, **pieces)
    return user


def _supprimes(supabase):
    return sorted(a["url"] for a in supabase.suppressions)


def _journal(cible_id):
    return Verification.query.filter_by(cible_id=cible_id).order_by(Verification.created_at).all()


# ─── Décisions : journal et suppression des pièces ───────────

def test_cni_validee_journalisee_et_pieces_supprimees(client, fabrique, admin, entetes, supabase):
    candidat = _candidat(fabrique, cni_recto_url="supabase://documents/recto.png",
                         cni_verso_url="supabase://documents/verso.png")
    score_avant = candidat.passport.score

    reponse = client.put(f"/api/admin/verify-cni/{candidat.id}", headers=entetes(admin),
                         json={"approuve": True, "motif": "Pièce lisible"})

    assert reponse.status_code == 200
    assert _supprimes(supabase) == [f"{PRIVE}documents/recto.png", f"{PRIVE}documents/verso.png"]
    passeport = candidat.passport
    assert (passeport.cni_recto_url, passeport.cni_verso_url, passeport.passport_url) == (None,) * 3
    assert passeport.identite_deposee_le is None
    # Le dépôt reste acquis sans le fichier : niveau, score, sortie de file.
    assert candidat.cni_verified and candidat.cni_uploaded and passeport.docs_uploaded
    assert candidat.trust_level == 2
    assert passeport.score == score_avant + 15
    assert client.get("/api/admin/cni-pending", headers=entetes(admin)).get_json() == []
    assert FichierASupprimer.query.count() == 0

    [ligne] = _journal(candidat.id)
    assert (ligne.acteur_id, ligne.objet, ligne.decision, ligne.motif) == (
        admin.id, "identite", "approuvee", "Pièce lisible")
    assert ligne.created_at is not None


def test_cni_refusee_journalisee_et_pieces_supprimees(client, fabrique, admin, entetes, supabase):
    candidat = _candidat(fabrique, passport_url="supabase://documents/passeport.pdf")

    reponse = client.put(f"/api/admin/verify-cni/{candidat.id}", headers=entetes(admin),
                         json={"approuve": False, "motif": "Photo floue"})

    assert reponse.status_code == 200
    assert _supprimes(supabase) == [f"{PRIVE}documents/passeport.pdf"]
    assert candidat.passport.passport_url is None
    assert not candidat.cni_verified and not candidat.cni_uploaded
    [ligne] = _journal(candidat.id)
    assert (ligne.decision, ligne.motif) == ("refusee", "Photo floue")


def test_refus_sans_piece_journalise_comme_classe(client, fabrique, admin, entetes):
    candidat = fabrique.locataire(niveau=1, cni_uploaded=True)

    client.put(f"/api/admin/verify-cni/{candidat.id}", headers=entetes(admin),
               json={"approuve": False})

    [ligne] = _journal(candidat.id)
    assert (ligne.objet, ligne.decision, ligne.motif) == ("identite", "classee", "Aucune pièce déposée")


@pytest.mark.parametrize("approuve, decision", [(True, "approuvee"), (False, "refusee")])
def test_revenus_journalises_et_justificatif_supprime(client, fabrique, admin, entetes, supabase,
                                                      approuve, decision):
    candidat = fabrique.locataire(niveau=2, passeport=False)
    fabrique.passeport(candidat, income_doc_url="supabase://documents/paie.pdf")

    reponse = client.put(f"/api/admin/verify-revenus/{candidat.id}", headers=entetes(admin),
                         json={"approuve": approuve})

    assert reponse.status_code == 200
    assert _supprimes(supabase) == [f"{PRIVE}documents/paie.pdf"]
    assert candidat.passport.income_doc_url is None
    assert candidat.income_verified is approuve
    assert candidat.trust_level == (3 if approuve else 2)
    # Refusé ou validé, le dossier quitte la file d'attente.
    assert client.get("/api/admin/revenus-pending", headers=entetes(admin)).get_json() == []
    [ligne] = _journal(candidat.id)
    assert (ligne.objet, ligne.decision) == ("revenus", decision)


def test_certification_journalisee_pieces_de_propriete_conservees(client, fabrique, admin,
                                                                  entetes, supabase):
    annonce = fabrique.annonce(certification_status="pending",
                               documents_urls="supabase://documents/titre.pdf")

    reponse = client.put(f"/api/admin/certifier/{annonce.id}", headers=entetes(admin),
                         json={"approuve": False, "motif": "Titre illisible"})

    assert reponse.status_code == 200
    assert supabase.suppressions == []
    assert annonce.documents == ["supabase://documents/titre.pdf"]
    [ligne] = _journal(annonce.id)
    assert (ligne.acteur_id, ligne.objet, ligne.decision, ligne.motif) == (
        admin.id, "certification_annonce", "refusee", "Titre illisible")


def test_changement_de_statut_journalise(client, admin, locataire, entetes):
    url = f"/api/admin/users/{locataire.id}/statut"
    client.put(url, headers=entetes(admin), json={"is_active": False})
    client.put(url, headers=entetes(admin), json={"is_active": False})  # sans effet
    client.put(url, headers=entetes(admin), json={"is_active": True})

    assert [v.decision for v in _journal(locataire.id)] == ["desactivation", "activation"]


# ─── Suppression différée en cas de panne ────────────────────

def test_panne_du_stockage_la_suppression_est_reprise(client, app, fabrique, admin, entetes,
                                                      supabase, reseau):
    candidat = _candidat(fabrique, cni_recto_url="supabase://documents/recto.png")
    reseau.repondre("DELETE", OBJETS, exception=requests.ConnectionError("injoignable"))

    reponse = client.put(f"/api/admin/verify-cni/{candidat.id}", headers=entetes(admin),
                         json={"approuve": True})

    # La décision n'attend pas le stockage ; le fichier reste désigné.
    assert reponse.status_code == 200
    assert candidat.passport.cni_recto_url is None
    [attente] = FichierASupprimer.query.all()
    assert (attente.reference, attente.origine, attente.tentatives) == (
        "supabase://documents/recto.png", "decision_identite", 1)

    resultat = app.test_cli_runner().invoke(args=["donnees", "retenter-suppressions"])
    assert resultat.exit_code == 1
    assert FichierASupprimer.query.one().tentatives == 2

    reseau.repondre("DELETE", OBJETS, status=200, json={})
    resultat = app.test_cli_runner().invoke(args=["donnees", "retenter-suppressions"])
    assert resultat.exit_code == 0, resultat.output
    assert FichierASupprimer.query.count() == 0


@pytest.mark.parametrize("status, corps", [(404, {}), (400, {"statusCode": "404", "error": "not_found"})])
def test_fichier_deja_absent_compte_comme_supprime(client, fabrique, admin, entetes, supabase,
                                                   reseau, status, corps):
    candidat = _candidat(fabrique, cni_recto_url="supabase://documents/recto.png")
    reseau.repondre("DELETE", OBJETS, status=status, json=corps)

    client.put(f"/api/admin/verify-cni/{candidat.id}", headers=entetes(admin),
               json={"approuve": False})

    assert FichierASupprimer.query.count() == 0


def test_refus_du_stockage_reste_en_attente(client, fabrique, admin, entetes, supabase, reseau):
    candidat = _candidat(fabrique, cni_recto_url="supabase://documents/recto.png")
    reseau.repondre("DELETE", OBJETS, status=403, json={"statusCode": "403"})

    client.put(f"/api/admin/verify-cni/{candidat.id}", headers=entetes(admin),
               json={"approuve": False})

    assert FichierASupprimer.query.count() == 1


def test_retrait_d_une_piece_par_le_locataire_passe_par_la_file(client, fabrique, entetes,
                                                                supabase, reseau):
    candidat = _candidat(fabrique, income_doc_url="supabase://documents/paie.pdf",
                         revenus_deposes_le=datetime.utcnow())
    reseau.repondre("DELETE", OBJETS, exception=requests.ConnectionError("injoignable"))

    reponse = client.delete("/api/passport/upload/income", headers=entetes(candidat))

    assert reponse.status_code == 200
    assert candidat.passport.revenus_deposes_le is None
    assert FichierASupprimer.query.one().origine == "retrait_piece"


def test_depot_d_une_piece_date_le_depot(client, locataire, entetes, fichier_image):
    reponse = client.post("/api/passport/upload/cni_recto", headers=entetes(locataire),
                          data={"file": fichier_image("cni.png")},
                          content_type="multipart/form-data")

    assert reponse.status_code == 200
    assert locataire.passport.identite_deposee_le is not None
    assert locataire.passport.revenus_deposes_le is None


# ─── Purge (durée D5 non tranchée) ───────────────────────────

def test_purge_refusee_sans_duree_configuree(app, fabrique, supabase):
    _candidat(fabrique, cni_recto_url="supabase://documents/recto.png",
              identite_deposee_le=datetime.utcnow() - timedelta(days=3650))
    assert app.config["DUREE_CONSERVATION_PIECES_JOURS"] is None

    with pytest.raises(dp.PurgeNonConfiguree):
        dp.purger_pieces_sans_decision()
    resultat = app.test_cli_runner().invoke(args=["donnees", "purger-pieces"])

    assert resultat.exit_code != 0
    assert "D5" in resultat.output
    assert supabase.suppressions == []


def test_purge_parametree_supprime_les_seules_pieces_echues(app, fabrique, supabase):
    app.config["DUREE_CONSERVATION_PIECES_JOURS"] = 30
    il_y_a = lambda jours: datetime.utcnow() - timedelta(days=jours)  # noqa: E731
    echu = _candidat(fabrique, cni_recto_url="supabase://documents/echu.png",
                     identite_deposee_le=il_y_a(40),
                     income_doc_url="supabase://documents/echu-paie.pdf",
                     revenus_deposes_le=il_y_a(31))
    recent = _candidat(fabrique, cni_recto_url="supabase://documents/recent.png",
                       identite_deposee_le=il_y_a(10))

    assert dp.purger_pieces_sans_decision() == 2

    assert _supprimes(supabase) == [f"{PRIVE}documents/echu-paie.pdf", f"{PRIVE}documents/echu.png"]
    assert echu.passport.cni_recto_url is None and echu.passport.income_doc_url is None
    assert echu.cni_uploaded is False
    assert recent.passport.cni_recto_url == "supabase://documents/recent.png"
    journal = _journal(echu.id)
    assert {(v.acteur_id, v.objet, v.decision) for v in journal} == {
        (None, "identite", "purgee"), (None, "revenus", "purgee")}
    assert Notification.query.filter_by(user_id=echu.id).count() == 2


def test_rattrapage_des_pieces_validees_avant_le_lot(app, fabrique, supabase):
    ancien = fabrique.locataire(niveau=3, passeport=False)
    fabrique.passeport(ancien, cni_recto_url="supabase://documents/ancien.png",
                       income_doc_url="supabase://documents/ancien-paie.pdf", income_verified=True)
    en_attente = _candidat(fabrique, cni_recto_url="supabase://documents/attente.png")

    resultat = app.test_cli_runner().invoke(args=["donnees", "rattraper-pieces-decidees"])

    assert resultat.exit_code == 0, resultat.output
    assert _supprimes(supabase) == [f"{PRIVE}documents/ancien-paie.pdf",
                                    f"{PRIVE}documents/ancien.png"]
    assert ancien.cni_verified and ancien.income_verified
    assert en_attente.passport.cni_recto_url == "supabase://documents/attente.png"


# ─── Suppression de compte ───────────────────────────────────

def test_suppression_exige_le_mot_de_passe(client, locataire, entetes):
    url = "/api/users/me/suppression"
    assert client.post(url, headers=entetes(locataire), json={}).status_code == 422
    reponse = client.post(url, headers=entetes(locataire), json={"mot_de_passe": "faux-mot"})

    assert reponse.status_code == 422
    assert reponse.get_json()["details"][0]["code"] == "mot_de_passe_incorrect"
    assert locataire.is_active and locataire.supprime_le is None


def test_suppression_d_un_compte_locataire(client, fabrique, entetes, supabase):
    locataire = fabrique.locataire(niveau=3, passeport=False,
                                   avatar_url=f"{PUBLIC}avatars/profil-x.webp", bio="Ma bio",
                                   quartier="Kipé")
    fabrique.passeport(locataire, cni_recto_url="supabase://documents/recto.png",
                       income_doc_url="supabase://documents/paie.pdf",
                       garant_nom="Oncle Mamadou")
    email, telephone = locataire.email, locataire.phone
    en_cours = fabrique.match(locataire, status="pending", message="Je travaille à la banque")
    conclue = fabrique.match(locataire, status="completed", message="Bonjour")
    avis = fabrique.avis(locataire, conclue.listing.landlord, match=conclue)
    paiement = fabrique.paiement(locataire, statut="success", type_paiement="abonnement_passeport")
    db.session.add_all([Favorite(user_id=locataire.id, listing_id=en_cours.listing_id),
                        Notification(user_id=locataire.id, type="x", titre="t"),
                        OTPCode(user_id=locataire.id, code_hash="a" * 64, phone=telephone,
                                expires_at=datetime.utcnow())])
    db.session.commit()
    en_tetes = entetes(locataire)

    reponse = client.post("/api/users/me/suppression", headers=en_tetes,
                          json={"mot_de_passe": MOT_DE_PASSE})

    assert reponse.status_code == 200
    user = db.session.get(User, locataire.id)
    assert user.full_name == "Compte supprimé"
    assert user.email.endswith("@compte-supprime.invalid") and user.phone is None
    assert (user.avatar_url, user.bio, user.quartier, user.trust_level) == (None, None, None, 0)
    assert user.is_active is False and user.supprime_le is not None
    # Fichiers : photo de profil (public), CNI et justificatif (privé).
    assert _supprimes(supabase) == [f"{PRIVE}documents/paie.pdf", f"{PRIVE}documents/recto.png",
                                    f"{OBJETS}tcheyna-photos/avatars/profil-x.webp"]
    assert TenantPassport.query.filter_by(tenant_id=user.id).count() == 0
    for modele in (Favorite, Notification, OTPCode):
        assert modele.query.filter_by(user_id=user.id).count() == 0
    # Jetons révoqués, ancien identifiant inutilisable, e-mail et numéro libérés.
    assert client.get("/api/auth/me", headers=en_tetes).status_code == 401
    assert client.post("/api/auth/login", json={"email": email, "password": MOT_DE_PASSE}
                       ).status_code == 401
    assert User.query.filter((User.email == email) | (User.phone == telephone)).count() == 0
    # Candidature en cours annulée, son message effacé ; l'historique conclu,
    # l'avis (anonymisé) et le paiement (obligation comptable) restent.
    assert (en_cours.status, en_cours.message) == ("cancelled", None)
    assert conclue.status == "completed"
    assert avis.reviewer.full_name == "Compte supprimé"
    assert paiement.user_id == user.id and paiement.montant == 250_000
    assert FichierASupprimer.query.count() == 0


def test_suppression_d_un_compte_bailleur(client, fabrique, bailleur, entetes, supabase):
    annonce = fabrique.annonce(bailleur, certification_status="pending",
                               images_urls=f"{PUBLIC}photos/annonce-1.webp,https://images.unsplash.com/x",
                               documents_urls="supabase://documents/titre.pdf")
    candidature = fabrique.match(annonce=annonce, status="accepted")

    reponse = client.post("/api/users/me/suppression", headers=entetes(bailleur),
                          json={"mot_de_passe": MOT_DE_PASSE})

    assert reponse.status_code == 200
    # La photo externe (démonstration) n'est ni supprimée ni mise en attente.
    assert _supprimes(supabase) == [f"{PRIVE}documents/titre.pdf",
                                    f"{OBJETS}tcheyna-photos/photos/annonce-1.webp"]
    assert FichierASupprimer.query.count() == 0
    assert (annonce.status, annonce.is_visible, annonce.adresse) == ("closed", False, None)
    assert (annonce.images_urls, annonce.documents_urls) == (None, None)
    assert annonce.certification_status == "none"
    assert candidature.status == "cancelled"


def test_compte_supprime_ne_peut_pas_etre_reactive(client, admin, locataire, entetes):
    client.post("/api/users/me/suppression", headers=entetes(locataire),
                json={"mot_de_passe": MOT_DE_PASSE})

    reponse = client.put(f"/api/admin/users/{locataire.id}/statut", headers=entetes(admin),
                         json={"is_active": True})

    assert reponse.status_code == 409
    assert db.session.get(User, locataire.id).is_active is False


def test_un_admin_ne_supprime_pas_son_compte(client, admin, entetes):
    reponse = client.post("/api/users/me/suppression", headers=entetes(admin),
                          json={"mot_de_passe": MOT_DE_PASSE})

    assert reponse.status_code == 403
    assert admin.supprime_le is None
