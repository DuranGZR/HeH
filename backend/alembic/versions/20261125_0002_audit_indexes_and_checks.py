"""Add missing FK indexes and status/platform CHECK constraints.

Revision ID: 20261125_0002
Revises: 20261124_0001
Create Date: 2026-11-25 15:05:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261125_0002"
down_revision: str | Sequence[str] | None = "20261124_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create missing FK/time-bucket indexes and enforce enum-domain CHECK constraints."""
    op.create_index(
        "ix_filter_mapping_entries_release_id",
        "filter_mapping_entries",
        ["release_id"],
        unique=False,
    )
    op.create_index(
        "ix_privacy_deletion_requests_user_id",
        "privacy_deletion_requests",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        "ix_redirect_events_timestamp_bucket",
        "redirect_events",
        [sa.text("timestamp_bucket DESC")],
        unique=False,
    )
    op.create_check_constraint(
        "ck_filter_mapping_entries_status",
        "filter_mapping_entries",
        "verification_status IN ('FILTER_VERIFIED', 'WEB_VERIFIED_PENDING_MOBILE', "
        "'QUERY_ONLY', 'UNSUPPORTED', 'UNKNOWN')",
    )
    op.create_check_constraint(
        "ck_filter_mapping_entries_platform",
        "filter_mapping_entries",
        "test_platform IN ('web', 'mobile')",
    )
    op.create_check_constraint(
        "ck_privacy_deletion_requests_status",
        "privacy_deletion_requests",
        "status IN ('pending', 'processing', 'completed', 'failed')",
    )
    op.create_check_constraint(
        "ck_redirect_events_platform",
        "redirect_events",
        "platform IN ('ios', 'android', 'web')",
    )
    op.create_check_constraint(
        "ck_redirect_events_outcome",
        "redirect_events",
        "outcome IN ('opened', 'fallback_copied', 'cancelled', 'failed')",
    )


def downgrade() -> None:
    """Drop audit indexes and CHECK constraints cleanly."""
    op.drop_constraint("ck_redirect_events_outcome", "redirect_events", type_="check")
    op.drop_constraint("ck_redirect_events_platform", "redirect_events", type_="check")
    op.drop_constraint(
        "ck_privacy_deletion_requests_status", "privacy_deletion_requests", type_="check"
    )
    op.drop_constraint(
        "ck_filter_mapping_entries_platform", "filter_mapping_entries", type_="check"
    )
    op.drop_constraint("ck_filter_mapping_entries_status", "filter_mapping_entries", type_="check")
    op.drop_index("ix_redirect_events_timestamp_bucket", table_name="redirect_events")
    op.drop_index("ix_privacy_deletion_requests_user_id", table_name="privacy_deletion_requests")
    op.drop_index("ix_filter_mapping_entries_release_id", table_name="filter_mapping_entries")
