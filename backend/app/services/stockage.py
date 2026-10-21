"""
services/stockage.py — Stockage des fichiers téléversés.

Deux implémentations derrière une seule interface :

  • Supabase Storage, dès que SUPABASE_URL et SUPABASE_SERVICE_KEY sont
    renseignés. C'est le mode attendu en production.
  • Disque local sinon, pour le développement.

Ce choix n'est pas cosmétique : l'offre gratuite de Render ne fournit aucun
disque persistant. Un fichier écrit sur le disque de l'instance disparaît au
redémarrage et au réveil après mise en veille — soit, en pratique, sous
quinze minutes. Les photos d'annonces et les pièces d'identité doivent donc
sortir de la machine.
"""
import hashlib
import io
import mimetypes
import os
import uuid
import warnings

import requests
from flask import current_app
from PIL import Image, ImageOps, UnidentifiedImageError
from werkzeug.utils import secure_filename

# Types réellement acceptés, par usage.
IMAGES = {"png", "jpg", "jpeg", "webp"}
DOCUMENTS = IMAGES | {"pdf"}

TAILLE_MAX = {
    "photos": 8 * 1024 * 1024,      # 8 Mo par photo d'annonce
    "avatars": 3 * 1024 * 1024,     # 3 Mo pour une photo de profil
    "documents": 8 * 1024 * 1024,   # 8 Mo pour une pièce justificative
}

# Les pièces d'identité et de propriété ne partagent pas le compartiment des
# photos : un compartiment public sert ses fichiers à qui en connaît l'URL, et
# un nom difficile à deviner n'est pas une protection.
DOSSIERS_PRIVES = {"documents"}

# Images publiques ré-encodées par le serveur, quelle que soit leur source
# (application, script, navigateur sans compression) : voir `preparer_image`.
DOSSIERS_REENCODES = {"photos", "avatars"}
COTE_MAX = 1280
QUALITE_WEBP = 80
# Au-delà, l'image n'est pas décodée : une « bombe de décompression » de
# quelques Ko peut exiger des Go de mémoire. 50 Mpx couvrent tout téléphone.
PIXELS_MAX = 50_000_000
# PNG et WebP n'ont pas de décodage réduit (`draft`) : 16 Mpx en RGBA pèsent
# déjà 64 Mo, ce qui laisse deux envois simultanés sous les 512 Mo.
PIXELS_MAX_SANS_DRAFT = 16_000_000
Image.MAX_IMAGE_PIXELS = PIXELS_MAX
Image.init()  # enregistre tous les formats avant le filtre `formats=`
# Les JPEG multi-images des iPhone (MPO) passent par l'ouvreur JPEG.
FORMATS_LUS = ["JPEG", "PNG", "WEBP"]
TYPES_CONTENU = {"webp": "image/webp", "jpg": "image/jpeg", "jpeg": "image/jpeg",
                 "png": "image/png", "pdf": "application/pdf"}
# Format détecté par Pillow → extension sous laquelle la pièce est stockée.
EXTENSION_DU_FORMAT = {"JPEG": "jpg", "MPO": "jpg", "PNG": "png", "WEBP": "webp"}
# Les lecteurs PDF (Acrobat le premier) cherchent l'en-tête `%PDF-` dans le
# premier Kio, pas seulement à l'octet 0 : voir `type_reel`.
SIGNATURE_PDF = b"%PDF-"
ZONE_SIGNATURE_PDF = 1024


class ErreurStockage(Exception):
    """Échec de téléversement ou de suppression, avec un message affichable.

    `statut` est le code HTTP à renvoyer (400 par défaut).
    """

    statut = 400


class ImageIllisible(ErreurStockage):
    """Le contenu n'est pas une image exploitable (corrompu, piégé, trop grand)."""

    statut = 422


class FichierNonConforme(ErreurStockage):
    """Le contenu d'une pièce ne correspond à aucun des types acceptés : page
    HTML ou exécutable renommé en `.pdf`, texte renommé en `.jpg`, image
    tronquée…"""

    statut = 422


