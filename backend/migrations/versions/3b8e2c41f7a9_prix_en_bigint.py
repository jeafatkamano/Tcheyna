"""listings.prix passe en BIGINT.

Revision ID: 3b8e2c41f7a9
Revises: d5a017c5d0f3
Create Date: 2026-10-15

Un INTEGER PostgreSQL plafonne à 2 147 483 647 : une villa à vendre à
3 milliards GNF (≈ 350 000 $) faisait échouer l'insertion (500). Le seed
contient déjà une vente à 1,25 milliard. Élargir le type ne perd aucune
donnée ; l'index ix_listings_prix est reconstruit par PostgreSQL.

`batch_alter_table` : SQLite ne sait pas modifier le type d'une colonne,
Alembic y recrée la table ; sur PostgreSQL, c'est un simple ALTER COLUMN.

Le retour arrière échoue si une annonce dépasse déjà la borne d'un INTEGER :
c'est voulu, il tronquerait un prix.
"""
import sqlalchemy as sa
from alembic import op

# Identifiants de révision, utilisés par Alembic.
revision = "3b8e2c41f7a9"
down_revision = "d5a017c5d0f3"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("listings") as batch_op:
        batch_op.alter_column("prix", existing_type=sa.Integer(), type_=sa.BigInteger(),
                              existing_nullable=False)


def downgrade():
    with op.batch_alter_table("listings") as batch_op:
        batch_op.alter_column("prix", existing_type=sa.BigInteger(), type_=sa.Integer(),
                              existing_nullable=False)
