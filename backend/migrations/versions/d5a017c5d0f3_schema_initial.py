"""Schéma initial — état de la base créée jusqu'ici par `db.create_all()`.

Revision ID: d5a017c5d0f3
Revises:
Create Date: 2026-10-15 00:13:01.338679

Générée par autogenerate contre un PostgreSQL 16 local, puis relue. Comparée
(`pg_dump --schema-only`) à un `create_all` sur ce même PostgreSQL 16 local :
identique, noms de contraintes compris. Elle n'a pas été comparée à la base
de production, qui a probablement dérivé des modèles : suivre la procédure
de migrations/README avant tout `flask db stamp`.

Ne pas modifier : toute évolution du schéma passe par une nouvelle révision.
"""
import sqlalchemy as sa
from alembic import op

# Identifiants de révision, utilisés par Alembic.
revision = "d5a017c5d0f3"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # Tables créées dans l'ordre de leurs clés étrangères : une table ne
    # référence que des tables déjà créées.
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("email", sa.String(length=120), nullable=False),
        sa.Column("phone", sa.String(length=20), nullable=True),
        sa.Column("password_hash", sa.String(length=256), nullable=False),
        sa.Column("full_name", sa.String(length=100), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("avatar_url", sa.String(length=300), nullable=True),
        sa.Column("bio", sa.Text(), nullable=True),
        sa.Column("pays", sa.String(length=50), nullable=True),
        sa.Column("ville", sa.String(length=50), nullable=True),
        sa.Column("quartier", sa.String(length=100), nullable=True),
        sa.Column("preferred_lang", sa.String(length=5), nullable=True),
        sa.Column("trust_level", sa.Integer(), nullable=True),
        sa.Column("phone_verified", sa.Boolean(), nullable=True),
        sa.Column("cni_uploaded", sa.Boolean(), nullable=True),
        sa.Column("cni_verified", sa.Boolean(), nullable=True),
        sa.Column("income_verified", sa.Boolean(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=True),
        sa.Column("last_login_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)
    op.create_index(op.f("ix_users_phone"), "users", ["phone"], unique=True)
    op.create_index(op.f("ix_users_role"), "users", ["role"], unique=False)
    op.create_index(op.f("ix_users_trust_level"), "users", ["trust_level"], unique=False)

    op.create_table(
        "listings",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("landlord_id", sa.String(length=36), nullable=False),
        sa.Column("title_fr", sa.String(length=200), nullable=False),
        sa.Column("title_en", sa.String(length=200), nullable=True),
        sa.Column("description_fr", sa.Text(), nullable=False),
        sa.Column("description_en", sa.Text(), nullable=True),
        sa.Column("pays", sa.String(length=50), nullable=False),
        sa.Column("ville", sa.String(length=50), nullable=False),
        sa.Column("quartier", sa.String(length=100), nullable=True),
        sa.Column("adresse", sa.String(length=300), nullable=True),
        sa.Column("type_transaction", sa.String(length=20), nullable=False),
        sa.Column("type_bien", sa.String(length=30), nullable=False),
        sa.Column("prix", sa.Integer(), nullable=False),
        sa.Column("charges", sa.Integer(), nullable=True),
        sa.Column("caution", sa.Integer(), nullable=True),
        sa.Column("devise", sa.String(length=10), nullable=False),
        sa.Column("nb_pieces", sa.Integer(), nullable=True),
        sa.Column("superficie", sa.Float(), nullable=True),
        sa.Column("etage", sa.Integer(), nullable=True),
        sa.Column("meuble", sa.Boolean(), nullable=True),
        sa.Column("disponible_a_partir", sa.Date(), nullable=True),
        sa.Column("has_generator", sa.Boolean(), nullable=True),
        sa.Column("has_water", sa.Boolean(), nullable=True),
        sa.Column("has_wifi", sa.Boolean(), nullable=True),
        sa.Column("is_secured", sa.Boolean(), nullable=True),
        sa.Column("has_parking", sa.Boolean(), nullable=True),
        sa.Column("has_ac", sa.Boolean(), nullable=True),
        sa.Column("certification_status", sa.String(length=20), nullable=True),
        sa.Column("certification_requested_at", sa.DateTime(), nullable=True),
        sa.Column("certified_at", sa.DateTime(), nullable=True),
        sa.Column("certification_note", sa.Text(), nullable=True),
        sa.Column("documents_urls", sa.Text(), nullable=True),
        sa.Column("is_premium", sa.Boolean(), nullable=True),
        sa.Column("premium_until", sa.DateTime(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=True),
        sa.Column("is_visible", sa.Boolean(), nullable=True),
        sa.Column("views_count", sa.Integer(), nullable=True),
        sa.Column("images_urls", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["landlord_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_listings_certification_status"), "listings", ["certification_status"], unique=False)
    op.create_index(op.f("ix_listings_landlord_id"), "listings", ["landlord_id"], unique=False)
    op.create_index(op.f("ix_listings_pays"), "listings", ["pays"], unique=False)
    op.create_index(op.f("ix_listings_prix"), "listings", ["prix"], unique=False)
    op.create_index(op.f("ix_listings_quartier"), "listings", ["quartier"], unique=False)
    op.create_index(op.f("ix_listings_status"), "listings", ["status"], unique=False)
    op.create_index(op.f("ix_listings_type_bien"), "listings", ["type_bien"], unique=False)
    op.create_index(op.f("ix_listings_type_transaction"), "listings", ["type_transaction"], unique=False)
    op.create_index(op.f("ix_listings_ville"), "listings", ["ville"], unique=False)

    op.create_table(
        "notifications",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("type", sa.String(length=40), nullable=False),
        sa.Column("titre", sa.String(length=150), nullable=False),
        sa.Column("contenu", sa.Text(), nullable=True),
        sa.Column("lien", sa.String(length=200), nullable=True),
        sa.Column("read_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_notifications_created_at"), "notifications", ["created_at"], unique=False)
    op.create_index(op.f("ix_notifications_user_id"), "notifications", ["user_id"], unique=False)

    op.create_table(
        "otp_codes",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("code", sa.String(length=6), nullable=False),
        sa.Column("is_used", sa.Boolean(), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_otp_codes_user_id"), "otp_codes", ["user_id"], unique=False)

    op.create_table(
        "tenant_passports",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("tenant_id", sa.String(length=36), nullable=False),
        sa.Column("cni_recto_url", sa.String(length=300), nullable=True),
        sa.Column("cni_verso_url", sa.String(length=300), nullable=True),
        sa.Column("passport_url", sa.String(length=300), nullable=True),
        sa.Column("income_doc_url", sa.String(length=300), nullable=True),
        sa.Column("docs_uploaded", sa.Boolean(), nullable=True),
        sa.Column("income_verified", sa.Boolean(), nullable=True),
        sa.Column("revenu_mensuel", sa.Integer(), nullable=True),
        sa.Column("devise", sa.String(length=10), nullable=True),
        sa.Column("employeur", sa.String(length=100), nullable=True),
        sa.Column("situation_pro", sa.String(length=50), nullable=True),
        sa.Column("a_un_garant", sa.Boolean(), nullable=True),
        sa.Column("garant_nom", sa.String(length=100), nullable=True),
        sa.Column("garant_revenu", sa.Integer(), nullable=True),
        sa.Column("budget_min", sa.Integer(), nullable=True),
        sa.Column("budget_max", sa.Integer(), nullable=True),
        sa.Column("ville_souhaitee", sa.String(length=50), nullable=True),
        sa.Column("quartiers_souhaites", sa.Text(), nullable=True),
        sa.Column("type_bien_souhaite", sa.String(length=30), nullable=True),
        sa.Column("nb_pieces_min", sa.Integer(), nullable=True),
        sa.Column("date_emmenagement", sa.Date(), nullable=True),
        sa.Column("nb_occupants", sa.Integer(), nullable=True),
        sa.Column("score", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id"),
    )

    op.create_table(
        "favorites",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("listing_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["listing_id"], ["listings.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "listing_id", name="uq_favorite_user_listing"),
    )
    op.create_index(op.f("ix_favorites_listing_id"), "favorites", ["listing_id"], unique=False)
    op.create_index(op.f("ix_favorites_user_id"), "favorites", ["user_id"], unique=False)

    op.create_table(
        "matches",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("tenant_id", sa.String(length=36), nullable=False),
        sa.Column("listing_id", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=True),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("score_compatibilite", sa.Integer(), nullable=True),
        sa.Column("visite_date", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["listing_id"], ["listings.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "listing_id", name="uq_match_tenant_listing"),
    )
    op.create_index(op.f("ix_matches_listing_id"), "matches", ["listing_id"], unique=False)
    op.create_index(op.f("ix_matches_status"), "matches", ["status"], unique=False)
    op.create_index(op.f("ix_matches_tenant_id"), "matches", ["tenant_id"], unique=False)

    op.create_table(
        "conversations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("match_id", sa.String(length=36), nullable=False),
        sa.Column("tenant_id", sa.String(length=36), nullable=False),
        sa.Column("landlord_id", sa.String(length=36), nullable=False),
        sa.Column("last_message_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["landlord_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["match_id"], ["matches.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("match_id"),
    )
    op.create_index(op.f("ix_conversations_landlord_id"), "conversations", ["landlord_id"], unique=False)
    op.create_index(op.f("ix_conversations_last_message_at"), "conversations", ["last_message_at"], unique=False)
    op.create_index(op.f("ix_conversations_tenant_id"), "conversations", ["tenant_id"], unique=False)

    op.create_table(
        "payments",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("match_id", sa.String(length=36), nullable=True),
        sa.Column("listing_id", sa.String(length=36), nullable=True),
        sa.Column("reference", sa.String(length=30), nullable=False),
        sa.Column("type_paiement", sa.String(length=30), nullable=False),
        sa.Column("description", sa.String(length=200), nullable=True),
        sa.Column("montant", sa.Integer(), nullable=False),
        sa.Column("commission", sa.Integer(), nullable=True),
        sa.Column("devise", sa.String(length=10), nullable=False),
        sa.Column("methode", sa.String(length=30), nullable=True),
        sa.Column("cinetpay_transaction_id", sa.String(length=100), nullable=True),
        sa.Column("cinetpay_token", sa.String(length=200), nullable=True),
        sa.Column("cinetpay_operator_id", sa.String(length=100), nullable=True),
        sa.Column("statut", sa.String(length=20), nullable=True),
        sa.Column("paid_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["listing_id"], ["listings.id"]),
        sa.ForeignKeyConstraint(["match_id"], ["matches.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_payments_cinetpay_transaction_id"), "payments", ["cinetpay_transaction_id"], unique=False)
    op.create_index(op.f("ix_payments_match_id"), "payments", ["match_id"], unique=False)
    op.create_index(op.f("ix_payments_reference"), "payments", ["reference"], unique=True)
    op.create_index(op.f("ix_payments_statut"), "payments", ["statut"], unique=False)
    op.create_index(op.f("ix_payments_user_id"), "payments", ["user_id"], unique=False)

    op.create_table(
        "reviews",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("reviewer_id", sa.String(length=36), nullable=False),
        sa.Column("target_id", sa.String(length=36), nullable=False),
        sa.Column("match_id", sa.String(length=36), nullable=True),
        sa.Column("note", sa.Integer(), nullable=False),
        sa.Column("commentaire", sa.Text(), nullable=True),
        sa.Column("type_avis", sa.String(length=20), nullable=False),
        sa.Column("is_positive", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["match_id"], ["matches.id"]),
        sa.ForeignKeyConstraint(["reviewer_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["target_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("reviewer_id", "match_id", name="uq_review_reviewer_match"),
    )
    op.create_index(op.f("ix_reviews_reviewer_id"), "reviews", ["reviewer_id"], unique=False)
    op.create_index(op.f("ix_reviews_target_id"), "reviews", ["target_id"], unique=False)

    op.create_table(
        "messages",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("conversation_id", sa.String(length=36), nullable=False),
        sa.Column("sender_id", sa.String(length=36), nullable=False),
        sa.Column("contenu", sa.Text(), nullable=False),
        sa.Column("read_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"]),
        sa.ForeignKeyConstraint(["sender_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_messages_conversation_id"), "messages", ["conversation_id"], unique=False)
    op.create_index(op.f("ix_messages_created_at"), "messages", ["created_at"], unique=False)


def downgrade():
    # Ordre inverse de la création : une table n'est supprimée qu'une fois
    # disparues celles qui la référencent. Les index partent avec leur table.
    op.drop_table("messages")
    op.drop_table("reviews")
    op.drop_table("payments")
    op.drop_table("conversations")
    op.drop_table("matches")
    op.drop_table("favorites")
    op.drop_table("tenant_passports")
    op.drop_table("otp_codes")
    op.drop_table("notifications")
    op.drop_table("listings")
    op.drop_table("users")
