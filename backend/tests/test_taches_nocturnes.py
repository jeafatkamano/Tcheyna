"""Lot 1.25 : tâches nocturnes déclenchées par cron-job.org (D13 révisée)."""
import logging
from datetime import datetime, timedelta

import pytest
import requests

from app import db
from app.models import FichierASupprimer, Notification
from app.services import donnees_personnelles as dp
from app.services import notifications as notify
from app.services import taches_nocturnes
from tests.conftest import SUPABASE_URL_TEST

URL = "/api/interne/taches-nocturnes"
JETON = "jeton-des-taches-nocturnes-de-test-assez-long"
OBJETS = f"{SUPABASE_URL_TEST}/storage/v1/object/"


@pytest.fixture
def jeton(app):
    app.config["TACHES_NOCTURNES_JETON"] = JETON
    return {"X-Taches-Jeton": JETON}


@pytest.fixture
def travail(fabrique, locataire, annonce):
    """Un peu de travail pour chaque étape qui en a un : un fichier resté en
    file, une pièce sans décision depuis plus de 12 mois, une visite demain."""
    fichier = FichierASupprimer(reference="supabase://documents/ancien.png",
                                origine="decision_identite")
    db.session.add(fichier)
    oublie = fabrique.locataire(niveau=1, cni_uploaded=True, passeport=False)
    fabrique.passeport(oublie, docs_uploaded=True, cni_recto_url="supabase://documents/recto.png",
                       identite_deposee_le=datetime.utcnow() - timedelta(days=400))
    fabrique.match(locataire, annonce, status="accepted",
                   visite_date=datetime.utcnow() + timedelta(hours=20))
    db.session.commit()


def _etapes(reponse):
    return {e["etape"]: e for e in reponse.get_json()["etapes"]}


# ─── Accès ───────────────────────────────────────────────────

def test_sans_jeton_configure_la_route_est_desactivee(client, app):
    assert not app.config["TACHES_NOCTURNES_JETON"]

    # Aucune limite de débit non plus : rien ne distingue la route d'une
    # adresse inconnue.
    for _ in range(7):
        reponse = client.post(URL, headers={"X-Taches-Jeton": "n-importe-quoi"})
        assert reponse.status_code == 404
    assert reponse.get_json()["error"] == "Ressource introuvable"


@pytest.mark.parametrize("entetes_appel, chaine", [
    ({}, ""),
    ({"X-Taches-Jeton": ""}, ""),
    ({"X-Taches-Jeton": JETON[:-1]}, ""),
    ({"X-Taches-Jeton": JETON + "x"}, ""),
    ({"Authorization": f"Bearer {JETON}"}, ""),
    # Le jeton n'est jamais lu dans l'URL.
    ({}, f"?jeton={JETON}"),
    ({}, f"?X-Taches-Jeton={JETON}"),
])
def test_jeton_faux_ou_absent_refuse(client, jeton, supabase, travail, entetes_appel, chaine):
    reponse = client.post(URL + chaine, headers=entetes_appel)

    assert reponse.status_code == 401
    # Même réponse dans tous les cas : rien ne dit ce qui manque.
    assert reponse.get_json() == {"error": "Authentification requise", "details": []}
    assert supabase.suppressions == []
    assert FichierASupprimer.query.count() == 1


def test_seule_la_methode_post_est_acceptee(client, jeton):
    assert client.get(URL, headers=jeton).status_code == 405


def test_cinq_echecs_par_heure_et_par_ip(client, jeton):
    for _ in range(5):
        assert client.post(URL, headers={"X-Taches-Jeton": "faux"}).status_code == 401
    assert client.post(URL, headers={"X-Taches-Jeton": "faux"}).status_code == 429
    # Une autre IP a son propre compteur d'échecs.
    autre_ip = client.post(URL, headers={"X-Taches-Jeton": "faux"},
                           environ_base={"REMOTE_ADDR": "203.0.113.9"})
    assert autre_ip.status_code == 401


