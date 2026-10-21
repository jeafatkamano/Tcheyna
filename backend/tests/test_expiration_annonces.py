"""Lot 2.3 — Expiration des annonces sans activité (D6).

Décision D6 (20/10/2026) : une annonce sans activité expire après 30 jours,
avec une relance au propriétaire à J-7. Expirer, c'est retirer (lot 2.2) :
le propriétaire la remet en ligne par PUT /<id>/reactiver.

Activité : publication, écriture du propriétaire sur l'annonce, candidature
reçue. Les écritures du système (vues, décision de certification, mise en
avant) n'en sont pas.
"""
from datetime import datetime, timedelta

import pytest

from app import db
from app.models import Listing, Match, Notification, Verification
from app.routes import payments
from app.routes.listings import _expirer, expirer_annonces
from app.services.notifications import TYPE_RELANCE_EXPIRATION, lien_relance_expiration

JOUR = timedelta(days=1)


@pytest.fixture
def t0():
    """Dernière activité des annonces de test : il y a 40 jours, pour que
    les passages de la commande simulés (t0 + n jours) restent dans le passé
    ou le présent proche, et ne se confondent pas avec une écriture réelle."""
    return datetime.utcnow().replace(microsecond=0) - 40 * JOUR


def _ancienne(fabrique, bailleur, quand, **champs):
    """Annonce en ligne, publiée et modifiée pour la dernière fois à `quand`."""
    return fabrique.annonce(bailleur, created_at=quand, updated_at=quand, **champs)


def _relances(bailleur):
    return (Notification.query.filter_by(user_id=bailleur.id, type=TYPE_RELANCE_EXPIRATION)
            .order_by(Notification.created_at).all())


def _expirees(bailleur):
    return Notification.query.filter_by(user_id=bailleur.id, type="annonce_expiree").all()


def _en_ligne(annonce):
    annonce = db.session.get(Listing, annonce.id)
    return (annonce.status, annonce.is_visible) == ("active", True)


# ─── Relance à J-7 ───────────────────────────────────────────

def test_relance_a_j_moins_7_une_seule_fois(fabrique, bailleur, t0):
    annonce = _ancienne(fabrique, bailleur, t0)

    # J-8 : trop tôt.
    assert expirer_annonces(t0 + 22 * JOUR) == (0, 0)
    # J-7 : relance, avec un lien vers l'annonce dans l'espace propriétaire.
    assert expirer_annonces(t0 + 23 * JOUR) == (1, 0)
    # Commande rejouée le même jour, puis les jours suivants : rien de plus.
    assert expirer_annonces(t0 + 23 * JOUR + timedelta(hours=1)) == (0, 0)
    assert expirer_annonces(t0 + 26 * JOUR) == (0, 0)

    (relance,) = _relances(bailleur)
    echeance = t0 + 30 * JOUR
    assert relance.lien == f"/owner/listings/{annonce.id}?echeance={echeance:%Y-%m-%d}"
    assert relance.lien == lien_relance_expiration(annonce.id, echeance)
    assert relance.titre == "Votre annonce est-elle toujours d'actualité ?"
    assert f"à partir du {echeance:%d/%m/%Y}" in relance.contenu
    assert "Confirmez" in relance.contenu
    assert _en_ligne(annonce)


# ─── Expiration à J+30 ───────────────────────────────────────

def test_expiration_a_j_plus_30_et_pas_a_j_plus_29(fabrique, bailleur, t0):
    annonce = _ancienne(fabrique, bailleur, t0)
    expirer_annonces(t0 + 23 * JOUR)

    assert expirer_annonces(t0 + 29 * JOUR) == (0, 0)
    assert expirer_annonces(t0 + 30 * JOUR - timedelta(minutes=1)) == (0, 0)
    assert _en_ligne(annonce)

    assert expirer_annonces(t0 + 30 * JOUR) == (0, 1)

    annonce = db.session.get(Listing, annonce.id)
    assert (annonce.status, annonce.is_visible) == ("closed", False)
    (notif,) = _expirees(bailleur)
    assert notif.titre == "Annonce retirée faute d'activité"
    assert notif.lien == f"/owner/listings/{annonce.id}"
    assert f"depuis le {t0:%d/%m/%Y}" in notif.contenu
    # La raison est consignée au journal, sans décideur humain.
    (trace,) = Verification.query.filter_by(cible_id=annonce.id).all()
    assert (trace.objet, trace.decision, trace.acteur_id) == ("annonce", "expiree", None)
    assert f"depuis le {t0:%d/%m/%Y}" in trace.motif

    # Idempotence : rejouée, la commande ne retire ni ne notifie plus rien.
    assert expirer_annonces(t0 + 30 * JOUR + timedelta(hours=2)) == (0, 0)
    assert expirer_annonces(t0 + 31 * JOUR) == (0, 0)
    assert len(_expirees(bailleur)) == 1
    assert len(_relances(bailleur)) == 1


