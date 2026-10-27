"""
services/donnees_personnelles.py — Journal des décisions, suppression des
pièces et suppression de compte.

La politique de confidentialité (§7) promet que les pièces d'identité et de
revenus sont « supprimées dès qu'une décision de vérification est rendue ».
Jusqu'au lot 1.5, la validation ne supprimait rien et le refus n'effaçait
que la référence en base, laissant la CNI dans le compartiment privé.

Suppression d'un fichier en deux temps, pour ne jamais perdre sa trace :
  1. `planifier_suppression` efface la référence et inscrit le fichier dans
     `fichiers_a_supprimer`, dans la transaction de la décision ;
  2. après le commit, `executer_suppressions` le retire du stockage et
     efface la ligne. Un échec (Supabase injoignable) laisse la ligne, que
     `flask donnees retenter-suppressions` reprend.
"""
from datetime import datetime, timedelta

from flask import current_app

from app import db
from app.models import (
    FichierASupprimer,
    Match,
    OTPCode,
    TenantPassport,
    User,
    Verification,
)
from app.services import notifications as notify
from app.services import stockage

CHAMPS_IDENTITE = ("cni_recto_url", "cni_verso_url", "passport_url")
CHAMP_REVENUS = "income_doc_url"

NOM_COMPTE_SUPPRIME = "Compte supprimé"
# Un condensat werkzeug a la forme « méthode$sel$valeur » : cette chaîne n'en
# est pas un, `check_password_hash` la refuse toujours.
MOT_DE_PASSE_INUTILISABLE = "!compte-supprime"


class PurgeNonConfiguree(RuntimeError):
    """La durée de conservation (décision D5) est absente ou invalide."""


# ─── Journal des décisions ───────────────────────────────────

def consigner(acteur, cible_id, objet, decision, motif=None):
    """Ajoute une ligne au journal, dans la transaction de l'appelant."""
    ligne = Verification(acteur_id=acteur.id if acteur else None, cible_id=cible_id,
                         objet=objet, decision=decision, motif=motif or None)
    db.session.add(ligne)
    return ligne


# ─── Suppression des fichiers ────────────────────────────────

def planifier_suppression(references, origine):
    """Inscrit les fichiers à supprimer ; retourne les lignes créées, à
    passer à `executer_suppressions` après le commit."""
    lignes = []
    for reference in references:
        # Une URL externe (photo de démonstration) n'est pas dans notre
        # stockage : la retenter indéfiniment n'aurait pas de sens.
        if reference and stockage.est_stocke(reference):
            ligne = FichierASupprimer(reference=reference, origine=origine)
            db.session.add(ligne)
            lignes.append(ligne)
    return lignes


def executer_suppressions(lignes):
    """Supprime les fichiers planifiés. À appeler APRÈS le commit qui a
    effacé les références : un fichier ne disparaît jamais avant que la base
    ait cessé de le désigner. Retourne le nombre d'échecs."""
    echecs = 0
    for ligne in lignes:
        if stockage.supprimer(ligne.reference):
            db.session.delete(ligne)
        else:
            echecs += 1
            ligne.tentatives = (ligne.tentatives or 0) + 1
            ligne.derniere_tentative = datetime.utcnow()
            current_app.logger.warning("Suppression différée (%s) : %s",
                                       ligne.origine, ligne.reference)
    db.session.commit()
    return echecs


def retenter_suppressions(limite=200):
    """Reprend les suppressions restées en échec. Retourne (traitées, échecs)."""
    lignes = (FichierASupprimer.query.order_by(FichierASupprimer.created_at.asc())
              .limit(limite).all())
    return len(lignes), executer_suppressions(lignes)


def retirer_pieces_identite(passeport):
    """Efface les références des pièces d'identité ; retourne ces références."""
    references = [getattr(passeport, champ) for champ in CHAMPS_IDENTITE]
    for champ in CHAMPS_IDENTITE:
        setattr(passeport, champ, None)
    passeport.identite_deposee_le = None
    return [r for r in references if r]


def retirer_justificatif_revenus(passeport):
    reference = passeport.income_doc_url
    passeport.income_doc_url = None
    passeport.revenus_deposes_le = None
    return [reference] if reference else []


# ─── Purges ──────────────────────────────────────────────────

