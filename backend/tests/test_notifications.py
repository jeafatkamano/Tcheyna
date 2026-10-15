"""Blueprint notifications : alertes in-app."""
from app.services import notifications as notify


def test_liste_et_lecture_de_ses_notifications(client, locataire, entetes):
    notif = notify.notifier(locataire.id, "niveau_confiance", "Bienvenue", commit=True)

    liste = client.get("/api/notifications/", headers=entetes(locataire)).get_json()
    assert liste["non_lues"] == 1

    assert client.put(f"/api/notifications/{notif.id}/lue",
                      headers=entetes(locataire)).status_code == 200
    assert client.get("/api/notifications/non-lues",
                      headers=entetes(locataire)).get_json()["non_lues"] == 0


def test_notification_d_un_autre_intouchable(client, fabrique, locataire, entetes):
    autre = fabrique.locataire()
    notif = notify.notifier(autre.id, "niveau_confiance", "Privé", commit=True)

    assert client.put(f"/api/notifications/{notif.id}/lue",
                      headers=entetes(locataire)).status_code == 403
    assert client.delete(f"/api/notifications/{notif.id}",
                         headers=entetes(locataire)).status_code == 403


def test_tout_lire(client, locataire, entetes):
    for titre in ("A", "B"):
        notify.notifier(locataire.id, "nouveau_message", titre, commit=True)

    assert client.put("/api/notifications/tout-lire", headers=entetes(locataire)).status_code == 200
    assert client.get("/api/notifications/non-lues",
                      headers=entetes(locataire)).get_json()["non_lues"] == 0
