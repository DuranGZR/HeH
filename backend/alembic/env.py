"""Alembic environment configuration resolving PostgreSQL DSN safely at runtime."""

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from heh_api.core.config import Settings
from heh_api.infrastructure.db import to_sqlalchemy_postgres_dsn
from heh_api.infrastructure.models import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _resolve_sqlalchemy_url() -> str:
    configured = config.get_main_option("sqlalchemy.url")
    if configured:
        return to_sqlalchemy_postgres_dsn(configured)

    for env_key in ("HEH_DATABASE_URL", "DATABASE_URL"):
        env_dsn = os.environ.get(env_key)
        if env_dsn is not None and env_dsn.strip():
            return to_sqlalchemy_postgres_dsn(env_dsn)

    settings = Settings()
    if settings.database_url is not None:
        return to_sqlalchemy_postgres_dsn(settings.database_url.get_secret_value())

    raise RuntimeError("HEH_DATABASE_URL or DATABASE_URL must be configured for Alembic migrations")


def run_migrations_offline() -> None:
    """Run migrations without a live database connection (`--sql` mode)."""
    url = _resolve_sqlalchemy_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against a configured PostgreSQL engine."""
    section = config.get_section(config.config_ini_section, {})
    section["sqlalchemy.url"] = _resolve_sqlalchemy_url()

    connectable = engine_from_config(
        section,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
