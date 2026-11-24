"""PostgreSQL Alembic migration and per-user row ownership integration tests."""

import os
import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from heh_api.infrastructure.db import to_sqlalchemy_postgres_dsn
from heh_api.infrastructure.repositories.history import (
    create_user,
    delete_saved_search_for_owner,
    get_saved_search_for_owner,
    list_saved_searches_for_owner,
    save_user_search,
)

_BACKEND_DIR = Path(__file__).resolve().parents[2]


def _alembic_config(sqlalchemy_url: str) -> Config:
    cfg = Config(str(_BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(_BACKEND_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", sqlalchemy_url)
    return cfg


@pytest.mark.integration
def test_alembic_single_head_upgrade_downgrade_and_row_ownership() -> None:
    """Verify clean migration upgrade/downgrade cycle and strict user_id ownership isolation."""
    raw_dsn = os.environ.get("HEH_DATABASE_URL") or os.environ.get("DATABASE_URL")
    assert raw_dsn, "HEH_DATABASE_URL or DATABASE_URL must be set for migration integration test"
    sa_url = to_sqlalchemy_postgres_dsn(raw_dsn)
    cfg = _alembic_config(sa_url)

    # Guard against accidental branched/broken Alembic migration graphs
    script = ScriptDirectory.from_config(cfg)
    assert len(script.get_heads()) == 1

    # Fresh clean downgrade -> upgrade lifecycle
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")

    engine = create_engine(sa_url)
    try:
        inspector = inspect(engine)
        table_names = set(inspector.get_table_names())
        assert {
            "users",
            "saved_searches",
            "user_preferences",
            "filter_mapping_releases",
            "filter_mapping_entries",
            "privacy_deletion_requests",
            "redirect_events",
            "alembic_version",
        }.issubset(table_names)

        indexes = {idx["name"] for idx in inspector.get_indexes("saved_searches")}
        assert "ix_saved_searches_user_created" in indexes

        # Row ownership isolation + query_text check constraint verification
        with Session(engine) as session:
            owner_a = create_user(session, f"sub-a-{uuid.uuid4()}")
            owner_b = create_user(session, f"sub-b-{uuid.uuid4()}")

            saved = save_user_search(
                session,
                owner_user_id=owner_a.id,
                query_text="3000 altı siyah erkek mont",
                canonical_criteria={"criteria": [], "schema_version": "2.0.0"},
                schema_version="2.0.0",
                parser_version="1.0.0",
            )
            session.commit()

            # Owner B cannot read or delete Owner A's search (IDOR protection T-02)
            assert (
                get_saved_search_for_owner(session, owner_user_id=owner_b.id, search_id=saved.id)
                is None
            )
            assert (
                delete_saved_search_for_owner(session, owner_user_id=owner_b.id, search_id=saved.id)
                is False
            )
            assert list_saved_searches_for_owner(session, owner_user_id=owner_b.id) == []

            # Owner A owns and can read/delete cleanly
            assert (
                get_saved_search_for_owner(session, owner_user_id=owner_a.id, search_id=saved.id)
                is not None
            )

            # Query >500 chars violates PostgreSQL CHECK constraint
            with pytest.raises(IntegrityError):
                save_user_search(
                    session,
                    owner_user_id=owner_a.id,
                    query_text="x" * 501,
                    canonical_criteria={},
                    schema_version="2.0.0",
                    parser_version="1.0.0",
                )
            session.rollback()

            assert (
                delete_saved_search_for_owner(session, owner_user_id=owner_a.id, search_id=saved.id)
                is True
            )
            session.commit()
    finally:
        engine.dispose()