@pytest.mark.parametrize("jour_relance, jour_retrait", [
    (26, 33),   # cron arrêté de J-7 à J-5 : relance à J-4, retrait 7 jours après
    (40, 47),   # cron arrêté pendant toute la fenêtre, ou annonce déjà ancienne
])
def test_cron_manque_jamais_de_retrait_sans_7_jours_de_preavis(fabrique, bailleur, t0,
                                                                jour_relance, jour_retrait):
    annonce = _ancienne(fabrique, bailleur, t0)

    assert expirer_annonces(t0 + jour_relance * JOUR) == (1, 0)
    (relance,) = _relances(bailleur)
    assert f"à partir du {t0 + jour_retrait * JOUR:%d/%m/%Y}" in relance.contenu

    assert expirer_annonces(t0 + (jour_retrait - 1) * JOUR) == (0, 0)
    assert _en_ligne(annonce)
    assert expirer_annonces(t0 + jour_retrait * JOUR) == (0, 1)
    assert not _en_ligne(annonce)


def test_premiere_execution_sur_annonces_anciennes(fabrique, bailleur, t0):
    """Au déploiement, une annonce sans activité depuis des mois est relancée,
    pas retirée d'emblée."""
    tres_ancienne = _ancienne(fabrique, bailleur, t0 - 200 * JOUR)

    assert expirer_annonces(t0 + 40 * JOUR) == (1, 0)
    assert _en_ligne(tres_ancienne)


# ─── Une nouvelle activité repousse l'échéance ───────────────

def test_candidature_repousse_l_echeance_et_rouvre_la_relance(fabrique, bailleur, t0):
    annonce = _ancienne(fabrique, bailleur, t0)
    expirer_annonces(t0 + 23 * JOUR)
    fabrique.match(annonce=annonce, status="pending", created_at=t0 + 25 * JOUR)

    assert expirer_annonces(t0 + 30 * JOUR) == (0, 0)
    assert expirer_annonces(t0 + 47 * JOUR) == (0, 0)
    assert _en_ligne(annonce)

    # Nouvelle période d'inactivité : nouvelle relance, nouvelle échéance.
    assert expirer_annonces(t0 + 48 * JOUR) == (1, 0)
    premiere, seconde = _relances(bailleur)
    assert premiere.lien != seconde.lien
    assert seconde.lien == lien_relance_expiration(annonce.id, t0 + 55 * JOUR)

    assert expirer_annonces(t0 + 55 * JOUR) == (0, 1)


def _passer_la_relance(annonce, bailleur):
    """Annonce sans activité depuis 25 jours : relancée maintenant."""
    assert expirer_annonces() == (1, 0)
    return _relances(bailleur)[0]


def test_modification_repousse_l_echeance_meme_sans_changement(client, fabrique, bailleur,
                                                              entetes):
    annonce = _ancienne(fabrique, bailleur, datetime.utcnow() - 25 * JOUR)
    _passer_la_relance(annonce, bailleur)

    # Le formulaire renvoie le corps tel quel : enregistrer suffit.
    reponse = client.put(f"/api/listings/{annonce.id}", headers=entetes(bailleur),
                         json={"title_fr": annonce.title_fr})
    assert reponse.status_code == 200

    maintenant = datetime.utcnow()
    assert expirer_annonces(maintenant + 8 * JOUR) == (0, 0)
    assert expirer_annonces(maintenant + 22 * JOUR) == (0, 0)
    assert _en_ligne(annonce)
    assert expirer_annonces(maintenant + 23 * JOUR + timedelta(minutes=1)) == (1, 0)
    assert len(_relances(bailleur)) == 2


def test_photo_ajoutee_compte_comme_activite(client, fabrique, bailleur, entetes, fichier_image):
    annonce = _ancienne(fabrique, bailleur, datetime.utcnow() - 25 * JOUR)

    reponse = client.post(f"/api/listings/{annonce.id}/photos", headers=entetes(bailleur),
                          data={"file": fichier_image("salon.png")},
                          content_type="multipart/form-data")
    assert reponse.status_code == 201

    assert expirer_annonces() == (0, 0)


# ─── PUT /listings/<id>/confirmer ────────────────────────────

def test_confirmer_repousse_l_echeance(client, fabrique, bailleur, entetes):
    annonce = _ancienne(fabrique, bailleur, datetime.utcnow() - 25 * JOUR)
    _passer_la_relance(annonce, bailleur)
    avant = annonce.to_dict(avec_adresse=True)

    reponse = client.put(f"/api/listings/{annonce.id}/confirmer", headers=entetes(bailleur))

    assert reponse.status_code == 200
    corps = reponse.get_json()
    assert corps["message"] == "Annonce confirmée : elle reste en ligne"
    prevue = datetime.fromisoformat(corps["expiration_prevue"])
    assert abs(prevue - (datetime.utcnow() + 30 * JOUR)) < timedelta(minutes=1)
    # Rien d'autre ne change.
    apres = db.session.get(Listing, annonce.id).to_dict(avec_adresse=True)
    assert apres == avant

    assert expirer_annonces(datetime.utcnow() + 8 * JOUR) == (0, 0)
    assert _en_ligne(annonce)


