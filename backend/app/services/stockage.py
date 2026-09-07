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
import mimetypes
import os
import uuid

import requests
from flask import current_app
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


class ErreurStockage(Exception):
    """Échec de téléversement ou de suppression, avec un message affichable."""


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


# ─── Configuration ───────────────────────────────────────────

def supabase_configure():
    return bool(current_app.config.get("SUPABASE_URL")
                and current_app.config.get("SUPABASE_SERVICE_KEY"))


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

def televerser(fichier, dossier, prefixe, extensions_permises=None):
    """Enregistre un fichier et retourne l'URL permettant de le relire.

    `dossier` sépare les usages (photos, avatars, documents) ; `prefixe`
    rattache le fichier à son propriétaire, ce qui rend les suppressions et
    les audits possibles.
    """
    extensions_permises = extensions_permises or DOCUMENTS
    ext = valider(fichier, dossier, extensions_permises)

    # Un nom aléatoire évite qu'une URL devinée expose le document d'un autre.
    nom = f"{secure_filename(prefixe)}-{uuid.uuid4().hex[:12]}.{ext}"
    chemin = f"{dossier}/{nom}"

    if supabase_configure():
        return _televerser_supabase(fichier, dossier, chemin, ext)
    return _televerser_disque(fichier, nom)


def _televerser_supabase(fichier, dossier, chemin, ext):
    bucket = _bucket(dossier)
    url = f"{current_app.config['SUPABASE_URL']}/storage/v1/object/{bucket}/{chemin}"
    type_contenu = mimetypes.types_map.get(f".{ext}", "application/octet-stream")

    try:
        reponse = requests.post(
            url,
            headers={**_entetes(type_contenu), "x-upsert": "true"},
            data=fichier.stream.read(),
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


def _televerser_disque(fichier, nom):
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
    fichier.save(os.path.join(dossier_local, nom))
    return f"/uploads/{nom}"


# ─── Suppression ─────────────────────────────────────────────

def supprimer(url):
    """Retire un fichier. Une URL inconnue est ignorée sans lever d'erreur :
    la base ne doit pas rester bloquée par un fichier déjà absent."""
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
        except OSError:
            return False
    else:
        return False  # URL externe (photo Unsplash de démonstration)

    try:
        reponse = requests.delete(
            f"{current_app.config['SUPABASE_URL']}/storage/v1/object/{bucket}/{chemin}",
            headers=_entetes(), timeout=30,
        )
        return reponse.status_code in (200, 204)
    except requests.RequestException as exc:
        current_app.logger.error("Suppression Supabase impossible : %s", exc)
        return False


# ─── Lecture d'un fichier privé ──────────────────────────────

def url_signee(url, duree_secondes=300):
    """Transforme une référence privée en URL temporaire.

    Les pièces d'identité et les documents de propriété ne sont pas publics :
    l'administrateur qui les examine reçoit un lien valable quelques minutes.
    """
    if not url or not url.startswith("supabase://"):
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