# ─── Validation ──────────────────────────────────────────────

def extension(nom_fichier):
    return (nom_fichier or "").rsplit(".", 1)[-1].lower() if "." in (nom_fichier or "") else ""


def valider(fichier, dossier, extensions_permises):
    """Vérifie le format et le poids. Retourne l'extension normalisée."""
    if not fichier or not fichier.filename:
        raise ErreurStockage("Aucun fichier fourni")

    ext = extension(fichier.filename)
    if ext == "jpe":
        ext = "jpg"
    if ext not in extensions_permises:
        formats = ", ".join(sorted(extensions_permises))
        raise ErreurStockage(f"Format non accepté. Formats possibles : {formats}")

    # Le poids se mesure sur le flux, pas sur un en-tête que le client contrôle.
    fichier.stream.seek(0, os.SEEK_END)
    poids = fichier.stream.tell()
    fichier.stream.seek(0)

    limite = TAILLE_MAX.get(dossier, 8 * 1024 * 1024)
    if poids == 0:
        raise ErreurStockage("Fichier vide")
    if poids > limite:
        raise ErreurStockage(f"Fichier trop lourd ({poids // 1024 // 1024} Mo). "
                             f"Maximum : {limite // 1024 // 1024} Mo")
    return ext


def type_reel(fichier, extensions_permises):
    """Vérifie que le contenu d'une pièce est bien un PDF ou une image d'un
    format accepté, et retourne l'extension correspondant à son type réel.

    L'extension n'est qu'une déclaration du client : sans ce contrôle, une
    page HTML ou un exécutable renommé en `.pdf` serait stocké puis ouvert
    par l'administrateur qui examine le dossier. Le fichier n'est pas
    modifié (les pièces privées ne sont pas ré-encodées) ; seul son type est
    établi, et c'est lui qui donne l'extension et le `Content-Type` stockés.
    Une photo PNG nommée `.jpg` est donc acceptée, et rangée en `.png`.

    L'image est reconnue par sa signature en tête de fichier (Pillow), avant
    le PDF : un JPEG dont un commentaire contiendrait `%PDF-` reste un JPEG,
    vérifié comme tel.
    """
    # `valider` a déjà borné le poids : la lecture complète tient en mémoire.
    contenu = fichier.stream.read()
    fichier.stream.seek(0)

    formats = [f for f in FORMATS_LUS if EXTENSION_DU_FORMAT[f] in extensions_permises
               or (f == "JPEG" and "jpeg" in extensions_permises)]
    if formats:
        ext = _type_image(contenu, formats)
        if ext:
            return ext

    # Un PDF commence normalement par `%PDF-` ; les lecteurs tolèrent quelques
    # octets avant (générateurs de numériseurs, en-têtes parasites) tant que la
    # signature tient dans le premier Kio. Refuser au-delà de l'octet 0 ne
    # rendrait pas le contrôle plus sûr (un fichier piégé peut aussi commencer
    # par `%PDF-`), mais rejetterait des pièces que tout lecteur ouvre.
    if "pdf" in extensions_permises and SIGNATURE_PDF in contenu[:ZONE_SIGNATURE_PDF]:
        return "pdf"

    attendu = ("un PDF ou une image JPG, PNG ou WEBP" if "pdf" in extensions_permises
               else "une image JPG, PNG ou WEBP")
    raise FichierNonConforme("Le fichier ne correspond pas à son type : son contenu "
                             f"n'est pas {attendu}.")


