"""Santé de l'API et gestion d'erreurs globale."""
import pytest
import requests

from tests.conftest import ReseauBloque


def test_health_repond_ok(client):
    reponse = client.get("/health")
    assert reponse.status_code == 200
    assert reponse.get_json()["status"] == "ok"


def test_route_inconnue_renvoie_du_json(client):
    reponse = client.get("/api/nexiste-pas")
    assert reponse.status_code == 404
    assert reponse.get_json() == {"error": "Ressource introuvable"}


def test_jeton_absent_refuse_en_json(client):
    reponse = client.get("/api/auth/me")
    assert reponse.status_code == 401
    assert reponse.get_json()["error"] == "Authentification requise"


def test_jeton_invalide_refuse(client):
    reponse = client.get("/api/auth/me", headers={"Authorization": "Bearer pas-un-jwt"})
    assert reponse.status_code == 401


def test_garde_fou_reseau_bloque_requests():
    with pytest.raises(ReseauBloque):
        requests.get("https://exemple.test", timeout=1)


def test_garde_fou_reseau_bloque_les_sockets():
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock, pytest.raises(ReseauBloque):
        sock.connect(("192.0.2.1", 80))


def test_garde_fou_reseau_bloque_dns_et_connect_ex():
    import socket

    with pytest.raises(ReseauBloque):
        socket.getaddrinfo("exemple.test", 443)
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock, pytest.raises(ReseauBloque):
        sock.connect_ex(("192.0.2.1", 80))


def test_ecriture_non_validee_par_une_route_n_est_pas_vue_par_le_test(app, client, locataire):
    # Une route qui oublie son commit ne doit pas passer pour correcte : la
    # session partagée avec le test est annulée en fin de requête.
    from app.models import User

    @app.route("/_test/sans-commit")
    def sans_commit():
        User.query.get(locataire.id).full_name = "jamais validé"
        return "ok"

    client.get("/_test/sans-commit")

    assert locataire.full_name != "jamais validé"
