"""En-têtes CORS figés (lot 1.13).

Le front (tcheyna.onrender.com) et l'application Android (Capacitor, origine
https://localhost) appellent l'API depuis une autre origine : un en-tête CORS
qui change, et le navigateur bloque les réponses sans que l'API ne voie
d'erreur. Ces tests figent ce que pose `CORS(...)` dans `create_app`, pour
qu'une mise à jour de flask-cors, de Flask ou de Werkzeug qui modifierait
la réponse casse ici plutôt qu'en production.

Les origines autorisées sont celles de `render.yaml` (CORS_ORIGINS), posées
explicitement : `config.py` lit le fichier .env, qui ne doit pas changer le
résultat d'un poste à l'autre.
"""
from pathlib import Path

import pytest

from config import TestingConfig

ORIGINE_WEB = "https://tcheyna.onrender.com"
ORIGINE_ANDROID = "https://localhost"
ORIGINES_AUTORISEES = [ORIGINE_WEB, ORIGINE_ANDROID]

# Origines voisines d'une origine autorisée : aucune ne doit passer.
ORIGINES_REFUSEES = [
    "https://pirate.example",
    "https://tcheyna.onrender.com.pirate.example",
    "http://tcheyna.onrender.com",
    "https://localhost:5173",
]

# Toutes les méthodes du préflight : flask-cors annonce la liste par défaut,
# indépendamment des méthodes réellement routées.
METHODES = "DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT"

# Routes représentatives : publique, protégée (avec et sans jeton), hors /api
# (santé, fichiers téléversés de développement), et inconnue. Le chemin en
# majuscules vérifie que la règle CORS couvre tout chemin, quelle que soit
# sa casse (flask-cors 6 compare les chemins en respectant la casse).
ROUTES_SIMPLES = [
    ("/api/listings/", False, 200),
    ("/api/auth/me", True, 200),
    ("/api/auth/me", False, 401),
    ("/health", False, 200),
    ("/uploads/annonce-cors.webp", False, 200),
    ("/api/nexiste-pas", False, 404),
    ("/API/LISTINGS/", False, 404),
]

ROUTES_PREFLIGHT = [
    ("/api/listings/", "POST"),
    ("/api/auth/login", "POST"),
    ("/api/auth/me", "GET"),
    ("/api/users/me", "PUT"),
    ("/health", "GET"),
    ("/uploads/annonce-cors.webp", "GET"),
]


@pytest.fixture(autouse=True)
def origines_cors(monkeypatch):
    # Posé avant la fixture `app` (les fixtures autouse passent en premier) :
    # `create_app` lit CORS_ORIGINS au démarrage.
    monkeypatch.setattr(TestingConfig, "CORS_ORIGINS", list(ORIGINES_AUTORISEES))


@pytest.fixture
def photo_publique(app):
    """Photo d'annonce servie par /uploads (route de développement et de test)."""
    dossier = Path(app.config["UPLOAD_FOLDER"])
    dossier.mkdir(parents=True, exist_ok=True)
    (dossier / "annonce-cors.webp").write_bytes(b"photo")


def entetes_cors(reponse):
    """En-têtes `Access-Control-*` et `Vary` de la réponse, noms en minuscules.

    Un en-tête répété (deux `Access-Control-Allow-Origin`, que le navigateur
    rejette) fait échouer le test. Ferme la réponse : /uploads renvoie un
    fichier ouvert, que le test ne lit pas.
    """
    trouves = [
        (nom.lower(), valeur)
        for nom, valeur in reponse.headers.items()
        if nom.lower().startswith("access-control-") or nom.lower() == "vary"
    ]
    reponse.close()
    noms = [nom for nom, _ in trouves]
    assert len(noms) == len(set(noms)), f"en-tête CORS répété : {trouves}"
    return dict(trouves)


# ─── Requête simple ──────────────────────────────────────────