def _type_image(contenu, formats):
    """Extension de l'image si `contenu` en est une, intacte, d'un des
    `formats` ; None si ce n'est pas une image. Lève `FichierNonConforme` ou
    `ImageIllisible` pour une image reconnue mais inexploitable."""
    try:
        with warnings.catch_warnings():
            # Mêmes gardes que `preparer_image` contre les bombes de décompression.
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            # `verify` contrôle la structure sans décoder (sommes CRC de chaque
            # bloc PNG jusqu'à IEND) ; il rend l'image inutilisable ensuite.
            with Image.open(io.BytesIO(contenu), formats=formats) as image:
                format_reel = image.format
                pixels = image.width * image.height
                image.verify()
            if format_reel == "WEBP" and pixels > PIXELS_MAX_SANS_DRAFT:
                raise ImageIllisible("Image trop grande (16 mégapixels maximum "
                                     "en WEBP). Envoyez-la en JPG ou en PDF.")
            if format_reel in ("JPEG", "MPO", "WEBP"):
                # `verify` ne fait rien pour un JPEG : seul le décodage révèle
                # une image tronquée. Le JPEG est décodé au huitième (`draft`),
                # ce qui ne coûte presque rien en mémoire.
                with Image.open(io.BytesIO(contenu), formats=formats) as image:
                    if format_reel != "WEBP":
                        image.draft(None, (1, 1))
                    image.load()
    except ImageIllisible:
        raise
    except UnidentifiedImageError:
        return None
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ImageIllisible("Image trop grande (50 mégapixels maximum).") from exc
    except (OSError, EOFError, ValueError, SyntaxError) as exc:
        raise FichierNonConforme("Le fichier ne correspond pas à son type : l'image est "
                                 "tronquée ou endommagée. Envoyez-la de nouveau.") from exc
    return EXTENSION_DU_FORMAT[format_reel]


# ─── Configuration ───────────────────────────────────────────

def supabase_configure():
    return bool(current_app.config.get("SUPABASE_URL")
                and current_app.config.get("SUPABASE_SERVICE_KEY"))


def verifier_acces():
    """Éprouve réellement la clé, au lieu de constater qu'elle est renseignée.

    Une clé publique (`anon` / `sb_publishable_…`) est parfaitement valide :
    elle passe l'authentification, puis se fait refuser chaque écriture par
    les règles de sécurité. Un diagnostic qui se contente de vérifier la
    présence de la variable annonce donc « tout fonctionne » alors que pas un
    fichier ne peut être enregistré.

    Lister les compartiments exige les droits de service : c'est ce qui
    distingue les deux clés sans rien téléverser.
    """
    if not supabase_configure():
        return False, ("SUPABASE_URL ou SUPABASE_SERVICE_KEY manquante : "
                       "les téléversements sont refusés.")

    url = f"{current_app.config['SUPABASE_URL']}/storage/v1/bucket"
    try:
        reponse = requests.get(url, headers=_entetes(), timeout=15)
    except requests.RequestException as exc:
        return False, f"Supabase Storage injoignable : {exc.__class__.__name__}"

    if reponse.status_code in (401, 403):
        return False, ("La clé fournie est refusée par Supabase. "
                       "Vérifiez qu'il s'agit bien de la clé secrète.")

    if reponse.status_code != 200:
        return False, f"Supabase Storage a répondu {reponse.status_code}."

    try:
        compartiments = {b.get("id") for b in reponse.json()}
    except ValueError:
        return False, "Réponse illisible de Supabase Storage."

    # Une clé publique s'authentifie mais ne voit aucun compartiment : elle
    # échouerait ensuite sur chaque écriture, avec un message trompeur.
    if not compartiments:
        return False, ("Clé acceptée mais sans droits : c'est la clé publique "
                       "(anon / publishable). Utilisez la clé secrète "
                       "(service_role ou sb_secret_…).")

    attendus = {_bucket("photos"), _bucket("documents")}
    manquants = attendus - compartiments
    if manquants:
        return False, f"Compartiment(s) absent(s) : {', '.join(sorted(manquants))}."

    return True, "Les téléversements fonctionnent."


