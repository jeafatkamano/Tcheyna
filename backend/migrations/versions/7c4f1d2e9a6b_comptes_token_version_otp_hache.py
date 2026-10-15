"""Comptes : version des jetons, OTP haché.

Revision ID: 7c4f1d2e9a6b
Revises: 3b8e2c41f7a9
Create Date: 2026-10-15

Lot 1.4. Phase « expansion » d'un changement en deux temps : la révision est
appliquée à la main AVANT le déploiement du nouveau code (migrations/README),
l'ancien code tourne donc quelques minutes sur ce schéma. Rien de ce qu'il
lit ou écrit ne doit casser :

  • users.token_version : NOT NULL avec `server_default '0'`. Les comptes
    existants prennent 0, la version que vaut un jeton sans claim `tv` :
    personne n'est déconnecté par le déploiement.
  • otp_codes.code_hash, otp_codes.phone (indexé) : nullables. Les lignes
    existantes restent à NULL ; le nouveau code refuse une ligne sans
    empreinte (« Demandez un nouveau code ») au lieu de relire le clair.
  • otp_codes.code devient nullable : l'ancien code continue d'y écrire, le
    nouveau n'y écrit plus. Sa purge (`UPDATE … SET code = NULL`) puis sa
    suppression feront l'objet d'une révision ultérieure (« contraction »),
    une fois le nouveau code déployé.

`batch_alter_table` : SQLite ne sait pas rendre une colonne nullable, Alembic
y recrée la table ; sur PostgreSQL, ce sont de simples ALTER TABLE.

Retour arrière : les codes sans clair reçoivent « ------ », qu'aucune saisie
ne peut égaler (6 chiffres exigés) : ils deviennent inutilisables, ce qui est
voulu, l'ancien code ne sachant pas lire une empreinte.
"""
import sqlalchemy as sa
from alembic import op

# Identifiants de révision, utilisés par Alembic.
revision = "7c4f1d2e9a6b"
down_revision = "3b8e2c41f7a9"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("token_version", sa.Integer(), nullable=False,
                                      server_default="0"))

    with op.batch_alter_table("otp_codes") as batch_op:
        batch_op.add_column(sa.Column("code_hash", sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column("phone", sa.String(length=20), nullable=True))
        batch_op.create_index("ix_otp_codes_phone", ["phone"], unique=False)
        batch_op.alter_column("code", existing_type=sa.String(length=6), nullable=True)


def downgrade():
    op.execute("UPDATE otp_codes SET code = '------' WHERE code IS NULL")
    with op.batch_alter_table("otp_codes") as batch_op:
        batch_op.alter_column("code", existing_type=sa.String(length=6), nullable=False)
        batch_op.drop_index("ix_otp_codes_phone")
        batch_op.drop_column("phone")
        batch_op.drop_column("code_hash")

    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("token_version")
