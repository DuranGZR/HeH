"""Initial PostgreSQL schema for accounts, opt-in cloud history, privacy, and mapping audit.

Revision ID: 20261124_0001
Revises: None
Create Date: 2026-11-24 21:10:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "20261124_0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create initial non-hot-path PostgreSQL tables and indexes."""
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("auth_provider_sub", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deletion_requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("auth_provider_sub", name="uq_users_auth_provider_sub"),
    )

    op.create_table(
        "saved_searches",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("query_text", sa.Text(), nullable=False),
        sa.Column("canonical_criteria", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("schema_version", sa.Text(), nullable=False),
        sa.Column("parser_version", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "char_length(query_text) >= 1 AND char_length(query_text) <= 500",
            name="ck_saved_searches_query_length",
        ),
    )
    op.create_index(
        "ix_saved_searches_user_created",
        "saved_searches",
        ["user_id", sa.text("created_at DESC")],
        unique=False,
    )

    op.create_table(
        "user_preferences",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "history_sync_enabled",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("locale", sa.Text(), server_default=sa.text("'tr-TR'"), nullable=False),
        sa.Column(
            "theme_preference",
            sa.Text(),
            server_default=sa.text("'system'"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "theme_preference IN ('system', 'light', 'dark')",
            name="ck_user_preferences_theme",
        ),
    )

    op.create_table(
        "filter_mapping_releases",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("provider", sa.Text(), nullable=False),
        sa.Column("category_key", sa.Text(), nullable=False),
        sa.Column("version", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "status IN ('draft', 'verified', 'disabled')",
            name="ck_filter_mapping_releases_status",
        ),
        sa.UniqueConstraint(
            "provider", "category_key", "version", name="uq_mapping_release_version"
        ),
    )

    op.create_table(
        "filter_mapping_entries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "release_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("filter_mapping_releases.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("field", sa.Text(), nullable=False),
        sa.Column("operator", sa.Text(), nullable=False),
        sa.Column("canonical_value", sa.Text(), nullable=False),
        sa.Column("url_parameter", sa.Text(), nullable=False),
        sa.Column("url_value", sa.Text(), nullable=False),
        sa.Column("verification_status", sa.Text(), nullable=False),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("evidence_reference", sa.Text(), nullable=False),
        sa.Column("test_platform", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "privacy_deletion_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "requested_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("error_code", sa.Text(), nullable=True),
    )

    op.create_table(
        "redirect_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("timestamp_bucket", sa.DateTime(timezone=True), nullable=False),
        sa.Column("platform", sa.Text(), nullable=False),
        sa.Column("outcome", sa.Text(), nullable=False),
        sa.Column("mapping_version", sa.Text(), nullable=False),
        sa.Column("category_bucket", sa.Text(), nullable=False),
    )


def downgrade() -> None:
    """Drop initial tables cleanly in reverse dependency order."""
    op.drop_table("redirect_events")
    op.drop_table("privacy_deletion_requests")
    op.drop_table("filter_mapping_entries")
    op.drop_table("filter_mapping_releases")
    op.drop_table("user_preferences")
    op.drop_index("ix_saved_searches_user_created", table_name="saved_searches")
    op.drop_table("saved_searches")
    op.drop_table("users")
