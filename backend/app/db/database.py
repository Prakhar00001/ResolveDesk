"""SQLite/PostgreSQL configuration and session lifecycle. Run with python -m app.db.database."""
import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, event
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import NullPool

BACKEND_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BACKEND_DIR / ".env")
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{(BACKEND_DIR / 'resolvedesk.db').as_posix()}")


class Base(DeclarativeBase):
    pass


def normalize_database_url(url: str | URL) -> URL:
    try:
        parsed = make_url(url)
        # Accessing port also validates malformed, non-integer port values.
        parsed.port
    except (SQLAlchemyError, ValueError, TypeError):
        raise ValueError("DATABASE_URL is not a valid SQLAlchemy connection URL") from None
    if parsed.drivername in {"postgres", "postgresql", "postgresql+psycopg"}:
        return parsed.set(drivername="postgresql+psycopg")
    if parsed.drivername not in {"sqlite", "sqlite+pysqlite"}:
        raise ValueError("DATABASE_URL must use SQLite or PostgreSQL with psycopg") from None
    return parsed


def make_engine(url: str | URL):
    parsed = normalize_database_url(url)
    is_sqlite = parsed.get_backend_name() == "sqlite"
    if is_sqlite:
        options = {"connect_args": {"check_same_thread": False, "timeout": 30}}
    else:
        # Neon/PgBouncer owns pooling; idle application connections keep compute awake.
        options = {"poolclass": NullPool, "connect_args": {"connect_timeout": 10}}
    try:
        engine = create_engine(parsed, **options)
    except (SQLAlchemyError, ValueError, TypeError):
        raise ValueError("DATABASE_URL could not configure the database engine") from None

    if is_sqlite:
        @event.listens_for(engine, "connect")
        def configure_sqlite(connection, _):
            cursor = connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA busy_timeout=30000")
            cursor.close()

    return engine


engine = make_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def init_database(bind=None):
    from app.models import models  # noqa: F401: register all tables

    try:
        Base.metadata.create_all(bind or engine)
    except SQLAlchemyError:
        # Driver errors may contain credentials, including in startup tracebacks.
        raise RuntimeError("Database initialization failed; check connectivity and DATABASE_URL") from None


def get_db():
    with SessionLocal() as session:
        try:
            yield session
        finally:
            session.rollback()


if __name__ == "__main__":
    # Use the canonical module so models and initialization share one metadata.
    from app.db.database import init_database as initialize

    initialize()
    print("ResolveDesk database initialized.")
