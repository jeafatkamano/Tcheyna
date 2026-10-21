"""RLS activé sur toutes les tables du schéma public.

Revision ID: 4506c18d7fd6
Revises: 694ce1497b2e
Create Date: 2026-10-21

Lot 1.18. Supabase expose le schéma `public` par son API REST (PostgREST)
aux rôles `anon` et `authenticated` : une table sans RLS y est lisible et
modifiable avec la seule clé publique. Seul le backend, connecté en
`postgres` (propriétaire des tables, donc non soumis au RLS), doit y
accéder : le RLS est activé SANS aucune policy, ce qui ferme les tables à
tous les autres rôles.

En production, c'est déjà le cas (activé à la main dans Supabase) : cette
révision n'y change rien et ne fait que mettre `alembic_version` à jour.
Elle sert aux bases créées par `flask db upgrade` (nouvel environnement,
reconstruction), qui naissaient jusqu'ici sans aucun RLS.

Le bloc parcourt `pg_class` au lieu de nommer les tables : toute table
ordinaire ou partitionnée de `public` encore sans RLS est couverte,
`alembic_version` comprise, et une table où il est déjà actif est sautée
(révision idempotente, sans erreur sur une base partiellement protégée).
Chaque future révision qui crée une table doit activer le RLS elle-même :
tests/test_migrations_rls.py échoue sinon.

`quote_ident` plutôt que `format('… %I …')` : aucun `%` dans le SQL, que
SQLAlchemy double (`%%`) en mode hors ligne, ce qui casserait le script
collé dans le SQL Editor de Supabase.

PostgreSQL seulement : SQLite n'a pas de RLS, la révision n'y fait rien.
Le test porte sur le dialecte et non sur une connexion : il vaut aussi en
mode hors ligne (`flask db upgrade --sql`).

Retour arrière : sans effet, volontairement. Désactiver le RLS ouvrirait
les tables à la clé publique de Supabase ; et la révision ne sait pas
quelles tables étaient protégées avant elle (en production : toutes).
"""
from alembic import op

# Identifiants de révision, utilisés par Alembic.
revision = "4506c18d7fd6"
down_revision = "694ce1497b2e"
branch_labels = None
depends_on = None


ACTIVER_RLS = """
DO $$
DECLARE
    nom_table text;
BEGIN
    FOR nom_table IN
        SELECT c.relname
        FROM pg_catalog.pg_class c
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p')
          AND NOT c.relrowsecurity
    LOOP
        EXECUTE 'ALTER TABLE public.' || quote_ident(nom_table) || ' ENABLE ROW LEVEL SECURITY';
    END LOOP;
END
$$"""


def upgrade():
    if op.get_context().dialect.name == "postgresql":
        op.execute(ACTIVER_RLS)


def downgrade():
    # Voir la docstring : le RLS reste actif.
    pass