def test_des_echecs_ne_bloquent_pas_le_bon_jeton(client, jeton):
    # Audit du 27/10 : un inconnu qui épuise la limite depuis la même IP
    # (cron-job.org sort par des IP partagées) ne doit pas empêcher l'appel
    # légitime de la nuit.
    for _ in range(6):
        client.post(URL, headers={"X-Taches-Jeton": "faux"})
    assert client.post(URL, headers=jeton).status_code == 200


def test_bon_jeton_limite_a_dix_appels_par_jour_toutes_ip(client, jeton):
    for i in range(10):
        ip = {"REMOTE_ADDR": f"203.0.113.{i + 1}"}
        assert client.post(URL, headers=jeton, environ_base=ip).status_code == 200
    autre = client.post(URL, headers=jeton, environ_base={"REMOTE_ADDR": "198.51.100.7"})
    assert autre.status_code == 429


def test_aucun_entete_cors(client, jeton):
    origine = {"Origin": "http://localhost:5173"}

    reponse = client.post(URL, headers={**jeton, **origine})
    preflight = client.options(URL, headers={**origine, "Access-Control-Request-Method": "POST",
                                             "Access-Control-Request-Headers": "X-Taches-Jeton"})

    assert reponse.status_code == 200
    assert "Access-Control-Allow-Origin" not in reponse.headers
    assert "Access-Control-Allow-Origin" not in preflight.headers
    assert "Access-Control-Allow-Headers" not in preflight.headers
    # Témoin : les autres routes gardent leur CORS.
    assert client.get("/health", headers=origine).headers["Access-Control-Allow-Origin"] == (
        "http://localhost:5173")


# ─── Exécution ───────────────────────────────────────────────

def test_bon_jeton_lance_toutes_les_etapes_dans_l_ordre(client, jeton, supabase, travail,
                                                       locataire):
    reponse = client.post(URL, headers=jeton)

    assert reponse.status_code == 200
    corps = reponse.get_json()
    assert corps["ok"] is True
    assert [e["etape"] for e in corps["etapes"]] == [
        "reprise_suppressions", "purge_pieces", "expiration_revenus",
        "expiration_annonces", "rappels_visites"]
    etapes = _etapes(reponse)
    assert all(e["ok"] and e["complete"] and e["erreur"] is None for e in etapes.values())
    assert etapes["reprise_suppressions"]["compteurs"] == {"supprimes": 1, "en_echec": 0,
                                                           "en_file": 0}
    assert etapes["purge_pieces"]["compteurs"] == {"fichiers": 1}
    assert etapes["expiration_revenus"]["compteurs"] == {"expires": 0, "relances": 0}
    assert etapes["expiration_annonces"]["compteurs"] == {"relances": 0, "retraits": 0}
    assert etapes["rappels_visites"]["compteurs"] == {"rappels": 2}

    assert sorted(a["url"] for a in supabase.suppressions) == [
        f"{OBJETS}tcheyna-documents/documents/ancien.png",
        f"{OBJETS}tcheyna-documents/documents/recto.png"]
    assert FichierASupprimer.query.count() == 0
    assert Notification.query.filter_by(type=notify.TYPE_RAPPEL_VISITE,
                                        user_id=locataire.id).count() == 1


def test_rejouer_l_appel_ne_refait_rien(client, jeton, supabase, travail):
    client.post(URL, headers=jeton)
    reponse = client.post(URL, headers=jeton)

    assert reponse.status_code == 200
    etapes = _etapes(reponse)
    assert etapes["purge_pieces"]["compteurs"] == {"fichiers": 0}
    assert etapes["rappels_visites"]["compteurs"] == {"rappels": 0}
    assert len(supabase.suppressions) == 2


