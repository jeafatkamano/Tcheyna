"""
services/notifications.py — Création des notifications in-app.

Un seul point d'entrée (`notifier`) pour que tous les événements produisent des
notifications homogènes, et des raccourcis nommés pour les événements du
parcours locatif.
"""
from datetime import datetime, time, timedelta

from app import db
from app.models import Match, Notification


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


def candidature_retiree(landlord_id, tenant_name, listing_title, match_id, frais_regles):
    """Retrait par le locataire d'une candidature acceptée. Décision du
    27/10/2026 : les frais de mise en relation ne sont pas remboursés."""
    contenu = f"{tenant_name} a retiré sa candidature pour « {listing_title} »."
    if frais_regles:
        contenu += (" Les frais de mise en relation réglés ne sont pas remboursés : "
                    "la mise en relation a eu lieu (conditions générales, article 6).")
    return notifier(landlord_id, "candidature_retiree", "Candidature retirée", contenu,
                    f"/owner/matches?match={match_id}")


def nouveau_message(destinataire_id, expediteur_name, extrait, match_id):
    # Le fil s'ouvre par la candidature (/messages/:matchId), pas par la conversation.
    return notifier(
        destinataire_id, "nouveau_message",
        f"Message de {expediteur_name}",
        extrait[:140],
        f"/messages/{match_id}",
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
        f"/owner/listings/{listing_id}",
    )


# ─── Expiration d'une annonce sans activité (D6, lot 2.3) ────
# Logique dans `routes.listings.expirer_annonces` ; ici, les seuls messages.

TYPE_RELANCE_EXPIRATION = "annonce_bientot_expiree"


def lien_relance_expiration(listing_id, echeance):
    """Lien de la relance, qui sert aussi de clé de dédoublonnage : il porte
    la date d'échéance. Une nouvelle activité déplace l'échéance, et ouvre
    donc droit à sa propre relance ; la page de l'annonce ignore le
    paramètre."""
    return f"/owner/listings/{listing_id}?echeance={echeance:%Y-%m-%d}"


def relance_expiration(landlord_id, listing_id, echeance):
    """Relance déjà envoyée pour cette échéance, ou None."""
    return (Notification.query
            .filter_by(user_id=landlord_id, type=TYPE_RELANCE_EXPIRATION,
                       lien=lien_relance_expiration(listing_id, echeance))
            .order_by(Notification.created_at)
            .first())


def annonce_bientot_expiree(landlord_id, listing_title, listing_id, echeance, retrait_le):
    return notifier(
        landlord_id, TYPE_RELANCE_EXPIRATION,
        "Votre annonce est-elle toujours d'actualité ?",
        f"Sans nouvelle activité, « {listing_title} » sera retirée des résultats "
        f"à partir du {retrait_le:%d/%m/%Y}. Confirmez qu'elle est toujours "
        "d'actualité, ou mettez-la à jour, depuis votre espace propriétaire.",
        lien_relance_expiration(listing_id, echeance),
    )


def annonce_expiree(landlord_id, listing_title, listing_id, derniere_activite):
    return notifier(
        landlord_id, "annonce_expiree",
        "Annonce retirée faute d'activité",
        f"« {listing_title} » était sans activité depuis le "
        f"{derniere_activite:%d/%m/%Y} : elle n'apparaît plus dans les résultats. "
        "Vos candidatures en cours sont conservées. Remettez-la en ligne depuis "
        "votre espace propriétaire.",
        f"/owner/listings/{listing_id}",
    )


def paiement_confirme(user_id, montant, devise, type_label, payment_id):
    return notifier(
        user_id, "paiement_recu",
        "Paiement confirmé",
        f"{type_label} — {montant:,} {devise} reçu. Votre reçu est disponible.".replace(",", " "),
        f"/paiements/{payment_id}",
    )


MOTIFS_REMBOURSEMENT = {
    "hors_plateforme": "la caution et le loyer ne se paient pas via Tcheyna",
    "doublon": "ce service était déjà réglé",
    "candidature_close": "la candidature n'était plus en attente (retirée ou refusée)",
    "ecartee_par_le_bailleur": "vous avez écarté la candidature après avoir réglé les frais",
}


