"""Live PostgreSQL constraint, cascade, soft-delete, and limit-bound integration tests."""

import os
import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from heh_api.infrastructure.db import to_sqlalchemy_postgres_dsn
from heh_api.infrastructure.models import SavedSearchRow, UserPreferenceRow, UserRow
from heh_api.infrastructure.repositories.history import (
    create_user,
    list_saved_searches_for_owner,
    save_user_search,
)


@pytest.mark.integration
def test_postgres_constraints_cascade_soft_delete_and_list_bounds() -> None:
    """Verify DB constraints, cascade deletes, soft-delete hiding, and list limits."""
    raw_dsn = os.environ.get("HEH_DATABASE_URL") or os.environ.get("DATABASE_URL")
    assert raw_dsn, "HEH_DATABASE_URL or DATABASE_URL must be set for integration tests"

    engine = create_engine(to_sqlalchemy_postgres_dsn(raw_dsn), future=True)
    subject = f"audit-sub-{uuid.uuid4()}"
    created_user_id: uuid.UUID | None = None

    try:
        with Session(engine) as session:
            user = create_user(session, subject)
            created_user_id = user.id
            session.commit()

            # Duplicate auth_provider_sub must violate uq_users_auth_provider_sub.
            with pytest.raises(IntegrityError):
                create_user(session, subject)
            session.rollback()

            # Invalid theme_preference must violate ck_user_preferences_theme.
            session.add(
                UserPreferenceRow(
                    user_id=created_user_id,
                    history_sync_enabled=True,
                    locale="tr-TR",
                    theme_preference="purple",
                )
            )
            with pytest.raises(IntegrityError):
                session.commit()
            session.rollback()

            # Valid theme preference and saved search persist cleanly.
            session.add(
                UserPreferenceRow(
                    user_id=created_user_id,
                    history_sync_enabled=True,
                    locale="tr-TR",
                    theme_preference="system",
                )
            )
            save_user_search(
                session,
                owner_user_id=created_user_id,
                query_text="siyah mont",
                canonical_criteria={"criteria": []},
                schema_version="2.0",
                parser_version="m0.1",
            )
            session.commit()

            # Blank query_text violates char_length >= 1 CHECK constraint.
            session.add(
                SavedSearchRow(
                    user_id=created_user_id,
                    query_text="",
                    canonical_criteria={"criteria": []},
                    schema_version="2.0",
                    parser_version="m0.1",
                )
            )
            with pytest.raises(IntegrityError):
                session.commit()
            session.rollback()

            # Limit clamping works cleanly across out-of-range callers.
            assert (
                len(list_saved_searches_for_owner(session, owner_user_id=created_user_id, limit=0))
                == 1
            )
            assert (
                len(
                    list_saved_searches_for_owner(session, owner_user_id=created_user_id, limit=500)
                )
                == 1
            )

            # Soft-deleted user rows must not be surfaced.
            refreshed = session.get(UserRow, created_user_id)
            assert refreshed is not None
            refreshed.deleted_at = datetime.now(UTC)
            session.commit()
            assert list_saved_searches_for_owner(session, owner_user_id=created_user_id) == []

            # Hard deletion cascades saved_searches and user_preferences cleanly.
            session.delete(refreshed)
            session.commit()
            assert (
                session.scalar(
                    select(SavedSearchRow).where(SavedSearchRow.user_id == created_user_id)
                )
                is None
            )
            assert (
                session.scalar(
                    select(UserPreferenceRow).where(UserPreferenceRow.user_id == created_user_id)
                )
                is None
            )
            created_user_id = None
    finally:
        if created_user_id is not None:
            with Session(engine) as cleanup:
                leftover = cleanup.get(UserRow, created_user_id)
                if leftover is not None:
                    cleanup.delete(leftover)
                    cleanup.commit()
        engine.dispose()