def _bucket(dossier):
    """Compartiment correspondant à l'usage : public pour ce qui s'affiche,
    privé pour ce qui se consulte sur autorisation."""
    cle = "SUPABASE_BUCKET_PRIVE" if dossier in DOSSIERS_PRIVES else "SUPABASE_BUCKET_PUBLIC"
    defaut = "tcheyna-documents" if dossier in DOSSIERS_PRIVES else "tcheyna-photos"
    return current_app.config.get(cle, defaut)


def _entetes(type_contenu=None):
    cle = current_app.config["SUPABASE_SERVICE_KEY"]
    entetes = {"Authorization": f"Bearer {cle}", "apikey": cle}
    if type_contenu:
        entetes["Content-Type"] = type_contenu
    return entetes


# ─── Téléversement ───────────────────────────────────────────

class ImagePreparee:
    """Image ré-encodée, prête à stocker.

    `empreinte` (SHA-256 abrégé des octets reçus) entre dans le nom du
    fichier : renvoyer la même photo (reprise après une réponse perdue)
    redonne le même nom, ce qui permet de reconnaître le doublon.
    """

    def __init__(self, octets, ext, empreinte):
        self.octets = octets
        self.ext = ext
        self.empreinte = empreinte


def preparer_image(fichier, dossier):
    """Valide puis ré-encode une image publique.

    Le fichier reçu n'est jamais stocké tel quel : il peut porter la position
    GPS du logement (EXIF), une miniature, du XMP, un profil ICC, voire un
    contenu qui n'est pas une image. On le décode, on applique l'orientation
    EXIF, on réduit le côté long à 1280 px et on réécrit un WebP neuf, sans
    aucune métadonnée. Les photos déjà compressées par l'application passent
    par le même chemin.
    """
    valider(fichier, dossier, IMAGES)
    recu = fichier.stream.read()
    fichier.stream.seek(0)
    empreinte = hashlib.sha256(recu).hexdigest()[:20]

    # Mémoire (Render gratuit : 512 Mo pour deux workers) : une photo de
    # 48 Mpx décodée en pleine taille pèse 144 Mo, et chaque copie autant.
    # On demande donc au décodeur JPEG une version déjà réduite (`draft`, par
    # facteurs 1/2, 1/4, 1/8 : quasi gratuit), puis on réduit à 1280 px AVANT
    # de tourner l'image et de convertir son mode, qui copient l'image entière.
    try:
        with warnings.catch_warnings():
            # Entre PIXELS_MAX et son double, Pillow n'émet qu'un avertissement.
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(recu), formats=FORMATS_LUS) as source:
                if source.width * source.height > PIXELS_MAX:
                    raise ImageIllisible("Image trop grande (50 mégapixels maximum).")
                if (source.format not in ("JPEG", "MPO")
                        and source.width * source.height > PIXELS_MAX_SANS_DRAFT):
                    raise ImageIllisible("Image trop grande (16 mégapixels maximum "
                                         "en PNG ou WEBP). Envoyez-la en JPG.")
                if source.format in ("JPEG", "MPO"):
                    source.draft("RGB", (2 * COTE_MAX, 2 * COTE_MAX))
                source.load()
                # Boîte carrée : réduire avant de tourner donne la même taille
                # finale. L'orientation EXIF est conservée par `thumbnail`.
                source.thumbnail((COTE_MAX, COTE_MAX), Image.Resampling.LANCZOS)
                image = ImageOps.exif_transpose(source)
    except ImageIllisible:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ImageIllisible("Image trop grande (50 mégapixels maximum).") from exc
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError) as exc:
        raise ImageIllisible("Ce fichier n'est pas une image lisible. "
                             "Choisissez une photo JPG, PNG ou WEBP.") from exc

    transparente = image.mode in ("RGBA", "LA", "PA") or (
        image.mode == "P" and "transparency" in image.info)
    image = image.convert("RGBA" if transparente else "RGB")

    sortie = io.BytesIO()
    # Ni `exif`, ni `xmp`, ni `icc_profile` : le fichier écrit n'en porte aucun.
    image.save(sortie, "WEBP", quality=QUALITE_WEBP, method=4)
    return ImagePreparee(sortie.getvalue(), "webp", empreinte)


