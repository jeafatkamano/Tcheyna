"""
services/notifications.py — Création des notifications in-app.

Un seul point d'entrée (`notifier`) pour que tous les événements produisent des
notifications homogènes, et des raccourcis nommés pour les événements du
parcours locatif.
"""
from app import db
from app.models import Notification


def notifier(user_id, type_notif, titre, contenu=None, lien=None, commit=False):
    """Crée une notification. Ne commit pas par défaut : l'appelant maîtrise
    la transaction et évite les commits partiels."""
    notif = Notification(
        user_id=user_id,
        type=type_notif,
        titre=titre,
        contenu=contenu,
        lien=lien,
    )
    db.session.add(notif)
    if commit:
        db.session.commit()
    return notif


# ─── Raccourcis par événement ────────────────────────────────

def nouvelle_candidature(landlord_id, tenant_name, listing_title, match_id):
    return notifier(
        landlord_id, "nouvelle_candidature",
        "Nouvelle candidature",
        f"{tenant_name} a candidaté pour « {listing_title} ».",
        f"/owner/matches?match={match_id}",
    )


def candidature_traitee(tenant_id, acceptee, listing_title, match_id):
    if acceptee:
        return notifier(
            tenant_id, "candidature_acceptee",
            "Candidature acceptée 🎉",
            f"Le propriétaire de « {listing_title} » a accepté votre dossier. "
            "La messagerie est ouverte.",
            f"/messages/{match_id}",
        )
    return notifier(
        tenant_id, "candidature_refusee",
        "Candidature non retenue",
        f"Votre candidature pour « {listing_title} » n'a pas été retenue.",
        "/tenant/matches",
    )


def nouveau_message(destinataire_id, expediteur_name, extrait, conversation_id):
    return notifier(
        destinataire_id, "nouveau_message",
        f"Message de {expediteur_name}",
        extrait[:140],
        f"/messages/{conversation_id}",
    )


def certification_traitee(landlord_id, certifiee, listing_title, listing_id, motif=None):
    if certifiee:
        return notifier(
            landlord_id, "annonce_certifiee",
            "Annonce certifiée ✅",
            f"« {listing_title} » affiche désormais le badge Annonce Certifiée "
            "et est mise en avant dans les résultats.",
            f"/listing/{listing_id}",
        )
    return notifier(
        landlord_id, "annonce_refusee",
        "Certification refusée",
        motif or f"La certification de « {listing_title} » n'a pas été accordée.",
        f"/owner/listing?id={listing_id}",
    )


def paiement_confirme(user_id, montant, devise, type_label, payment_id):
    return notifier(
        user_id, "paiement_recu",
        "Paiement confirmé",
        f"{type_label} — {montant:,} {devise} reçu. Votre reçu est disponible.".replace(",", " "),
        f"/paiements/{payment_id}",
    )


def nouvel_avis(target_id, reviewer_name, note):
    return notifier(
        target_id, "nouvel_avis",
        "Nouvel avis reçu",
        f"{reviewer_name} vous a attribué la note de {note}/5.",
        "/tenant/profile",
    )


def niveau_atteint(user_id, niveau, label, debloque):
    return notifier(
        user_id, "niveau_confiance",
        f"Niveau {niveau} atteint — {label}",
        f"Vous débloquez : {debloque}.",
        "/tenant/profile",
    )