def paiement_a_rembourser(paiement, motif, admin_ids):
    """Paiement encaissé par l'opérateur que Tcheyna ne doit pas garder :
    le payeur est prévenu, l'administration doit rembourser."""
    raison = MOTIFS_REMBOURSEMENT.get(motif, motif)
    montant = f"{paiement.montant:,} {paiement.devise}".replace(",", " ")
    lien = f"/paiements/{paiement.id}"
    notifier(
        paiement.user_id, "paiement_a_rembourser",
        "Paiement à rembourser",
        f"{montant} reçu, mais {raison}. L'équipe Tcheyna vous contacte pour le remboursement.",
        lien,
    )
    for admin_id in admin_ids:
        notifier(
            admin_id, "paiement_a_rembourser",
            "Remboursement à effectuer",
            f"Réf. {paiement.reference} · {montant} : {raison}. "
            f"Transaction CinetPay {paiement.cinetpay_transaction_id}.",
            lien,
        )


def paiement_rembourse(paiement):
    montant = f"{paiement.montant:,} {paiement.devise}".replace(",", " ")
    return notifier(
        paiement.user_id, "paiement_rembourse",
        "Paiement remboursé",
        f"Les {montant} de la référence {paiement.reference} vous ont été remboursés.",
        f"/paiements/{paiement.id}",
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


# ─── Rappel de visite (lot 2.7) ──────────────────────────────

TYPE_RAPPEL_VISITE = "rappel_visite"


def lien_rappel_visite(match):
    """Lien du rappel, qui sert aussi de clé de dédoublonnage : il porte la
    date de la visite, à la minute près. Une visite déplacée change de lien,
    et reçoit donc son propre rappel ; la page de la conversation ignore le
    paramètre."""
    return f"/messages/{match.id}?visite={match.visite_date:%Y-%m-%dT%H:%M}"


def rappeler_visites(maintenant=None):
    """Rappelle aux deux parties les visites d'aujourd'hui et de demain qui
    n'ont pas encore eu leur rappel. Retourne le nombre de notifications créées.

    Faite pour un cron quotidien (`flask visites rappeler`), à n'importe
    quelle heure fixe. Fenêtre : de maintenant à la fin de demain, en UTC,
    qui est l'heure de Conakry (UTC+0, sans heure d'été).
      • « demain » : toutes les visites du lendemain sont rappelées la veille,
        quelle que soit leur heure ; une fenêtre glissante (maintenant + 12 h
        à + 36 h, par exemple) rappellerait le jour même celles du soir ;
      • « aujourd'hui » : rattrapage. Une visite que le passage d'hier n'a pas
        rappelée (cron manqué, ou visite fixée après son passage) l'est
        encore, tant qu'elle n'a pas eu lieu ;
      • rejouer la commande ne crée aucun doublon : une partie qui a déjà le
        rappel de cette visite, à cette date, n'en reçoit pas d'autre.

    Seules les candidatures acceptées sont concernées : une candidature
    refusée, retirée, conclue ou close par la suppression d'un compte n'a plus
    de visite à rappeler.
    """
    maintenant = maintenant or datetime.utcnow()
    aujourd_hui = maintenant.date()
    fin_de_demain = datetime.combine(aujourd_hui + timedelta(days=2), time.min)

    visites = (Match.query
               .filter(Match.status == "accepted",
                       Match.visite_date > maintenant,
                       Match.visite_date < fin_de_demain)
               .order_by(Match.visite_date)
               .all())

    crees = 0
    for match in visites:
        annonce = match.listing
        if annonce is None or annonce.landlord is None or match.tenant is None:
            continue
        lien = lien_rappel_visite(match)
        deja = {user_id for (user_id,) in db.session.query(Notification.user_id)
                .filter(Notification.type == TYPE_RAPPEL_VISITE, Notification.lien == lien)}
        quand = "demain" if match.visite_date.date() > aujourd_hui else "aujourd'hui"
        horaire = f"{quand}, le {match.visite_date:%d/%m/%Y à %H:%M}"
        parties = ((match.tenant_id, annonce.landlord.full_name),
                   (annonce.landlord_id, match.tenant.full_name))
        for user_id, autre_nom in parties:
            if user_id in deja:
                continue
            notifier(
                user_id, TYPE_RAPPEL_VISITE, f"Rappel : visite {quand}",
                f"Visite de « {annonce.title_fr} » {horaire}, avec {autre_nom}.",
                lien,
            )
            crees += 1

    db.session.commit()
    return crees