def nom_image(prefixe, image):
    """Nom stable d'une image préparée : préfixe du propriétaire + empreinte."""
    return f"{secure_filename(prefixe)}-{image.empreinte}.{image.ext}"


def enregistrer_image(image, dossier, nom):
    """Stocke une image préparée sous le nom donné ; retourne son URL."""
    return _enregistrer(io.BytesIO(image.octets), dossier, nom, image.ext)


def televerser(fichier, dossier, prefixe, extensions_permises=None):
    """Enregistre un fichier et retourne l'URL permettant de le relire.

    `dossier` sépare les usages (photos, avatars, documents) ; `prefixe`
    rattache le fichier à son propriétaire, ce qui rend les suppressions et
    les audits possibles. Photos et avatars sont ré-encodés (`preparer_image`) ;
    les pièces privées sont stockées telles quelles, après contrôle de leur
    type réel (`type_reel`).
    """
    if dossier in DOSSIERS_REENCODES:
        image = preparer_image(fichier, dossier)
        return enregistrer_image(image, dossier, nom_image(prefixe, image))

    extensions_permises = extensions_permises or DOCUMENTS
    ext = valider(fichier, dossier, extensions_permises)
    reel = type_reel(fichier, extensions_permises)
    # `jpeg` et `jpg` désignent le même type : l'extension déclarée est gardée.
    if not (reel == "jpg" and ext == "jpeg"):
        ext = reel

    # Un nom aléatoire évite qu'une URL devinée expose le document d'un autre.
    nom = f"{secure_filename(prefixe)}-{uuid.uuid4().hex[:12]}.{ext}"
    return _enregistrer(fichier.stream, dossier, nom, ext)


def _enregistrer(flux, dossier, nom, ext):
    if supabase_configure():
        return _televerser_supabase(flux, dossier, f"{dossier}/{nom}", ext)
    return _televerser_disque(flux, nom)


def _televerser_supabase(flux, dossier, chemin, ext):
    bucket = _bucket(dossier)
    url = f"{current_app.config['SUPABASE_URL']}/storage/v1/object/{bucket}/{chemin}"
    # `.webp` n'est connu de `mimetypes` qu'à partir de Python 3.13.
    type_contenu = TYPES_CONTENU.get(ext) or mimetypes.types_map.get(
        f".{ext}", "application/octet-stream")

    try:
        reponse = requests.post(
            url,
            headers={**_entetes(type_contenu), "x-upsert": "true"},
            data=flux.read(),
            timeout=60,
        )
    except requests.RequestException as exc:
        current_app.logger.error("Supabase Storage injoignable : %s", exc)
        raise ErreurStockage("Service de stockage momentanément indisponible") from exc

    if reponse.status_code not in (200, 201):
        current_app.logger.error("Supabase Storage a refusé le fichier : %s %s",
                                 reponse.status_code, reponse.text[:200])
        raise ErreurStockage("Le fichier n'a pas pu être enregistré")

    if dossier in DOSSIERS_PRIVES:
        # Référence interne : l'accès se fera par une URL signée, générée à la
        # demande pour la seule personne autorisée.
        return f"supabase://{chemin}"
    return f"{current_app.config['SUPABASE_URL']}/storage/v1/object/public/{bucket}/{chemin}"


def _televerser_disque(flux, nom):
    # En production, le disque de l'instance est éphémère : accepter le fichier
    # reviendrait à le perdre au prochain redémarrage, sans que personne ne s'en
    # aperçoive avant que la photo ne disparaisse de l'annonce.
    if not current_app.config.get("DEBUG") and not current_app.config.get("TESTING"):
        raise ErreurStockage(
            "Le stockage des fichiers n'est pas configuré sur ce serveur. "
            "Contactez l'administrateur (SUPABASE_SERVICE_KEY manquante)."
        )

    dossier_local = current_app.config["UPLOAD_FOLDER"]
    os.makedirs(dossier_local, exist_ok=True)
    with open(os.path.join(dossier_local, nom), "wb") as cible:
        cible.write(flux.read())
    return f"/uploads/{nom}"


