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
