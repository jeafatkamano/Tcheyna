"""Photos publiques ré-encodées par le serveur (lot 1.7).

Une photo d'annonce ou d'avatar est publique : le fichier reçu ne doit jamais
être servi tel quel (position GPS du logement dans l'EXIF, miniature, XMP…).
"""
import io
import os

from PIL import Image

from app.models import Listing

GPS = 0x8825
ORIENTATION = 0x0112


def jpeg_avec_gps(largeur=40, hauteur=20, orientation=6, couleur=(10, 120, 200)):
    """JPEG de téléphone : GPS (Conakry) et orientation « tourner de 90° »."""
    exif = Image.Exif()
    exif[ORIENTATION] = orientation
    exif[0x010F] = "FabricantTelephone"
    gps = exif.get_ifd(GPS)
    gps.update({1: "N", 2: (9.0, 31.0, 12.5), 3: "W", 4: (13.0, 42.0, 7.25)})
    flux = io.BytesIO()
    Image.new("RGB", (largeur, hauteur), couleur).save(
        flux, "JPEG", exif=exif.tobytes(), icc_profile=b"\0" * 128)
    flux.seek(0)
    return flux


def _envoyer(client, annonce, bailleur, entetes, flux, nom="maison.jpg"):
    return client.post(f"/api/listings/{annonce.id}/photos", headers=entetes(bailleur),
                       data={"file": (flux, nom)}, content_type="multipart/form-data")


def _fichier_stocke(app, url):
    with open(os.path.join(app.config["UPLOAD_FOLDER"], os.path.basename(url)), "rb") as f:
        return f.read()


def test_photo_gps_stockee_sans_aucune_metadonnee(app, client, annonce, bailleur, entetes):
    reponse = _envoyer(client, annonce, bailleur, entetes, jpeg_avec_gps())

    assert reponse.status_code == 201
    url = reponse.get_json()["images"][-1]
    assert url.endswith(".webp")
    octets = _fichier_stocke(app, url)
    assert b"Exif" not in octets and b"FabricantTelephone" not in octets
    with Image.open(io.BytesIO(octets)) as image:
        assert image.format == "WEBP"
        assert len(image.getexif()) == 0
        assert not {"exif", "xmp", "icc_profile"} & set(image.info)
        # Orientation 6 appliquée : 40 × 20 couché devient 20 × 40 debout.
        assert image.size == (20, 40)


def test_photo_reduite_a_1280_px(app, client, annonce, bailleur, entetes):
    flux = io.BytesIO()
    Image.new("RGB", (4000, 3000), (90, 90, 90)).save(flux, "PNG")
    flux.seek(0)

    reponse = _envoyer(client, annonce, bailleur, entetes, flux, "grand.png")

    with Image.open(io.BytesIO(_fichier_stocke(app, reponse.get_json()["images"][-1]))) as image:
        assert image.size == (1280, 960)


def test_contenu_illisible_refuse_en_422(app, client, annonce, bailleur, entetes):
    faux = io.BytesIO(b"<html><script>alert(1)</script></html>")

    reponse = _envoyer(client, annonce, bailleur, entetes, faux, "piege.png")

    assert reponse.status_code == 422
    assert "pas une image lisible" in reponse.get_json()["error"]
    assert not os.path.exists(app.config["UPLOAD_FOLDER"]) or not os.listdir(
        app.config["UPLOAD_FOLDER"])


def test_bombe_de_decompression_refusee_en_422(client, annonce, bailleur, entetes):
    # PNG de 10 000 × 10 000 (100 Mpx) : quelques Ko compressés, 300 Mo décodés.
    flux = io.BytesIO()
    Image.new("1", (10_000, 10_000)).save(flux, "PNG")
    flux.seek(0)

    reponse = _envoyer(client, annonce, bailleur, entetes, flux, "bombe.png")

    assert reponse.status_code == 422
    assert "50 mégapixels" in reponse.get_json()["error"]


def test_png_au_dela_de_16_mpx_refuse_en_422(client, annonce, bailleur, entetes):
    # PNG sans décodage réduit : 5000 × 4000 = 20 Mpx, sous les 50 Mpx du JPEG.
    flux = io.BytesIO()
    Image.new("1", (5_000, 4_000)).save(flux, "PNG")
    flux.seek(0)

    reponse = _envoyer(client, annonce, bailleur, entetes, flux, "grand.png")

    assert reponse.status_code == 422
    assert "16 mégapixels" in reponse.get_json()["error"]