# ─── Suppression ─────────────────────────────────────────────

def est_stocke(url):
    """Vrai si l'URL désigne un fichier de notre stockage (Supabase ou disque
    local), faux pour une URL externe comme les photos de démonstration."""
    return bool(url) and (url.startswith(("supabase://", "/uploads/"))
                          or "/storage/v1/object/public/" in url)


def supprimer(url):
    """Retire un fichier. Une URL inconnue est ignorée sans lever d'erreur :
    la base ne doit pas rester bloquée par un fichier déjà absent.

    Retourne True quand le fichier n'existe plus dans le stockage, y compris
    s'il était déjà absent : c'est l'état recherché, et une reprise
    (`FichierASupprimer`) ne doit pas buter indéfiniment dessus. False signale
    un échec à retenter (panne, refus) ou une URL hors de notre stockage."""
    if not url:
        return False

    if url.startswith("supabase://"):
        chemin = url[len("supabase://"):]
        bucket = _bucket(chemin.split("/", 1)[0])
    elif "/storage/v1/object/public/" in url:
        apres = url.split("/storage/v1/object/public/", 1)[-1]
        bucket, chemin = apres.split("/", 1)
    elif url.startswith("/uploads/"):
        cible = os.path.join(current_app.config["UPLOAD_FOLDER"], os.path.basename(url))
        try:
            os.remove(cible)
            return True
        except FileNotFoundError:
            return True
        except OSError:
            return False
    else:
        return False  # URL externe (photo Unsplash de démonstration)

    try:
        reponse = requests.delete(
            f"{current_app.config['SUPABASE_URL']}/storage/v1/object/{bucket}/{chemin}",
            headers=_entetes(), timeout=30,
        )
        return reponse.status_code in (200, 204) or _objet_absent(reponse)
    except requests.RequestException as exc:
        current_app.logger.error("Suppression Supabase impossible : %s", exc)
        return False


def _objet_absent(reponse):
    """Supabase signale un objet inexistant par un 404, ou selon les versions
    par un 400 dont le corps porte `"statusCode": "404"`."""
    if reponse.status_code == 404:
        return True
    if reponse.status_code == 400:
        try:
            return str(reponse.json().get("statusCode")) == "404"
        except (ValueError, AttributeError):
            return False
    return False


# ─── Lecture d'un fichier privé ──────────────────────────────

def url_signee(url, duree_secondes=300):
    """Transforme une référence privée en URL temporaire.

    Les pièces d'identité et les documents de propriété ne sont pas publics :
    l'administrateur qui les examine reçoit un lien valable quelques minutes.
    """
    if not url:
        return url
    if url.startswith("/uploads/"):
        # Stockage disque (développement) : /uploads ne sert pas les pièces
        # privées. Pas de lien plutôt qu'un lien mort ; l'interface affiche
        # « lien indisponible ».
        return None
    if not url.startswith("supabase://"):
        return url

    chemin = url[len("supabase://"):]
    bucket = _bucket(chemin.split("/", 1)[0])
    try:
        reponse = requests.post(
            f"{current_app.config['SUPABASE_URL']}/storage/v1/object/sign/{bucket}/{chemin}",
            headers=_entetes("application/json"),
            json={"expiresIn": duree_secondes},
            timeout=30,
        )
        if reponse.status_code == 200:
            chemin_signe = reponse.json().get("signedURL", "")
            return f"{current_app.config['SUPABASE_URL']}/storage/v1{chemin_signe}"
    except (requests.RequestException, ValueError) as exc:
        current_app.logger.error("Signature d'URL impossible : %s", exc)

    return None
