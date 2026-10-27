"""
tests/test_migrations_rls.py — Une base créée par les migrations naît avec le
RLS actif sur toutes ses tables (lot 1.18).

En production (Supabase), le RLS sans policy ferme les tables de `public` à
tout autre rôle que celui du backend. Ces tests exigent la même chose d'une
base construite uniquement par `flask db upgrade`, y compris pour les tables
qu'ajouteront les révisions futures.

PostgreSQL seulement : SQLite n'a pas de RLS. Les tests tournent quand
TCHEYNA_TEST_POSTGRES_URL désigne une base d'administration (en CI, le
service PostgreSQL 16 du job backend) ; ils créent leur propre base jetable,
au nom unique, et la suppriment à la fin. Sans cette variable, ils sont
ignorés.

Le garde-fou réseau de conftest.py ne gêne pas : psycopg2 passe par libpq,
qui ouvre ses connexions sans les sockets Python.
"""
import logging.config
import os
import uuid

import psycopg2
import pytest
from alembic.config import Config as ConfigAlembic
from alembic.script import ScriptDirectory
from flask_migrate import downgrade, upgrade
from sqlalchemy import create_engine, make_url, text

from app import create_app, db
from config import TestingConfig

DOSSIER_MIGRATIONS = os.path.join(os.path.dirname(os.path.dirname(__file__)), "migrations")
URL_ADMIN = os.environ.get("TCHEYNA_TEST_POSTGRES_URL", "")
REVISION_PRECEDENTE = "694ce1497b2e"  # dernière révision sans RLS

pytestmark = pytest.mark.skipif(
    not URL_ADMIN,
    reason="TCHEYNA_TEST_POSTGRES_URL absente : aucune base PostgreSQL de test "
           "(ex. postgresql://postgres@localhost:5432/postgres)")

TABLES_SANS_RLS = text(
    "SELECT c.relname FROM pg_catalog.pg_class c "
    "JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace "
    "WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity "
    "ORDER BY c.relname")
TABLES_AVEC_RLS = text(
    "SELECT c.relname FROM pg_catalog.pg_class c "
    "JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace "
    "WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity")


@pytest.fixture
def app_postgres(monkeypatch):
    """Application sur une base PostgreSQL vide, créée pour le test : seules
    les migrations la construisent (aucun `create_all`)."""
    # env.py reconfigure le logging à chaque exécution, ce qui désactiverait
    # les loggers des tests suivants.
    monkeypatch.setattr(logging.config, "fileConfig", lambda *_a, **_k: None)

    nom_base = f"tcheyna_test_rls_{uuid.uuid4().hex[:12]}"
    # CREATE/DROP DATABASE refusent de tourner dans une transaction.
    admin = create_engine(URL_ADMIN, isolation_level="AUTOCOMMIT")
    with admin.connect() as connexion:
        connexion.execute(text(f'CREATE DATABASE "{nom_base}"'))

    class ConfigPostgres(TestingConfig):
        SQLALCHEMY_DATABASE_URI = make_url(URL_ADMIN).set(database=nom_base).render_as_string(
            hide_password=False)

    try:
        application = create_app(ConfigPostgres)
        with application.app_context():
            yield application
            db.session.remove()
            db.engine.dispose()
    finally:
        with admin.connect() as connexion:
            connexion.execute(text(f'DROP DATABASE IF EXISTS "{nom_base}" WITH (FORCE)'))
        admin.dispose()


def _tables(requete):
    with db.engine.connect() as connexion:
        return list(connexion.execute(requete).scalars())


def test_aucune_table_de_public_sans_rls_apres_upgrade(app_postgres):
    upgrade(directory=DOSSIER_MIGRATIONS)

    assert _tables(TABLES_SANS_RLS) == []
    # La requête porte bien sur les tables créées : toutes celles des modèles,
    # plus alembic_version.
    assert set(_tables(TABLES_AVEC_RLS)) == set(db.metadata.tables) | {"alembic_version"}


def test_revision_rls_idempotente(app_postgres):
    """Une base déjà protégée en partie (comme la production, protégée à la
    main) monte sans erreur ; le retour arrière laisse le RLS en place et la
    révision se réapplique."""
    upgrade(directory=DOSSIER_MIGRATIONS, revision=REVISION_PRECEDENTE)
    assert "users" in _tables(TABLES_SANS_RLS)
    with db.engine.begin() as connexion:
        connexion.execute(text("ALTER TABLE public.users ENABLE ROW LEVEL SECURITY"))
        connexion.execute(text("ALTER TABLE public.alembic_version ENABLE ROW LEVEL SECURITY"))

    upgrade(directory=DOSSIER_MIGRATIONS)
    assert _tables(TABLES_SANS_RLS) == []

    # Désactiver ouvrirait les tables à la clé publique : le RLS reste.
    downgrade(directory=DOSSIER_MIGRATIONS, revision=REVISION_PRECEDENTE)
    assert _tables(TABLES_SANS_RLS) == []
    with db.engine.connect() as connexion:
        assert connexion.execute(text("SELECT version_num FROM alembic_version")).scalar() == (
            REVISION_PRECEDENTE)

    upgrade(directory=DOSSIER_MIGRATIONS)
    assert _tables(TABLES_SANS_RLS) == []


def test_sql_hors_ligne_applicable_tel_quel(app_postgres, capsys):
    """Le script de `flask db upgrade --sql`, celui qu'on colle dans le SQL
    Editor de Supabase, s'exécute sans retouche et protège toutes les tables."""
    upgrade(directory=DOSSIER_MIGRATIONS, revision=REVISION_PRECEDENTE)
    capsys.readouterr()

    upgrade(directory=DOSSIER_MIGRATIONS, revision=f"{REVISION_PRECEDENTE}:head", sql=True)
    script = capsys.readouterr().out
    assert "ENABLE ROW LEVEL SECURITY" in script

    # Exécuté tel quel, comme dans le SQL Editor : sans arguments, psycopg2 ne
    # touche pas au texte (un `%%` resterait `%%`), BEGIN et COMMIT compris.
    connexion = psycopg2.connect(app_postgres.config["SQLALCHEMY_DATABASE_URI"])
    try:
        connexion.autocommit = True
        with connexion.cursor() as curseur:
            curseur.execute(script)
    finally:
        connexion.close()

    assert _tables(TABLES_SANS_RLS) == []
    config_alembic = ConfigAlembic()
    config_alembic.set_main_option("script_location", DOSSIER_MIGRATIONS)
    tete = ScriptDirectory.from_config(config_alembic).get_current_head()
    with db.engine.connect() as connexion:
        assert connexion.execute(text("SELECT version_num FROM alembic_version")).scalar() == tete
