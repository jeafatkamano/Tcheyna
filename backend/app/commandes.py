"""
app/commandes.py — Commandes d'exploitation (`flask donnees …`, `flask visites …`).

À lancer à la main ou par une tâche planifiée (Render Cron Job) : aucune
n'est déclenchée automatiquement par l'application.
"""
import click
from flask import current_app
from flask.cli import AppGroup
from sqlalchemy import func
from werkzeug.security import generate_password_hash

from app import db
from app.models import OTPCode, User
from app.routes.listings import expirer_annonces
from app.services import donnees_personnelles as dp
from app.services import notifications as notify

donnees_cli = AppGroup("donnees", help="Conservation et suppression des données personnelles.")
visites_cli = AppGroup("visites", help="Suivi des visites planifiées.")


# ─── Comptes administrateurs (lot 1.22) ─────────────────────

admin_cli = AppGroup("admin", help="Comptes administrateurs.")

# Mêmes bornes que le mot de passe d'un compte (`schemas.MotDePasse`).
MOT_DE_PASSE_MIN, MOT_DE_PASSE_MAX = 8, 128


@admin_cli.command("reinitialiser-mot-de-passe")
@click.argument("email")
def reinitialiser_mot_de_passe(email):
    """Réinitialise le mot de passe d'un administrateur.

    Un administrateur n'a aucune récupération en libre-service : ni connexion
    par téléphone, ni « Mot de passe oublié » par SMS (décision du
    27/10/2026). Cette commande se lance depuis un poste qui a la
    `DATABASE_URL` de production (docs/RUNBOOK_PHASE1.md). Le nouveau mot de
    passe se saisit au clavier, deux fois, sans s'afficher : jamais en
    argument, où il resterait dans l'historique du terminal. Toutes les
    sessions du compte sont fermées. Les autres comptes passent par
    « Mot de passe oublié ».
    """
    user = User.query.filter(func.lower(User.email) == email.strip().lower()).first()
    if user is None or user.role != "admin":
        raise click.ClickException(
            f"Aucun compte administrateur pour {email}. Un autre compte passe par "
            "« Mot de passe oublié » ; pour créer un administrateur : python create_admin.py.")

    mot_de_passe = click.prompt(
        f"Nouveau mot de passe ({MOT_DE_PASSE_MIN} caractères minimum)",
        hide_input=True, confirmation_prompt="Confirmer le mot de passe")
    if not MOT_DE_PASSE_MIN <= len(mot_de_passe) <= MOT_DE_PASSE_MAX:
        raise click.ClickException(
            f"Le mot de passe doit faire de {MOT_DE_PASSE_MIN} à {MOT_DE_PASSE_MAX} caractères.")

    user.password_hash = generate_password_hash(mot_de_passe)
    # Comme une réinitialisation par SMS : le mot de passe a pu être pris par
    # un tiers, toutes les sessions ouvertes sont fermées, et aucun code
    # encore valide ne reste utilisable.
    user.revoquer_jetons()
    OTPCode.query.filter_by(user_id=user.id, is_used=False).update(
        {"is_used": True}, synchronize_session=False)
    db.session.commit()
    current_app.logger.warning("Mot de passe de l'administrateur %s réinitialisé par commande",
                               user.id)

    click.echo(f"Mot de passe de {user.email} réinitialisé ; toutes ses sessions sont fermées.")
    if not user.is_active:
        click.echo("Attention : ce compte est désactivé. Il ne pourra pas se connecter tant "
                   "qu'un autre administrateur ne l'aura pas réactivé.")


# ─── Annonces (lot 2.3) ──────────────────────────────────────

annonces_cli = AppGroup("annonces", help="Cycle de vie des annonces.")


@annonces_cli.command("expirer")
def expirer():
    """Relance à J-7, puis retire, les annonces en ligne sans activité
    depuis 30 jours (décision D6). Sans doublon si la commande est rejouée :
    à lancer une fois par jour, à heure fixe. La logique vit avec le cycle
    de vie de l'annonce (`routes.listings`)."""
    relances, retraits = expirer_annonces()
    click.echo(f"{relances} relance(s) envoyée(s), {retraits} annonce(s) retirée(s) "
               "faute d'activité.")


# ─── Données personnelles ────────────────────────────────────

@donnees_cli.command("retenter-suppressions")
def retenter_suppressions():
    """Reprend les suppressions de fichiers restées en échec."""
    traitees, echecs = dp.retenter_suppressions()
    click.echo(f"{traitees} suppression(s) reprise(s), {echecs} encore en échec.")
    if echecs:
        raise SystemExit(1)


@donnees_cli.command("purger-pieces")
def purger_pieces():
    """Supprime les pièces restées sans décision au-delà de
    DUREE_CONSERVATION_PIECES_JOURS (décision D5). Refuse sans cette valeur."""
    try:
        nombre = dp.purger_pieces_sans_decision()
    except dp.PurgeNonConfiguree as exc:
        raise click.ClickException(str(exc)) from exc
    click.echo(f"{nombre} fichier(s) purgé(s).")


@donnees_cli.command("rattraper-pieces-decidees")
def rattraper_pieces_decidees():
    """Supprime les pièces déjà validées avant le lot 1.5 (à lancer une fois)."""
    click.echo(f"{dp.purger_pieces_decidees()} fichier(s) supprimé(s).")


@donnees_cli.command("expirer-revenus")
def expirer_revenus():
    """Applique la validité de 3 mois des justificatifs de revenus (décision
    D12) : relance le locataire à J-7, puis retire la vérification échue et
    recalcule son niveau. À lancer chaque jour ; sans effet si rejouée."""
    expires, relances = dp.appliquer_validite_revenus()
    click.echo(f"{expires} justificatif(s) de revenus expiré(s), {relances} relance(s) envoyée(s).")


@visites_cli.command("rappeler")
def rappeler_visites():
    """Rappelle aux deux parties les visites d'aujourd'hui et de demain (UTC,
    heure de Conakry). Sans doublon si la commande est rejouée : à lancer une
    fois par jour, à heure fixe."""
    click.echo(f"{notify.rappeler_visites()} rappel(s) de visite envoyé(s).")