def test_confirmer_est_idempotent(client, annonce, bailleur, entetes):
    for _ in range(2):
        reponse = client.put(f"/api/listings/{annonce.id}/confirmer", headers=entetes(bailleur))
        assert reponse.status_code == 200
    assert _en_ligne(annonce)


def test_confirmer_refuse_a_un_tiers(client, fabrique, annonce, entetes):
    autre_bailleur = fabrique.bailleur(phone_verified=True)
    url = f"/api/listings/{annonce.id}/confirmer"
    avant = db.session.get(Listing, annonce.id).updated_at

    assert client.put(url).status_code == 401
    assert client.put(url, headers=entetes(autre_bailleur)).status_code == 403
    for tiers in (fabrique.locataire(), fabrique.admin()):
        assert client.put(url, headers=entetes(tiers)).status_code == 403
    assert db.session.get(Listing, annonce.id).updated_at == avant


def test_confirmer_une_annonce_inconnue(client, bailleur, entetes):
    assert client.put("/api/listings/inconnue/confirmer",
                      headers=entetes(bailleur)).status_code == 404


def test_confirmer_ne_republie_pas_une_annonce_retiree(client, annonce, bailleur, entetes):
    client.put(f"/api/listings/{annonce.id}/retirer", headers=entetes(bailleur))

    reponse = client.put(f"/api/listings/{annonce.id}/confirmer", headers=entetes(bailleur))

    assert reponse.status_code == 409
    assert reponse.get_json()["details"][0]["code"] == "annonce_retiree"
    assert not _en_ligne(annonce)


def test_confirmer_une_annonce_conclue(client, fabrique, bailleur, entetes):
    annonce = fabrique.annonce(bailleur, status="matched")

    reponse = client.put(f"/api/listings/{annonce.id}/confirmer", headers=entetes(bailleur))

    assert reponse.status_code == 409
    assert reponse.get_json()["details"][0]["code"] == "annonce_conclue"


# ─── Écritures du système : pas une activité ─────────────────

def test_vues_certification_et_mise_en_avant_ne_repoussent_pas_l_echeance(
        client, fabrique, bailleur, admin, locataire, entetes):
    quand = (datetime.utcnow() - 25 * JOUR).replace(microsecond=0)
    annonce = _ancienne(fabrique, bailleur, quand, certification_status="pending",
                        documents_urls="supabase://documents/titre.pdf")

    # Vues d'un visiteur et d'un locataire.
    assert client.get(f"/api/listings/{annonce.id}").status_code == 200
    assert client.get(f"/api/listings/{annonce.id}", headers=entetes(locataire)).status_code == 200
    # Décision de l'administrateur.
    assert client.put(f"/api/admin/certifier/{annonce.id}", headers=entetes(admin),
                      json={"approuve": True}).status_code == 200

    annonce = db.session.get(Listing, annonce.id)
    assert (annonce.views_count, annonce.certification_status) == (2, "certified")
    assert annonce.updated_at == quand
    assert expirer_annonces() == (1, 0)

    # Mise en avant payée, confirmée par la passerelle.
    paiement = fabrique.paiement(bailleur, type_paiement="mise_en_avant",
                                 listing_id=annonce.id, montant=50_000)
    payments._confirmer(paiement)
    db.session.commit()

    annonce = db.session.get(Listing, annonce.id)
    assert annonce.premium_actif
    assert annonce.updated_at == quand


def test_mise_en_avant_en_cours_ni_relancee_ni_retiree(fabrique, bailleur, t0):
    """Comportement par défaut, question posée dans la PR : la mise en avant
    payée court jusqu'au bout ; l'annonce est relancée à sa fin."""
    fin = t0 + 40 * JOUR
    annonce = _ancienne(fabrique, bailleur, t0, is_premium=True, premium_until=fin)

    assert expirer_annonces(t0 + 30 * JOUR) == (0, 0)
    assert expirer_annonces(fin - timedelta(minutes=1)) == (0, 0)
    assert _relances(bailleur) == []

    assert expirer_annonces(fin + timedelta(minutes=1)) == (1, 0)
    assert expirer_annonces(fin + 7 * JOUR) == (0, 1)
    assert not _en_ligne(annonce)


# ─── Annonces non concernées ─────────────────────────────────

