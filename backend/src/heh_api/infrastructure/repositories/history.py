"""Owner-scoped PostgreSQL repository for saved searches (`T-02` IDOR protection)."""

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from heh_api.infrastructure.models import SavedSearchRow, UserRow


def create_user(session: Session, auth_provider_sub: str) -> UserRow:
    """Create and flush a user record keyed by external OIDC/OTP subject."""
    row = UserRow(auth_provider_sub=auth_provider_sub)
    session.add(row)
    session.flush()
    return row


def save_user_search(
    session: Session,
    *,
    owner_user_id: uuid.UUID,
    query_text: str,
    canonical_criteria: dict[str, Any],
    schema_version: str,
    parser_version: str,
) -> SavedSearchRow:
    """Persist an opt-in saved search bound strictly to `owner_user_id`."""
    row = SavedSearchRow(
        user_id=owner_user_id,
        query_text=query_text,
        canonical_criteria=canonical_criteria,
        schema_version=schema_version,
        parser_version=parser_version,
    )
    session.add(row)
    session.flush()
    return row


def list_saved_searches_for_owner(
    session: Session,
    *,
    owner_user_id: uuid.UUID,
    limit: int = 50,
) -> list[SavedSearchRow]:
    """Return newest saved searches owned exclusively by `owner_user_id`."""
    stmt = (
        select(SavedSearchRow)
        .where(SavedSearchRow.user_id == owner_user_id)
        .order_by(SavedSearchRow.created_at.desc())
        .limit(limit)
    )
    return list(session.scalars(stmt).all())


def get_saved_search_for_owner(
    session: Session,
    *,
    owner_user_id: uuid.UUID,
    search_id: uuid.UUID,
) -> SavedSearchRow | None:
    """Fetch a single saved search only if owned by `owner_user_id`."""
    stmt = select(SavedSearchRow).where(
        SavedSearchRow.id == search_id,
        SavedSearchRow.user_id == owner_user_id,
    )
    return session.scalar(stmt)


def delete_saved_search_for_owner(
    session: Session,
    *,
    owner_user_id: uuid.UUID,
    search_id: uuid.UUID,
) -> bool:
    """Delete a saved search only if owned by `owner_user_id`; return True if deleted."""
    row = get_saved_search_for_owner(
        session,
        owner_user_id=owner_user_id,
        search_id=search_id,
    )
    if row is None:
        return False
    session.delete(row)
    session.flush()
    return True