def purger_pieces_sans_decision(maintenant=None):
    """Supprime les pièces restées sans décision au-delà de la durée de
    conservation (DUREE_CONSERVATION_PIECES_JOURS, décision D5).

    Refuse de tourner tant que la durée n'est pas configurée. Retourne le
    nombre de pièces (fichiers) supprimées.
    """
    brut = current_app.config.get("DUREE_CONSERVATION_PIECES_JOURS")
    try:
        jours = int(brut) if brut is not None else 0
    except (TypeError, ValueError):
        jours = 0
    # Zéro ou négatif placerait la limite dans le futur : toutes les pièces en
    # attente seraient supprimées. Seul un entier strictement positif passe.
    if jours <= 0:
        raise PurgeNonConfiguree(
            "DUREE_CONSERVATION_PIECES_JOURS doit être un nombre de jours strictement positif "
            "(décision D5) : purge désactivée.")
    limite = (maintenant or datetime.utcnow()) - timedelta(days=jours)
    motif = f"Pièce non examinée dans les {jours} jours suivant son dépôt"

    lignes = []
    identite = (TenantPassport.query.join(User, User.id == TenantPassport.tenant_id)
                .filter(TenantPassport.identite_deposee_le < limite,
                        User.cni_verified.is_(False))
                .all())
    for passeport in identite:
        references = retirer_pieces_identite(passeport)
        if not references:
            continue
        passeport.docs_uploaded = False
        passeport.tenant.cni_uploaded = False
        lignes += planifier_suppression(references, "purge_identite")
        consigner(None, passeport.tenant_id, "identite", "purgee", motif)
        _recalculer(passeport)
        notify.notifier(passeport.tenant_id, "niveau_confiance", "Pièce d'identité supprimée",
                        "Votre pièce n'a pas pu être examinée à temps et a été supprimée. "
                        "Vous pouvez la déposer de nouveau.", "/tenant/profile")

    revenus = (TenantPassport.query
               .filter(TenantPassport.revenus_deposes_le < limite,
                       TenantPassport.income_verified.is_(False))
               .all())
    for passeport in revenus:
        references = retirer_justificatif_revenus(passeport)
        if not references:
            continue
        lignes += planifier_suppression(references, "purge_revenus")
        consigner(None, passeport.tenant_id, "revenus", "purgee", motif)
        _recalculer(passeport)
        notify.notifier(passeport.tenant_id, "niveau_confiance", "Justificatif supprimé",
                        "Votre justificatif de revenus n'a pas pu être examiné à temps et a "
                        "été supprimé. Vous pouvez le déposer de nouveau.", "/tenant/profile")

    db.session.commit()
    executer_suppressions(lignes)
    return len(lignes)


def purger_pieces_decidees():
    """Rattrapage des pièces validées AVANT le lot 1.5, qui n'étaient pas
    supprimées à la décision. Aucune durée en jeu : la politique actuelle
    prévoit la suppression dès la décision. Retourne le nombre de fichiers."""
    lignes = []
    for passeport in (TenantPassport.query.join(User, User.id == TenantPassport.tenant_id)
                      .filter(User.cni_verified.is_(True)).all()):
        lignes += planifier_suppression(retirer_pieces_identite(passeport), "rattrapage_identite")
    for passeport in TenantPassport.query.filter(TenantPassport.income_verified.is_(True)).all():
        lignes += planifier_suppression(retirer_justificatif_revenus(passeport),
                                        "rattrapage_revenus")
    db.session.commit()
    executer_suppressions(lignes)
    return len(lignes)


def _recalculer(passeport):
    if passeport.tenant:
        passeport.tenant.update_trust_level()
    passeport.calculate_score()


# ─── Suppression de compte ───────────────────────────────────

def anonymiser_compte(user):
    """Supprime le compte à la demande de son titulaire.

    La ligne `users` est conservée, anonymisée, et non effacée : paiements
    (obligations comptables), avis publiés et messages échangés y sont
    rattachés et appartiennent aussi à l'autre partie. Tout ce qui identifie
    la personne est retiré ; ses fichiers sont supprimés du stockage.

    Ne commit pas : retourne les suppressions de fichiers à exécuter après
    le commit de l'appelant.
    """
    maintenant = datetime.utcnow()
    references = [user.avatar_url]

    passeport = user.passport
    if passeport:
        references += retirer_pieces_identite(passeport)
        references += retirer_justificatif_revenus(passeport)
        # Revenus, employeur, garant, critères de recherche : rien n'impose
        # de les garder une fois le compte fermé.
        db.session.delete(passeport)

    for annonce in user.listings:
        references += annonce.images_urls.split(",") if annonce.images_urls else []
        references += annonce.documents
        annonce.images_urls = None
        annonce.documents_urls = None
        annonce.adresse = None
        annonce.is_visible = False
        annonce.status = "closed"
        if annonce.certification_status == "pending":
            annonce.certification_status = "none"
        # Les candidatures en cours sur ses annonces ne peuvent plus aboutir.
        for candidature in annonce.matches.filter(Match.status.in_(("pending", "accepted"))):
            candidature.status = "cancelled"

    for candidature in user.matches.filter(Match.status.in_(("pending", "accepted"))):
        candidature.status = "cancelled"
        candidature.message = None

    user.favorites.delete()
    user.notifications.delete()
    # Les codes envoyés restent, vidés du numéro et de tout secret : ils
    # comptent dans le plafond global des SMS (routes/auth.py). Les effacer
    # laisserait des comptes jetables, supprimés après usage, faire envoyer
    # des SMS sans fin.
    OTPCode.query.filter_by(user_id=user.id).update(
        {"phone": None, "code": None, "code_hash": None, "is_used": True},
        synchronize_session=False)

    # L'adresse e-mail et le numéro sont libérés : la personne peut ouvrir
    # un nouveau compte, sans lien avec l'ancien.
    user.email = f"supprime-{user.id}@compte-supprime.invalid"
    user.phone = None
    user.password_hash = MOT_DE_PASSE_INUTILISABLE
    user.full_name = NOM_COMPTE_SUPPRIME
    user.avatar_url = None
    user.bio = None
    user.pays = user.ville = user.quartier = None
    user.phone_verified = user.cni_uploaded = user.cni_verified = user.income_verified = False
    user.trust_level = 0
    user.is_active = False
    user.supprime_le = maintenant
    user.revoquer_jetons()

    return planifier_suppression(references, "suppression_compte")