def test_annonce_conclue_ou_retiree_ignoree(fabrique, bailleur, t0):
    fabrique.annonce(bailleur, created_at=t0, updated_at=t0, status="matched")
    fabrique.annonce(bailleur, created_at=t0, updated_at=t0, status="closed", is_visible=False)

    assert expirer_annonces(t0 + 30 * JOUR) == (0, 0)
    assert expirer_annonces(t0 + 40 * JOUR) == (0, 0)
    assert _relances(bailleur) == [] and _expirees(bailleur) == []


def test_annonce_recente_ignoree(fabrique, bailleur):
    fabrique.annonce(bailleur)

    assert expirer_annonces() == (0, 0)


# ─── Après l'expiration ──────────────────────────────────────

def _expiree(fabrique, bailleur, t0):
    annonce = _ancienne(fabrique, bailleur, t0)
    expirer_annonces(t0 + 23 * JOUR)
    assert expirer_annonces(t0 + 30 * JOUR) == (0, 1)
    return annonce


def test_annonce_expiree_invisible_du_public(client, fabrique, bailleur, entetes, t0):
    annonce = _expiree(fabrique, bailleur, t0)

    assert annonce.id not in [a["id"] for a in client.get("/api/listings/").get_json()["listings"]]
    assert client.get(f"/api/listings/{annonce.id}").status_code == 404
    assert client.get(f"/api/listings/{annonce.id}",
                      headers=entetes(fabrique.locataire())).status_code == 404
    detail = client.get(f"/api/listings/{annonce.id}", headers=entetes(bailleur))
    assert (detail.status_code, detail.get_json()["retiree"]) == (200, True)


def test_annonce_expiree_reactivable_par_son_proprietaire(client, fabrique, bailleur, entetes,
                                                          t0):
    annonce = _expiree(fabrique, bailleur, t0)

    reponse = client.put(f"/api/listings/{annonce.id}/reactiver", headers=entetes(bailleur))

    assert reponse.status_code == 200
    assert _en_ligne(annonce)
    # La remise en ligne est une activité : nouvelle période de 30 jours.
    assert expirer_annonces(datetime.utcnow() + 22 * JOUR) == (0, 0)


def test_annonce_expiree_non_reactivable_sans_telephone_verifie(client, fabrique, entetes, t0):
    bailleur = fabrique.bailleur()  # téléphone non vérifié (D3)
    annonce = _expiree(fabrique, bailleur, t0)

    reponse = client.put(f"/api/listings/{annonce.id}/reactiver", headers=entetes(bailleur))

    assert reponse.status_code == 403
    assert reponse.get_json()["details"][0]["code"] == "telephone_non_verifie"
    assert not _en_ligne(annonce)


def test_annonce_expiree_non_reactivable_par_un_tiers(client, fabrique, bailleur, entetes, t0):
    annonce = _expiree(fabrique, bailleur, t0)
    autre = fabrique.bailleur(phone_verified=True)

    reponse = client.put(f"/api/listings/{annonce.id}/reactiver", headers=entetes(autre))

    assert reponse.status_code == 403
    assert not _en_ligne(annonce)


def test_candidatures_conservees_a_l_expiration(fabrique, bailleur, t0):
    annonce = _ancienne(fabrique, bailleur, t0)
    en_attente = fabrique.match(annonce=annonce, status="pending", created_at=t0)
    acceptee = fabrique.match(annonce=annonce, status="accepted", created_at=t0)
    expirer_annonces(t0 + 23 * JOUR)

    assert expirer_annonces(t0 + 30 * JOUR) == (0, 1)

    assert (db.session.get(Match, en_attente.id).status,
            db.session.get(Match, acceptee.id).status) == ("pending", "accepted")


def test_activite_arrivee_apres_la_lecture_garde_l_annonce(fabrique, bailleur, t0):
    """Le retrait relit l'annonce sous verrou : une confirmation arrivée entre
    la lecture de la commande et le retrait la garde en ligne."""
    annonce = _ancienne(fabrique, bailleur, t0)
    annonce.updated_at = t0 + 29 * JOUR
    db.session.commit()

    assert _expirer(annonce.id, t0 + 30 * JOUR) is False
    assert _en_ligne(annonce)
    assert _expirees(bailleur) == []


# ─── Commande planifiée ──────────────────────────────────────

def test_commande_flask_annonces_expirer(app, fabrique, bailleur):
    _ancienne(fabrique, bailleur, datetime.utcnow() - 25 * JOUR)
    runner = app.test_cli_runner()

    premier = runner.invoke(args=["annonces", "expirer"])
    second = runner.invoke(args=["annonces", "expirer"])

    assert premier.exit_code == 0, premier.output
    assert premier.output.strip() == ("1 relance(s) envoyée(s), 0 annonce(s) retirée(s) "
                                      "faute d'activité.")
    assert second.output.strip().startswith("0 relance(s)")