def test_meme_photo_renvoyee_n_est_ajoutee_qu_une_fois(app, client, annonce, bailleur,
                                                         entetes):
    # « Réessayer » après une réponse perdue : le serveur avait déjà la photo.
    avant = len(annonce.images_urls.split(",")) if annonce.images_urls else 0
    contenu = jpeg_avec_gps().getvalue()

    premiere = _envoyer(client, annonce, bailleur, entetes, io.BytesIO(contenu))
    seconde = _envoyer(client, annonce, bailleur, entetes, io.BytesIO(contenu))

    assert premiere.status_code == 201
    assert seconde.status_code == 200
    assert seconde.get_json()["images"] == premiere.get_json()["images"]
    images = Listing.query.get(annonce.id).images_urls.split(",")
    assert len(images) == avant + 1
    assert len(os.listdir(app.config["UPLOAD_FOLDER"])) == 1


def test_doublon_accepte_meme_annonce_pleine(client, fabrique, bailleur, entetes):
    from app.schemas.listings import MAX_IMAGES

    annonce = fabrique.annonce(bailleur, images_urls=",".join(
        f"/uploads/p{i}.png" for i in range(MAX_IMAGES - 1)))
    contenu = jpeg_avec_gps().getvalue()
    assert _envoyer(client, annonce, bailleur, entetes, io.BytesIO(contenu)).status_code == 201

    reponse = _envoyer(client, annonce, bailleur, entetes, io.BytesIO(contenu))

    assert reponse.status_code == 200


def test_avatar_reencode_sans_gps(app, client, fabrique, entetes):
    utilisateur = fabrique.bailleur()

    reponse = client.post("/api/users/me/avatar", headers=entetes(utilisateur),
                          data={"file": (jpeg_avec_gps(), "moi.jpg")},
                          content_type="multipart/form-data")

    assert reponse.status_code in (200, 201), reponse.get_json()
    octets = _fichier_stocke(app, reponse.get_json()["avatar_url"])
    assert b"Exif" not in octets
    with Image.open(io.BytesIO(octets)) as image:
        assert image.format == "WEBP" and image.size == (20, 40)


def test_avatar_illisible_refuse_en_422(client, fabrique, entetes):
    utilisateur = fabrique.bailleur()

    reponse = client.post("/api/users/me/avatar", headers=entetes(utilisateur),
                          data={"file": (io.BytesIO(b"pas une image"), "moi.png")},
                          content_type="multipart/form-data")

    assert reponse.status_code == 422
    assert "pas une image lisible" in reponse.get_json()["error"]


def test_grande_photo_reduite_avant_rotation_garde_l_orientation(app, client, annonce,
                                                                   bailleur, entetes):
    # 4000 × 2000 couché, orientation 6 : décodage réduit (draft), réduction,
    # puis rotation. Résultat attendu debout : 640 × 1280. Un repère rouge en
    # haut à gauche du capteur doit finir en haut à droite.
    image = Image.new("RGB", (4000, 2000), (255, 255, 255))
    image.paste((255, 0, 0), (0, 0, 800, 400))
    exif = Image.Exif()
    exif[ORIENTATION] = 6
    flux = io.BytesIO()
    image.save(flux, "JPEG", exif=exif.tobytes(), quality=90)
    flux.seek(0)

    reponse = _envoyer(client, annonce, bailleur, entetes, flux, "grande.jpg")

    assert reponse.status_code == 201
    with Image.open(io.BytesIO(_fichier_stocke(app, reponse.get_json()["url"]))) as stockee:
        assert stockee.size == (640, 1280)
        rouge = stockee.convert("RGB").getpixel((600, 40))
        blanc = stockee.convert("RGB").getpixel((40, 40))
        assert rouge[0] > 200 and rouge[1] < 60
        assert blanc[1] > 200


def test_reponse_donne_l_url_de_la_photo_meme_en_doublon(client, annonce, bailleur, entetes,
                                                          fichier_image):
    # [A, B] puis A renvoyé : l'URL rendue est celle de A, pas la dernière (B).
    a = _envoyer(client, annonce, bailleur, entetes, *fichier_image("a.png")).get_json()
    b = _envoyer(client, annonce, bailleur, entetes, *fichier_image("b.png")).get_json()
    a_bis = _envoyer(client, annonce, bailleur, entetes, *fichier_image("a.png"))

    assert a_bis.status_code == 200
    assert a_bis.get_json()["url"] == a["url"] != b["url"]
    assert a_bis.get_json()["images"][-1] == b["url"]
