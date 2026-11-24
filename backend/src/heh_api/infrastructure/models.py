"""SQLAlchemy 2.x PostgreSQL persistence models (isolated from core search domain)."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Base declarative class for non-hot-path PostgreSQL entities."""


class UserRow(Base):
    """Account identity linked solely to external OIDC/OTP subject claim."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    auth_provider_sub: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    deletion_requested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SavedSearchRow(Base):
    """Opt-in user-saved cloud search record isolated strictly by owner user_id."""

    __tablename__ = "saved_searches"
    __table_args__ = (
        CheckConstraint(
            "char_length(query_text) >= 1 AND char_length(query_text) <= 500",
            name="ck_saved_searches_query_length",
        ),
        Index("ix_saved_searches_user_created", "user_id", text("created_at DESC")),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    query_text: Mapped[str] = mapped_column(Text, nullable=False)
    canonical_criteria: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    schema_version: Mapped[str] = mapped_column(Text, nullable=False)
    parser_version: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )


class UserPreferenceRow(Base):
    """Explicit account privacy and UI preferences."""

    __tablename__ = "user_preferences"
    __table_args__ = (
        CheckConstraint(
            "theme_preference IN ('system', 'light', 'dark')",
            name="ck_user_preferences_theme",
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    history_sync_enabled: Mapped[bool] = mapped_column(
        Boolean, server_default=text("false"), nullable=False
    )
    locale: Mapped[str] = mapped_column(Text, server_default=text("'tr-TR'"), nullable=False)
    theme_preference: Mapped[str] = mapped_column(
        Text, server_default=text("'system'"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )


class FilterMappingReleaseRow(Base):
    """Offline audit release record for filter mapping governance."""

    __tablename__ = "filter_mapping_releases"
    __table_args__ = (
        CheckConstraint(
            "status IN ('draft', 'verified', 'disabled')",
            name="ck_filter_mapping_releases_status",
        ),
        UniqueConstraint("provider", "category_key", "version", name="uq_mapping_release_version"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    category_key: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class FilterMappingEntryRow(Base):
    """Offline verification audit entry tied to a filter mapping release."""

    __tablename__ = "filter_mapping_entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    release_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("filter_mapping_releases.id", ondelete="CASCADE"),
        nullable=False,
    )
    field: Mapped[str] = mapped_column(Text, nullable=False)
    operator: Mapped[str] = mapped_column(Text, nullable=False)
    canonical_value: Mapped[str] = mapped_column(Text, nullable=False)
    url_parameter: Mapped[str] = mapped_column(Text, nullable=False)
    url_value: Mapped[str] = mapped_column(Text, nullable=False)
    verification_status: Mapped[str] = mapped_column(Text, nullable=False)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    evidence_reference: Mapped[str] = mapped_column(Text, nullable=False)
    test_platform: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PrivacyDeletionRequestRow(Base):
    """Auditable account/history deletion request state tracker."""

    __tablename__ = "privacy_deletion_requests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()"), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    error_code: Mapped[str | None] = mapped_column(Text, nullable=True)


class RedirectEventRow(Base):
    """Aggregate anonymous redirect telemetry bucket (zero raw query, URL, or user_id)."""

    __tablename__ = "redirect_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    timestamp_bucket: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    platform: Mapped[str] = mapped_column(Text, nullable=False)
    outcome: Mapped[str] = mapped_column(Text, nullable=False)
    mapping_version: Mapped[str] = mapped_column(Text, nullable=False)
    category_bucket: Mapped[str] = mapped_column(Text, nullable=False)
