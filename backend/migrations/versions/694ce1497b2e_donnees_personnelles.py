"""Données personnelles : journal des vérifications, suppressions de fichiers.

Revision ID: 694ce1497b2e
Revises: 7c4f1d2e9a6b
Create Date: 2026-10-15

Lot 1.5. Uniquement des ajouts (tables et colonnes nullables) : l'ancien
code tourne sans rien remarquer entre la migration et le déploiement.

  • verifications : une ligne par décision du back-office (acteur, cible,
    objet, décision, motif, date) ;
  • fichiers_a_supprimer : fichiers dont la référence a quitté la base et
    qui doivent encore disparaître du stockage ;
  • tenant_passports.identite_deposee_le / revenus_deposes_le : point de
    départ de la durée de conservation d'une pièce sans décision (D5) ;
  • users.supprime_le : compte supprimé (anonymisé) par son titulaire.

Les pièces déjà en base reçoivent comme date de dépôt `updated_at` du
passeport, postérieure ou égale au dépôt réel : une purge future ne peut
donc pas les supprimer plus tôt que la durée fixée.

Retour arrière : le journal des décisions et la file des suppressions en
attente sont perdus.
"""
import sqlalchemy as sa
from alembic import op

# Identifiants de révision, utilisés par Alembic.
revision = "694ce1497b2e"
down_revision = "7c4f1d2e9a6b"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "fichiers_a_supprimer",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("reference", sa.String(length=300), nullable=False),
        sa.Column("origine", sa.String(length=40), nullable=False),
        sa.Column("tentatives", sa.Integer(), server_default="0", nullable=False),
        sa.Column("derniere_tentative", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "verifications",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("acteur_id", sa.String(length=36), nullable=True),
        sa.Column("cible_id", sa.String(length=36), nullable=False),
        sa.Column("objet", sa.String(length=30), nullable=False),
        sa.Column("decision", sa.String(length=20), nullable=False),
        sa.Column("motif", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["acteur_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_verifications_acteur_id", "verifications", ["acteur_id"], unique=False)
    op.create_index("ix_verifications_cible_id", "verifications", ["cible_id"], unique=False)
    op.create_index("ix_verifications_created_at", "verifications", ["created_at"], unique=False)

    with op.batch_alter_table("tenant_passports") as batch_op:
        batch_op.add_column(sa.Column("identite_deposee_le", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("revenus_deposes_le", sa.DateTime(), nullable=True))

    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("supprime_le", sa.DateTime(), nullable=True))

    op.execute(
        "UPDATE tenant_passports SET identite_deposee_le = COALESCE(updated_at, created_at) "
        "WHERE cni_recto_url IS NOT NULL OR cni_verso_url IS NOT NULL OR passport_url IS NOT NULL")
    op.execute(
        "UPDATE tenant_passports SET revenus_deposes_le = COALESCE(updated_at, created_at) "
        "WHERE income_doc_url IS NOT NULL")


def downgrade():
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("supprime_le")

    with op.batch_alter_table("tenant_passports") as batch_op:
        batch_op.drop_column("revenus_deposes_le")
        batch_op.drop_column("identite_deposee_le")

    op.drop_index("ix_verifications_created_at", table_name="verifications")
    op.drop_index("ix_verifications_cible_id", table_name="verifications")
    op.drop_index("ix_verifications_acteur_id", table_name="verifications")
    op.drop_table("verifications")
    op.drop_table("fichiers_a_supprimer")
