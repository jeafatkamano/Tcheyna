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


def test_modifier_son_profil(client, locataire, entetes):
    reponse = client.put("/api/users/me", headers=entetes(locataire),
                         json={"full_name": "  Mariama Diallo "})

    assert reponse.status_code == 200
    assert reponse.get_json()["user"]["full_name"] == "Mariama Diallo"


def test_modifier_son_profil_refuse_avatar_url(client, locataire, entetes):
    # La photo se change par téléversement, jamais en soumettant une URL :
    # le champ est refusé explicitement, et rien n'est modifié.
    reponse = client.put("/api/users/me", headers=entetes(locataire),
                         json={"full_name": "Mariama Diallo",
                               "avatar_url": "https://evil.example/x.gif"})

    assert reponse.status_code == 422
    assert reponse.get_json()["details"][0]["champ"] == "avatar_url"
    assert locataire.avatar_url is None
    assert locataire.full_name != "Mariama Diallo"


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
    en_tetes = entetes(bailleur)
    reponse = client.delete("/api/users/me", headers=en_tetes)

    assert reponse.status_code == 200
    assert annonce.is_visible is False and annonce.status == "closed"
    # Le jeton utilisé est révoqué (lot 1.4)…
    assert client.get("/api/auth/me", headers=en_tetes).status_code == 401
    # … et un jeton à la version courante bute sur le compte désactivé.
    assert client.get("/api/auth/me", headers=entetes(bailleur)).status_code == 403