def test_une_etape_en_echec_n_arrete_pas_les_suivantes(client, jeton, supabase, travail,
                                                      monkeypatch, caplog):
    def panne(**_kwargs):
        raise RuntimeError("détail interne : +224621000901")

    monkeypatch.setattr(dp, "purger_pieces_sans_decision", panne)

    with caplog.at_level(logging.DEBUG):
        reponse = client.post(URL, headers=jeton)

    assert reponse.status_code == 500
    corps = reponse.get_json()
    assert corps["ok"] is False
    etapes = _etapes(reponse)
    assert etapes["purge_pieces"]["ok"] is False
    assert etapes["purge_pieces"]["compteurs"] == {}
    # Le type seul : la réponse est conservée chez cron-job.org.
    assert etapes["purge_pieces"]["erreur"] == (
        "Erreur inattendue (RuntimeError) : voir les journaux de l'API")
    assert "+224" not in reponse.get_data(as_text=True)
    # Les étapes d'avant et d'après ont tourné.
    assert etapes["reprise_suppressions"]["ok"] is True
    assert etapes["rappels_visites"]["ok"] is True
    assert etapes["rappels_visites"]["compteurs"] == {"rappels": 2}
    # Le détail est dans les journaux de l'API.
    assert "Tâche nocturne « purge_pieces » en échec" in caplog.text
    assert "+224621000901" in caplog.text


def test_suppressions_encore_en_echec_comptent_comme_un_echec(client, jeton, supabase, reseau,
                                                             travail):
    reseau.repondre("DELETE", OBJETS, exception=requests.ConnectionError("injoignable"))

    reponse = client.post(URL, headers=jeton)

    # Comme `flask donnees retenter-suppressions`, qui sort alors en erreur.
    assert reponse.status_code == 500
    etapes = _etapes(reponse)
    assert etapes["reprise_suppressions"]["compteurs"] == {"supprimes": 0, "en_echec": 1,
                                                           "en_file": 1}
    assert etapes["reprise_suppressions"]["erreur"] == "1 suppression(s) encore en échec"
    # La purge a tourné : la pièce n'est plus désignée, son fichier attend en file.
    assert etapes["purge_pieces"]["ok"] is True
    assert etapes["purge_pieces"]["compteurs"] == {"fichiers": 1}
    assert FichierASupprimer.query.count() == 2


def test_purge_non_configuree_message_lisible(client, app, jeton, supabase, travail):
    app.config["DUREE_CONSERVATION_PIECES_JOURS"] = None

    reponse = client.post(URL, headers=jeton)

    assert reponse.status_code == 500
    erreur = _etapes(reponse)["purge_pieces"]["erreur"]
    assert "DUREE_CONSERVATION_PIECES_JOURS" in erreur and "D5" in erreur


def test_le_jeton_n_est_jamais_journalise(client, jeton, supabase, travail, monkeypatch, caplog):
    def panne(**_kwargs):
        raise RuntimeError("panne")

    monkeypatch.setattr(dp, "appliquer_validite_revenus", panne)

    with caplog.at_level(logging.DEBUG):
        reponse = client.post(URL, headers=jeton)
        client.post(URL, headers={"X-Taches-Jeton": JETON + "faux"})

    assert reponse.status_code == 500
    assert JETON not in caplog.text
    assert JETON not in reponse.get_data(as_text=True)


# ─── Durée bornée ────────────────────────────────────────────

def test_budget_epuise_le_reste_attend_l_appel_suivant(client, jeton, supabase, travail,
                                                     monkeypatch):
    monkeypatch.setattr(taches_nocturnes, "BUDGET_ETAPE_SECONDES", 0)

    reponse = client.post(URL, headers=jeton)

    # Pas une erreur : rien n'est perdu, l'appel suivant reprend.
    assert reponse.status_code == 200
    etapes = _etapes(reponse)
    # Une étape sans rien à faire n'entame pas son budget : elle est complète.
    assert {nom for nom, e in etapes.items() if not e["complete"]} == {
        "reprise_suppressions", "purge_pieces", "rappels_visites"}
    assert etapes["purge_pieces"]["compteurs"] == {"fichiers": 0}
    assert etapes["rappels_visites"]["compteurs"] == {"rappels": 0}
    assert supabase.suppressions == []
    assert FichierASupprimer.query.count() == 1

    monkeypatch.setattr(taches_nocturnes, "BUDGET_ETAPE_SECONDES", 5)
    reponse = client.post(URL, headers=jeton)

    etapes = _etapes(reponse)
    assert all(e["complete"] for e in etapes.values())
    assert etapes["purge_pieces"]["compteurs"] == {"fichiers": 1}
    assert etapes["rappels_visites"]["compteurs"] == {"rappels": 2}
    assert FichierASupprimer.query.count() == 0


