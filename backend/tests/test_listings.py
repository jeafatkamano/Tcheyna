"""Blueprint listings : recherche, publication, photos et documents."""
import os

from app.models import Listing
from tests.conftest import SUPABASE_URL_TEST

NOUVELLE_ANNONCE = {
    "title_fr": "Studio meublé à Kaloum",
    "description_fr": "Proche du port, gardien jour et nuit.",
    "pays": "Guinée", "ville": "Conakry", "quartier": "Kaloum Centre",
    # Pas de `devise` : elle découle du pays, côté serveur.
    "type_bien": "studio", "prix": 1_500_000,
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
    assert Listing.query.filter_by(landlord_id=bailleur.id).one().devise == "GNF"


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


# ─── Photos : envoi une par une, sans perte (lot 1.7) ────────

def _envoyer_photo(client, annonce, bailleur, entetes, fichier):
    return client.post(f"/api/listings/{annonce.id}/photos", headers=entetes(bailleur),
                       data={"file": fichier}, content_type="multipart/form-data")


def test_photo_webp_compressee_par_le_navigateur_acceptee(client, annonce, bailleur, entetes):
    import io

    webp = b"RIFF\x24\x00\x00\x00WEBPVP8 " + b"\x00" * 32
    reponse = _envoyer_photo(client, annonce, bailleur, entetes, (io.BytesIO(webp), "photo-1.webp"))

    assert reponse.status_code == 201
    assert reponse.get_json()["images"][-1].endswith(".webp")


def test_photo_sans_extension_refusee_avec_message(client, annonce, bailleur, entetes,
                                                    fichier_image):
    # Un Blob envoyé sans nom de fichier arrive comme « blob ».
    reponse = _envoyer_photo(client, annonce, bailleur, entetes, fichier_image("blob"))

    assert reponse.status_code == 400
    assert "Format non accepté" in reponse.get_json()["error"]


def test_envois_successifs_s_ajoutent_dans_l_ordre(client, annonce, bailleur, entetes,
                                                    fichier_image):
    avant = annonce.images_urls.split(",") if annonce.images_urls else []
    for nom in ("a.png", "b.png", "c.png"):
        assert _envoyer_photo(client, annonce, bailleur, entetes,
                              fichier_image(nom)).status_code == 201

    apres = Listing.query.get(annonce.id).images_urls.split(",")
    assert apres[:len(avant)] == avant and len(apres) == len(avant) + 3


def _ecriture_concurrente(monkeypatch, annonce_id, url_intruse):
    """Simule une autre requête qui ajoute une photo pendant que celle-ci est
    en cours de stockage (cas de deux envois simultanés)."""
    from app import db
    from app.services import stockage

    vrai_televerser = stockage.televerser

    def televerser_lent(*args, **kwargs):
        url = vrai_televerser(*args, **kwargs)
        actuelle = db.session.execute(
            db.select(Listing.images_urls).filter_by(id=annonce_id)).scalar()
        db.session.execute(
            db.update(Listing).filter_by(id=annonce_id)
            .values(images_urls=",".join(filter(None, [actuelle, url_intruse]))))
        db.session.commit()
        return url

    monkeypatch.setattr(stockage, "televerser", televerser_lent)


def test_ajout_concurrent_ne_perd_aucune_photo(client, annonce, bailleur, entetes,
                                               fichier_image, monkeypatch):
    # Avant le lot 1.7, la liste lue avant le stockage était réécrite telle
    # quelle : la photo ajoutée entre-temps disparaissait.
    _ecriture_concurrente(monkeypatch, annonce.id, "/uploads/autre-onglet.png")

    reponse = _envoyer_photo(client, annonce, bailleur, entetes, fichier_image("a.png"))

    assert reponse.status_code == 201
    images = Listing.query.get(annonce.id).images_urls.split(",")
    assert "/uploads/autre-onglet.png" in images
    assert images[-1].endswith(".png") and images[-1] != "/uploads/autre-onglet.png"


def test_limite_de_photos_reverifiee_apres_stockage(app, client, fabrique, bailleur, entetes,
                                                     fichier_image, monkeypatch):
    from app.schemas.listings import MAX_IMAGES

    pleine_moins_un = ",".join(f"/uploads/p{i}.png" for i in range(MAX_IMAGES - 1))
    annonce = fabrique.annonce(bailleur, images_urls=pleine_moins_un)
    # Une autre requête prend la dernière place pendant le stockage.
    _ecriture_concurrente(monkeypatch, annonce.id, "/uploads/derniere-place.png")

    reponse = _envoyer_photo(client, annonce, bailleur, entetes, fichier_image("a.png"))

    assert reponse.status_code == 400
    images = Listing.query.get(annonce.id).images_urls.split(",")
    assert len(images) == MAX_IMAGES
    # Le fichier stocké pour rien est supprimé.
    assert os.listdir(app.config["UPLOAD_FOLDER"]) == []


def test_reecriture_des_photos_sous_verrou_d_ecriture(client, annonce, bailleur, entetes,
                                                      fichier_image):
    # SQLite ignore FOR UPDATE : on vérifie que la requête le demande bien,
    # PostgreSQL (production, CI migrations) l'appliquera.
    from sqlalchemy import event

    from app import db

    verrous = []

    def observer(etat):
        if etat.is_select and etat.statement._for_update_arg is not None:
            verrous.append(etat.statement)

    event.listen(db.session, "do_orm_execute", observer)
    try:
        _envoyer_photo(client, annonce, bailleur, entetes, fichier_image("a.png"))
    finally:
        event.remove(db.session, "do_orm_execute", observer)

    assert len(verrous) == 1


def test_aucune_transaction_ouverte_pendant_le_stockage(client, annonce, bailleur, entetes,
                                                        fichier_image, monkeypatch):
    from app import db
    from app.services import stockage

    vrai_televerser = stockage.televerser
    pendant = []

    def televerser_observe(*args, **kwargs):
        pendant.append(db.session().in_transaction())
        return vrai_televerser(*args, **kwargs)

    monkeypatch.setattr(stockage, "televerser", televerser_observe)

    reponse = _envoyer_photo(client, annonce, bailleur, entetes, fichier_image("a.png"))

    assert reponse.status_code == 201
    assert pendant == [False]