@pytest.mark.parametrize("origine", ORIGINES_AUTORISEES)
@pytest.mark.parametrize(("chemin", "authentifie", "statut"), ROUTES_SIMPLES)
def test_requete_simple_origine_autorisee(client, photo_publique, locataire, entetes, origine,
                                          chemin, authentifie, statut):
    en_tetes = {"Origin": origine}
    if authentifie:
        en_tetes.update(entetes(locataire))

    reponse = client.get(chemin, headers=en_tetes)

    assert reponse.status_code == statut
    # Ni Expose-Headers ni Max-Age : le front ne lit aucun en-tête de réponse
    # (le délai d'un 429 est dans le corps, `reessayer_dans`).
    assert entetes_cors(reponse) == {
        "access-control-allow-origin": origine,
        "access-control-allow-credentials": "true",
        "vary": "Origin",
    }


@pytest.mark.parametrize("origine", ORIGINES_REFUSEES)
@pytest.mark.parametrize(("chemin", "authentifie", "statut"), ROUTES_SIMPLES)
def test_requete_simple_origine_refusee(client, photo_publique, locataire, entetes, origine,
                                        chemin, authentifie, statut):
    en_tetes = {"Origin": origine}
    if authentifie:
        en_tetes.update(entetes(locataire))

    reponse = client.get(chemin, headers=en_tetes)

    # La route répond normalement, mais sans aucun en-tête CORS : c'est le
    # navigateur qui bloque la lecture de la réponse.
    assert reponse.status_code == statut
    assert entetes_cors(reponse) == {}


def test_requete_sans_origine(client):
    # Appel serveur à serveur (health check Render, UptimeRobot) : pas
    # d'Origin. flask-cors (`always_send`, actif par défaut) pose alors la
    # première origine configurée dans l'ordre alphabétique. Sans effet
    # pratique : un navigateur envoie toujours Origin en cross-origin.
    reponse = client.get("/health")

    assert reponse.status_code == 200
    assert entetes_cors(reponse) == {
        "access-control-allow-origin": sorted(ORIGINES_AUTORISEES)[0],
        "access-control-allow-credentials": "true",
        "vary": "Origin",
    }


def test_origine_comparee_sans_tenir_compte_de_la_casse(client):
    # Schéma et hôte sont insensibles à la casse : l'origine reçue est
    # renvoyée telle quelle.
    reponse = client.get("/health", headers={"Origin": "HTTPS://TCHEYNA.ONRENDER.COM"})

    assert entetes_cors(reponse) == {
        "access-control-allow-origin": "HTTPS://TCHEYNA.ONRENDER.COM",
        "access-control-allow-credentials": "true",
        "vary": "Origin",
    }


# ─── Préflight OPTIONS ───────────────────────────────────────

def preflight(client, chemin, origine, methode, en_tetes_demandes):
    return client.options(chemin, headers={
        "Origin": origine,
        "Access-Control-Request-Method": methode,
        "Access-Control-Request-Headers": en_tetes_demandes,
    })


@pytest.mark.parametrize("origine", ORIGINES_AUTORISEES)
@pytest.mark.parametrize(("chemin", "methode"), ROUTES_PREFLIGHT)
def test_preflight_origine_autorisee(client, origine, chemin, methode):
    # Une route protégée répond au préflight sans jeton : le navigateur
    # n'envoie jamais `Authorization` sur un OPTIONS.
    reponse = preflight(client, chemin, origine, methode, "Content-Type, Authorization")

    assert reponse.status_code == 200
    assert entetes_cors(reponse) == {
        "access-control-allow-origin": origine,
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": METHODES,
        "access-control-allow-headers": "Authorization, Content-Type",
        "vary": "Origin",
    }


def test_preflight_ne_renvoie_que_les_entetes_autorises(client):
    # `allow_headers` filtre la demande : un en-tête hors liste n'est pas
    # accordé, et le navigateur annule alors la requête réelle.
    reponse = preflight(client, "/api/listings/", ORIGINE_WEB, "POST",
                        "Content-Type, X-Autre-Entete")

    assert reponse.status_code == 200
    assert reponse.headers["Access-Control-Allow-Headers"] == "Content-Type"


@pytest.mark.parametrize("origine", ORIGINES_REFUSEES)
@pytest.mark.parametrize(("chemin", "methode"), ROUTES_PREFLIGHT)
def test_preflight_origine_refusee(client, origine, chemin, methode):
    reponse = preflight(client, chemin, origine, methode, "Content-Type, Authorization")

    assert reponse.status_code == 200
    assert entetes_cors(reponse) == {}
