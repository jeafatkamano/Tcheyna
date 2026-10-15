"""Blueprint users : profil public, édition, photo de profil."""
from tests.conftest import SUPABASE_URL_TEST


def test_profil_public_sans_donnees_privees(client, bailleur, annonce):
    reponse = client.get(f"/api/users/{bailleur.id}")

    assert reponse.status_code == 200
    corps = reponse.get_json()
    assert "email" not in corps and "phone" not in corps
    assert corps["nb_annonces"] == 1


def test_profil_d_un_compte_desactive_introuvable(client, fabrique):
    user = fabrique.bailleur(is_active=False)
    assert client.get(f"/api/users/{user.id}").status_code == 404


def test_modifier_son_profil_exige_un_jeton(client):
    assert client.put("/api/users/me", json={"full_name": "X"}).status_code == 401


def test_modifier_son_profil_ignore_avatar_url(client, locataire, entetes):
    reponse = client.put("/api/users/me", headers=entetes(locataire),
                         json={"full_name": "  Mariama Diallo ",
                               "avatar_url": "https://evil.example/x.gif"})

    assert reponse.status_code == 200
    user = reponse.get_json()["user"]
    assert user["full_name"] == "Mariama Diallo"
    assert user["avatar_url"] is None


def test_avatar_televerse_dans_le_compartiment_public(client, locataire, entetes,
                                                     supabase, fichier_image):
    reponse = client.post("/api/users/me/avatar", headers=entetes(locataire),
                          data={"file": fichier_image("moi.png")},
                          content_type="multipart/form-data")

    assert reponse.status_code == 200
    assert reponse.get_json()["avatar_url"].startswith(
        f"{SUPABASE_URL_TEST}/storage/v1/object/public/tcheyna-photos/avatars/")
    assert len(supabase.televersements) == 1


def test_avatar_refuse_un_format_non_image(client, locataire, entetes, fichier_image):
    reponse = client.post("/api/users/me/avatar", headers=entetes(locataire),
                          data={"file": fichier_image("cv.pdf")},
                          content_type="multipart/form-data")
    assert reponse.status_code == 400


def test_desactiver_son_compte_retire_ses_annonces(client, bailleur, annonce, entetes):
    reponse = client.delete("/api/users/me", headers=entetes(bailleur))

    assert reponse.status_code == 200
    assert annonce.is_visible is False and annonce.status == "closed"
    # Le jeton encore valide ne donne plus accès à rien.
    assert client.get("/api/auth/me", headers=entetes(bailleur)).status_code == 403
