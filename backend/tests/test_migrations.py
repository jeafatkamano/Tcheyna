"""
tests/test_migrations.py — Les migrations Alembic décrivent bien les modèles.

Si un modèle change sans migration (ou l'inverse), la base de production,
qui n'évolue que par `flask db upgrade`, divergerait silencieusement du code.
Ce test applique toutes les migrations sur une base SQLite vierge et exige
qu'elle corresponde exactement à `db.metadata`.

Le même contrôle tourne en CI contre PostgreSQL 16 (`flask db check`), pour
les types propres au moteur de production.
"""
import logging.config
import os

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from flask_migrate import downgrade, upgrade
from sqlalchemy import inspect

from app import create_app, db
from config import TestingConfig

DOSSIER_MIGRATIONS = os.path.join(os.path.dirname(os.path.dirname(__file__)), "migrations")


@pytest.fixture
def app_migree(tmp_path, monkeypatch):
    """Application sur une base SQLite fichier, vide : seules les migrations
    la construisent (aucun `create_all`)."""
    # env.py reconfigure le logging à chaque exécution, ce qui désactiverait
    # les loggers des tests suivants.
    monkeypatch.setattr(logging.config, "fileConfig", lambda *_a, **_k: None)

    class ConfigMigration(TestingConfig):
        SQLALCHEMY_DATABASE_URI = f"sqlite:///{tmp_path / 'migree.sqlite'}"

    application = create_app(ConfigMigration)
    with application.app_context():
        upgrade(directory=DOSSIER_MIGRATIONS)
        yield application
        db.session.remove()
        db.engine.dispose()


def test_tables_et_colonnes_identiques_aux_modeles(app_migree):
    inspecteur = inspect(db.engine)

    tables_base = set(inspecteur.get_table_names()) - {"alembic_version"}
    assert tables_base == set(db.metadata.tables)

    for nom, table in db.metadata.tables.items():
        colonnes_base = {c["name"]: c for c in inspecteur.get_columns(nom)}
        assert set(colonnes_base) == set(table.columns.keys()), f"colonnes divergentes : {nom}"
        for colonne in table.columns:
            assert colonnes_base[colonne.name]["nullable"] == colonne.nullable, (
                f"{nom}.{colonne.name} : nullable divergent")

        index_base = {i["name"] for i in inspecteur.get_indexes(nom)}
        assert index_base == {i.name for i in table.indexes}, f"index divergents : {nom}"


def test_autogenerate_ne_detecte_aucune_derive(app_migree):
    # Exactement ce que ferait `flask db migrate` : si la liste n'est pas vide,
    # un changement de modèle attend encore sa migration.
    with db.engine.connect() as connexion:
        differences = compare_metadata(MigrationContext.configure(connexion), db.metadata)

    assert differences == []


def test_downgrade_jusqu_a_la_base_vide(app_migree):
    downgrade(directory=DOSSIER_MIGRATIONS, revision="base")

    assert set(inspect(db.engine).get_table_names()) <= {"alembic_version"}
