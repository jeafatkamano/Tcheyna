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
from sqlalchemy import func

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


def retirer_justificatif_revenus(passeport, garder_date=False):
    """Efface la référence du justificatif ; retourne cette référence.

    `garder_date` : un justificatif validé garde sa date de dépôt, point de
    départ de sa validité de 3 mois (décision D12).
    """
    reference = passeport.income_doc_url
    passeport.income_doc_url = None
    if not garder_date:
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
        # Fichier encore là : validation d'avant le lot 1.5, dont la date de
        # dépôt n'est que le `updated_at` recopié par la migration, à effacer.
        # Sans fichier : validation récente, dont la date fait courir D12.
        garder = passeport.income_doc_url is None
        lignes += planifier_suppression(retirer_justificatif_revenus(passeport, garder_date=garder),
                                        "rattrapage_revenus")
    db.session.commit()
    executer_suppressions(lignes)
    return len(lignes)


def _recalculer(passeport):
    if passeport.tenant:
        passeport.tenant.update_trust_level()
    passeport.calculate_score()


# ─── Validité des justificatifs de revenus (décision D12) ────

# D12 : un justificatif de revenus vaut 3 mois. Compté en jours plutôt qu'en
# mois calendaires : l'échéance est la même pour tous et sans ambiguïté
# (30 novembre + 3 mois ?), sans dépendance de plus.
VALIDITE_REVENUS_JOURS = 90
# Le locataire est relancé une fois, à partir de J-7.
RELANCE_REVENUS_JOURS = 7


def _dernieres_lignes(decision):
    """{locataire : date de sa dernière ligne `revenus`/`decision` au journal}."""
    return dict(db.session.query(Verification.cible_id, func.max(Verification.created_at))
                .filter(Verification.objet == "revenus", Verification.decision == decision)
                .group_by(Verification.cible_id).all())


def _debut_validite(passeport, validations):
    """Point de départ des 3 mois, ou None s'il est inconnu."""
    # Un fichier encore présent sur un justificatif validé : validation
    # d'avant le lot 1.5 (depuis, le fichier est supprimé à la décision). Sa
    # date de dépôt n'est que le `updated_at` du passeport recopié par la
    # migration du lot 1.5, parfois récent : elle ne prouve rien.
    if passeport.income_doc_url:
        return None
    return passeport.revenus_deposes_le or validations.get(passeport.tenant_id)


def appliquer_validite_revenus(maintenant=None):
    """Relance à J-7, puis retire la vérification des revenus échue.

    Point de départ des 3 mois : la date de dépôt du justificatif validé
    (conservée à la validation), la plus prudente, puisque la date du
    document lui-même n'est pas saisie. À défaut, pour une validation
    antérieure à ce lot, la date de la validation au journal. Sans aucune
    des deux (validation antérieure au lot 1.5), rien ne prouve que le
    justificatif a moins de 3 mois : il est considéré comme échu.

    Le locataire est toujours prévenu avant l'expiration : un justificatif
    échu (ou sans date) qui n'a pas été relancé, au premier passage de la
    commande par exemple, reçoit une relance et n'expire que 7 jours après.

    Idempotente : un justificatif échu n'est plus « vérifié », il n'est donc
    plus repris ; la relance est inscrite au journal, qui, contrairement aux
    notifications que le locataire peut supprimer, garantit qu'elle n'est
    envoyée qu'une fois par justificatif, même si la commande est rejouée ou
    a sauté un jour. Retourne (expirés, relancés).
    """
    maintenant = maintenant or datetime.utcnow()
    preavis = timedelta(days=RELANCE_REVENUS_JOURS)
    # Jointure interne : un `income_verified` vrai sans passeport (aucun
    # parcours ne le produit) ne serait pas repris.
    passeports = (TenantPassport.query.join(User, User.id == TenantPassport.tenant_id)
                  .filter(User.income_verified.is_(True))
                  .all())
    validations = _dernieres_lignes("approuvee")
    relances = _dernieres_lignes("relancee")

    expires = relances_envoyees = 0
    lignes = []
    for passeport in passeports:
        debut = _debut_validite(passeport, validations)
        echeance = debut + timedelta(days=VALIDITE_REVENUS_JOURS) if debut else None
        derniere_relance = relances.get(passeport.tenant_id)
        # Seule compte une relance du justificatif en cours.
        if derniere_relance is not None and debut is not None and derniere_relance < debut:
            derniere_relance = None

        if echeance is not None and maintenant < echeance - preavis:
            continue

        if derniere_relance is None:
            if echeance is not None and maintenant < echeance:
                message = f"Votre justificatif de revenus expire le {echeance:%d/%m/%Y}. "
                motif = f"Échéance le {echeance:%d/%m/%Y}"
            else:
                # Déjà échu ou sans date : préavis de 7 jours à partir d'aujourd'hui.
                message = ("Votre justificatif de revenus doit être renouvelé sous "
                           f"{RELANCE_REVENUS_JOURS} jours. ")
                motif = (f"Justificatif échu ou sans date : préavis de "
                         f"{RELANCE_REVENUS_JOURS} jours")
            ligne = consigner(None, passeport.tenant_id, "revenus", "relancee", motif)
            ligne.created_at = maintenant
            notify.notifier(passeport.tenant_id, "niveau_confiance",
                            "Justificatif de revenus à renouveler",
                            message + "Déposez-en un plus récent depuis votre profil : il sera "
                            "examiné sous 48 h.", "/tenant/profile")
            relances_envoyees += 1
            continue

        # Relancé avant l'échéance : expire à l'échéance. Relancé après (ou
        # sans date connue) : expire à la fin du préavis.
        relance_a_temps = echeance is not None and derniere_relance < echeance
        if maintenant < (echeance if relance_a_temps else derniere_relance + preavis):
            continue

        motif = (f"Validité de {VALIDITE_REVENUS_JOURS} jours dépassée "
                 f"(justificatif du {debut:%d/%m/%Y})" if debut
                 else "Date du justificatif inconnue (validé avant le lot 1.5)")
        passeport.income_verified = False
        passeport.tenant.income_verified = False
        # Un justificatif validé est supprimé à la décision (lot 1.5) : il
        # ne reste un fichier que pour une validation antérieure, jamais
        # rattrapée. Le garder le ferait revenir dans la file d'attente.
        lignes += planifier_suppression(retirer_justificatif_revenus(passeport),
                                        "expiration_revenus")
        consigner(None, passeport.tenant_id, "revenus", "expiree", motif)
        _recalculer(passeport)
        notify.notifier(passeport.tenant_id, "niveau_confiance",
                        "Justificatif de revenus expiré",
                        "Votre justificatif de revenus a plus de 3 mois : vos revenus ne "
                        "sont plus considérés comme vérifiés. Déposez un justificatif "
                        "récent pour les faire vérifier de nouveau.", "/tenant/profile")
        expires += 1

    db.session.commit()
    executer_suppressions(lignes)
    return expires, relances_envoyees


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
    OTPCode.query.filter_by(user_id=user.id).delete()

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