def test_budget_epuise_pendant_les_suppressions_les_garde_en_file(app, fabrique, supabase):
    for nom in ("a", "b", "c"):
        db.session.add(FichierASupprimer(reference=f"supabase://documents/{nom}.png",
                                               origine="decision_identite"))
    db.session.commit()

    class DeuxTentatives:
        """Budget qui laisse passer deux fichiers."""
        delai_reseau = taches_nocturnes.DELAI_RESEAU

        def __init__(self):
            self.restants = 2
            self.epuise = False

        def reste(self):
            self.restants -= 1
            self.epuise = self.restants < 0
            return not self.epuise

    traitees, echecs = dp.retenter_suppressions(budget=DeuxTentatives())

    assert (traitees, echecs) == (3, 0)
    assert len(supabase.suppressions) == 2
    # Le troisième n'a pas été tenté : ni supprimé, ni compté en échec.
    restant = FichierASupprimer.query.one()
    assert restant.reference == "supabase://documents/c.png"
    assert not restant.tentatives


def test_les_commandes_flask_restent_disponibles(app, supabase, travail):
    runner = app.test_cli_runner()
    for commande in (["donnees", "retenter-suppressions"], ["donnees", "purger-pieces"],
                     ["donnees", "expirer-revenus"], ["annonces", "expirer"],
                     ["visites", "rappeler"]):
        resultat = runner.invoke(args=commande)
        assert resultat.exit_code == 0, (commande, resultat.output)
    assert FichierASupprimer.query.count() == 0


def test_budget_epuise_revenus_et_annonces_attendent_aussi(client, fabrique, jeton, monkeypatch):
    # Un justificatif de revenus échu et une annonce sans activité depuis 40 jours.
    echu = fabrique.locataire(niveau=2, income_verified=True, passeport=False)
    fabrique.passeport(echu, revenus_deposes_le=datetime.utcnow() - timedelta(days=200))
    ancienne = fabrique.annonce()
    ancienne.created_at = ancienne.updated_at = datetime.utcnow() - timedelta(days=40)
    db.session.commit()
    monkeypatch.setattr(taches_nocturnes, "BUDGET_ETAPE_SECONDES", 0)

    etapes = _etapes(client.post(URL, headers=jeton))

    assert etapes["expiration_revenus"]["complete"] is False
    assert etapes["expiration_revenus"]["compteurs"] == {"expires": 0, "relances": 0}
    assert etapes["expiration_annonces"]["complete"] is False
    assert etapes["expiration_annonces"]["compteurs"] == {"relances": 0, "retraits": 0}

    monkeypatch.setattr(taches_nocturnes, "BUDGET_ETAPE_SECONDES", 5)
    etapes = _etapes(client.post(URL, headers=jeton))

    assert etapes["expiration_revenus"]["compteurs"] == {"expires": 0, "relances": 1}
    assert etapes["expiration_annonces"]["compteurs"] == {"relances": 1, "retraits": 0}


def test_suppressions_nocturnes_a_delai_reseau_court(client, jeton, supabase, travail, monkeypatch):
    from app.services import stockage

    delais = []
    supprimer = stockage.supprimer

    def espion(url, delai=30):
        delais.append(delai)
        return supprimer(url, delai=delai)

    monkeypatch.setattr(stockage, "supprimer", espion)

    client.post(URL, headers=jeton)

    # Un Supabase lent ne tient pas l'appel au-delà des 60 s de gunicorn.
    assert delais == [taches_nocturnes.DELAI_RESEAU] * 2


def test_commande_flask_garde_le_delai_reseau_ordinaire(app, supabase, travail, monkeypatch):
    from app.services import stockage

    delais = []
    monkeypatch.setattr(stockage, "supprimer", lambda url, delai=30: delais.append(delai) or True)

    app.test_cli_runner().invoke(args=["donnees", "retenter-suppressions"])

    assert delais == [30]
