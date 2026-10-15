"""Blueprint listings : recherche, publication, photos et documents."""
import os

from app.models import Listing
from tests.conftest import SUPABASE_URL_TEST

NOUVELLE_ANNONCE = {
    "title_fr": "Studio meublé à Kaloum",
    "description_fr": "Proche du port, gardien jour et nuit.",
    "pays": "Guinée", "ville": "Conakry", "quartier": "Kaloum Centre",
    "type_bien": "studio", "prix": 1_500_000, "devise": "GNF",
}


def test_recherche_publique_ne_montre_que_les_annonces_actives(client, fabrique, bailleur):
    visible = fabrique.annonce(bailleur)
    fabrique.annonce(bailleur, status="closed", is_visible=False)

    reponse = client.get("/api/listings/")

    assert reponse.status_code == 200
    assert [a["id"] for a in reponse.get_json()["listings"]] == [visible.id]


def test_recherche_locataire_connecte_donne_un_score(client, annonce, locataire, entetes):
    reponse = client.get("/api/listings/", headers=entetes(locataire))
    assert "score_compatibilite" in reponse.get_json()["listings"][0]


def test_detail_annonce_et_compteur_de_vues(client, annonce):
    reponse = client.get(f"/api/listings/{annonce.id}")

    assert reponse.status_code == 200
    assert reponse.get_json()["id"] == annonce.id
    assert annonce.views_count == 1


def test_publication_par_un_bailleur(client, bailleur, entetes):
    reponse = client.post("/api/listings/", headers=entetes(bailleur), json=NOUVELLE_ANNONCE)

    assert reponse.status_code == 201
    assert Listing.query.filter_by(landlord_id=bailleur.id).count() == 1


def test_publication_refusee_a_un_locataire(client, locataire, entetes):
    reponse = client.post("/api/listings/", headers=entetes(locataire), json=NOUVELLE_ANNONCE)

    assert reponse.status_code == 403
    assert Listing.query.count() == 0


def test_modification_refusee_a_un_autre_bailleur(client, fabrique, annonce, entetes):
    intrus = fabrique.bailleur()
    reponse = client.put(f"/api/listings/{annonce.id}", headers=entetes(intrus),
                         json={"prix": 1})

    assert reponse.status_code == 403
    assert annonce.prix == 2_000_000


def test_retrait_logique_par_le_proprietaire(client, annonce, bailleur, entetes):
    reponse = client.delete(f"/api/listings/{annonce.id}", headers=entetes(bailleur))

    assert reponse.status_code == 200
    assert annonce.status == "closed" and annonce.is_visible is False


def test_photos_sur_disque_local_hors_supabase(app, client, annonce, bailleur, entetes,
                                               fichier_image):
    reponse = client.post(f"/api/listings/{annonce.id}/photos", headers=entetes(bailleur),
                          data={"files": [fichier_image("a.png"), fichier_image("b.jpg")]},
                          content_type="multipart/form-data")

    assert reponse.status_code == 201
    nouvelles = reponse.get_json()["images"][1:]
    assert len(nouvelles) == 2
    for url in nouvelles:
        assert os.path.exists(os.path.join(app.config["UPLOAD_FOLDER"], os.path.basename(url)))


def test_photos_vers_supabase_quand_configure(client, annonce, bailleur, entetes,
                                              supabase, fichier_image):
    reponse = client.post(f"/api/listings/{annonce.id}/photos", headers=entetes(bailleur),
                          data={"files": [fichier_image("a.png")]},
                          content_type="multipart/form-data")

    assert reponse.status_code == 201
    assert reponse.get_json()["images"][-1].startswith(
        f"{SUPABASE_URL_TEST}/storage/v1/object/public/tcheyna-photos/photos/")


def test_documents_prives_vers_le_compartiment_prive(client, annonce, bailleur, entetes,
                                                     supabase, fichier_image):
    reponse = client.post(f"/api/listings/{annonce.id}/documents", headers=entetes(bailleur),
                          data={"files": [fichier_image("titre-foncier.png")]},
                          content_type="multipart/form-data")

    assert reponse.status_code == 201
    assert annonce.documents[0].startswith("supabase://documents/")
    assert "/tcheyna-documents/" in supabase.televersements[0]["url"]


def test_documents_illisibles_par_un_tiers(client, fabrique, bailleur, entetes):
    annonce = fabrique.annonce(bailleur, documents_urls="supabase://documents/titre.pdf")
    tiers = fabrique.locataire()

    reponse = client.get(f"/api/listings/{annonce.id}/documents", headers=entetes(tiers))

    assert reponse.status_code == 403


def test_certification_exige_un_document(client, annonce, bailleur, entetes):
    reponse = client.post(f"/api/listings/{annonce.id}/certification", headers=entetes(bailleur))
    assert reponse.status_code == 400
    assert annonce.certification_status == "none"


def test_recommandations_reservees_aux_locataires(client, annonce, locataire, bailleur, entetes):
    assert client.get("/api/listings/recommandations",
                      headers=entetes(locataire)).status_code == 200
    assert client.get("/api/listings/recommandations",
                      headers=entetes(bailleur)).status_code == 403


def test_mes_annonces_du_bailleur(client, annonce, bailleur, entetes):
    reponse = client.get("/api/listings/mes-annonces", headers=entetes(bailleur))
    assert reponse.status_code == 200
    assert reponse.get_json()["total"] == 1
