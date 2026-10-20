import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

import database
from config import get_settings
from database import Base
import models  # noqa: F401 — registers tables with Base.metadata

settings = get_settings()

# Alembic Config object — provides access to alembic.ini values.
config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url)


def render_item(type_, obj, autogen_context):
    """Render custom types as plain SQLAlchemy types in migrations.

    UTCDateTime is a TypeDecorator wrapping DateTime. Its behavior lives
    in Python, not in SQL, so the emitted column type is just DateTime.
    Returning False tells Alembic to use its default rendering.
    """
    if type_ == "type" and isinstance(obj, database.UTCDateTime):
        return "sa.DateTime()"
    return False


# Interpret the config file for Python logging.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Metadata for 'autogenerate' support.
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_item=render_item,
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_item=render_item,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Create an async engine and run migrations through it."""
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()