"""SQLite configuration and session lifecycle. Run with python -m app.db.database."""
import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase, sessionmaker

BACKEND_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BACKEND_DIR / ".env")
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{(BACKEND_DIR / 'resolvedesk.db').as_posix()}")


class Base(DeclarativeBase):
    pass


def make_engine(url: str):
    is_sqlite = make_url(url).get_backend_name() == "sqlite"
    options = {"connect_args": {"check_same_thread": False, "timeout": 30}} if is_sqlite else {}
    engine = create_engine(url, **options)

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

    Base.metadata.create_all(bind or engine)


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
