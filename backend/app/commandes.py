"""
app/commandes.py — Commandes d'exploitation (`flask donnees …`, `flask visites …`).

À lancer à la main ou par une tâche planifiée (Render Cron Job) : aucune
n'est déclenchée automatiquement par l'application.
"""
import click
from flask.cli import AppGroup

from app.services import donnees_personnelles as dp
from app.services import notifications as notify

donnees_cli = AppGroup("donnees", help="Conservation et suppression des données personnelles.")
visites_cli = AppGroup("visites", help="Suivi des visites planifiées.")


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


@visites_cli.command("rappeler")
def rappeler_visites():
    """Rappelle aux deux parties les visites d'aujourd'hui et de demain (UTC,
    heure de Conakry). Sans doublon si la commande est rejouée : à lancer une
    fois par jour, à heure fixe."""
    click.echo(f"{notify.rappeler_visites()} rappel(s) de visite envoyé(s).")
