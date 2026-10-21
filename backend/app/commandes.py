"""
app/commandes.py — Commandes d'exploitation (`flask donnees …`).

À lancer à la main ou par une tâche planifiée (Render Cron Job) : aucune
n'est déclenchée automatiquement par l'application.
"""
import click
from flask.cli import AppGroup

from app.services import donnees_personnelles as dp

donnees_cli = AppGroup("donnees", help="Conservation et suppression des données personnelles.")


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
