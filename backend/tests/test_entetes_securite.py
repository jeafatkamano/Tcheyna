"""En-têtes de sécurité des réponses de l'API (lot 1.17).

`create_app` pose `ENTETES_SECURITE` sur toutes les réponses : routes,
gestionnaires d'erreur (404, 405, 422, 429, 500), redirection, préflight
CORS, /health et /uploads. Un en-tête posé par une route est conservé, et
les en-têtes CORS ne changent pas (ils sont figés en détail par
test_cors.py, lot 1.13).
"""
from pathlib import Path

import pytest

from app.routes import auth

ATTENDUS = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=31536000",
}

ORIGINE = "https://tcheyna.onrender.com"


@pytest.fixture(autouse=True)
def origine_autorisee(monkeypatch):
    # Posé avant la fixture `app` : `create_app` lit CORS_ORIGINS au démarrage.
    from config import TestingConfig

    monkeypatch.setattr(TestingConfig, "CORS_ORIGINS", [ORIGINE])


def verifier_entetes(reponse):
    """Chaque en-tête attendu, une seule fois, avec sa valeur. Ferme la
    réponse : /uploads renvoie un fichier ouvert, que le test ne lit pas."""
    for nom, valeur in ATTENDUS.items():
        assert reponse.headers.getlist(nom) == [valeur], nom
    reponse.close()


# ─── Toutes les réponses ─────────────────────────────────────

def test_route_publique(client):
    reponse = client.get("/api/listings/")
    assert reponse.status_code == 200
    verifier_entetes(reponse)


def test_route_protegee_avec_jeton(client, locataire, entetes):
    reponse = client.get("/api/auth/me", headers=entetes(locataire))
    assert reponse.status_code == 200
    verifier_entetes(reponse)


def test_route_protegee_sans_jeton(client):
    reponse = client.get("/api/auth/me")
    assert reponse.status_code == 401
    verifier_entetes(reponse)


def test_route_inconnue(client):
    reponse = client.get("/api/nexiste-pas")
    assert reponse.status_code == 404
    verifier_entetes(reponse)


def test_methode_non_autorisee(client):
    reponse = client.delete("/health")
    assert reponse.status_code == 405
    verifier_entetes(reponse)


def test_redirection_vers_la_barre_finale(client):
    # Werkzeug redirige /api/listings vers /api/listings/ : la redirection
    # est une réponse comme une autre.
    reponse = client.get("/api/listings")
    assert reponse.status_code == 308
    verifier_entetes(reponse)


def test_erreur_de_validation(client):
    reponse = client.post("/api/auth/login", json={})
    assert reponse.status_code == 422
    verifier_entetes(reponse)


def test_limite_de_debit_atteinte(client, locataire, monkeypatch):
    # La limite se juge au nombre d'échecs : inutile de payer scrypt.
    monkeypatch.setattr(auth, "check_password_hash", lambda *_: False)
    corps = {"email": locataire.email, "password": "mauvais"}
    for _ in range(10):
        assert client.post("/api/auth/login", json=corps).status_code == 401

    reponse = client.post("/api/auth/login", json=corps)

    assert reponse.status_code == 429
    verifier_entetes(reponse)


def test_erreur_serveur(app, client):
    # En test, Flask propage l'exception au lieu d'appeler le gestionnaire
    # 500 : on rétablit le comportement de production.
    app.config["PROPAGATE_EXCEPTIONS"] = False

    @app.route("/_test/plantage")
    def plantage():
        raise RuntimeError("panne simulée")

    reponse = client.get("/_test/plantage")

    assert reponse.status_code == 500
    assert reponse.get_json()["error"] == "Erreur interne du serveur"
    verifier_entetes(reponse)


def test_preflight_cors(client):
    reponse = client.options("/api/auth/me", headers={
        "Origin": ORIGINE,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Authorization",
    })
    assert reponse.status_code == 200
    verifier_entetes(reponse)


def test_sante(client):
    reponse = client.get("/health")
    assert reponse.status_code == 200
    verifier_entetes(reponse)


def test_fichier_uploads(app, client):
    dossier = Path(app.config["UPLOAD_FOLDER"])
    dossier.mkdir(parents=True, exist_ok=True)
    (dossier / "annonce-entetes.jpg").write_bytes(b"photo")

    reponse = client.get("/uploads/annonce-entetes.jpg")

    assert reponse.status_code == 200
    # nosniff impose un Content-Type exact : celui d'une image, pas du texte.
    assert reponse.mimetype == "image/jpeg"
    verifier_entetes(reponse)


# ─── Ce qui ne change pas ────────────────────────────────────

def test_entete_pose_par_une_route_conserve(app, client):
    @app.route("/_test/cadre-autorise")
    def cadre_autorise():
        return "ok", 200, {
            "Content-Security-Policy": "frame-ancestors 'self'",
            "Referrer-Policy": "same-origin",
        }

    reponse = client.get("/_test/cadre-autorise")

    assert reponse.headers.getlist("Content-Security-Policy") == ["frame-ancestors 'self'"]
    assert reponse.headers.getlist("Referrer-Policy") == ["same-origin"]
    # Les autres sont posés normalement.
    assert reponse.headers["X-Content-Type-Options"] == "nosniff"
    assert reponse.headers["X-Frame-Options"] == "DENY"
    assert reponse.headers["Strict-Transport-Security"] == "max-age=31536000"


def _entetes_cors_et_cache(client):
    """En-têtes `Access-Control-*`, `Vary` et `Cache-Control` d'une requête
    simple et d'un préflight, noms en minuscules, dans l'ordre reçu."""
    simple = client.get("/health", headers={"Origin": ORIGINE})
    preflight = client.options("/api/listings/", headers={
        "Origin": ORIGINE,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type, Authorization",
    })
    return [
        [(nom.lower(), valeur) for nom, valeur in reponse.headers.items()
         if nom.lower().startswith("access-control-")
         or nom.lower() in ("vary", "cache-control")]
        for reponse in (simple, preflight)
    ]


def test_entetes_cors_et_cache_inchanges(client, monkeypatch):
    # Mêmes en-têtes CORS, et aucun Cache-Control ajouté, avec et sans les
    # en-têtes de sécurité : ceux-ci s'ajoutent sans rien modifier. Le détail
    # des en-têtes CORS est figé par test_cors.py.
    avec = _entetes_cors_et_cache(client)
    monkeypatch.setattr("app.ENTETES_SECURITE", {})
    sans = _entetes_cors_et_cache(client)

    assert avec == sans
    for entetes_reponse in avec:
        assert ("access-control-allow-origin", ORIGINE) in entetes_reponse
