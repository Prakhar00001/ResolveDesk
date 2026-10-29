"""Hosted entry point: validate configuration, optionally seed, start one worker."""
import os
from pathlib import Path
import sys

import uvicorn
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError

BACKEND = Path(__file__).resolve().parent


def prepare():
    # Keep relative configuration consistent whether invoked from root or backend/.
    os.chdir(BACKEND)
    from dotenv import load_dotenv

    load_dotenv(BACKEND / ".env")
    os.environ.setdefault("FRONTEND_DIST", str(BACKEND.parent / "frontend" / "dist"))
    production = os.getenv("APP_ENV", "").lower() == "production"
    require_postgres = os.getenv("REQUIRE_POSTGRES", "false").lower()
    if require_postgres not in {"true", "false"}:
        raise RuntimeError("REQUIRE_POSTGRES must be true or false")
    database_url = os.getenv("DATABASE_URL")
    if (production or require_postgres == "true") and not database_url:
        raise RuntimeError("Production or REQUIRE_POSTGRES requires an explicit DATABASE_URL")
    if database_url:
        try:
            url = make_url(database_url)
            url.port
        except (SQLAlchemyError, ValueError, TypeError):
            raise RuntimeError("DATABASE_URL is not a valid SQLAlchemy connection URL") from None
        if require_postgres == "true" and url.drivername not in {"postgres", "postgresql", "postgresql+psycopg"}:
            raise RuntimeError("REQUIRE_POSTGRES requires a PostgreSQL DATABASE_URL using psycopg")
        if production and url.get_backend_name() == "sqlite":
            filename = Path(url.database or "")
            if not url.database or url.database == ":memory:" or not filename.is_absolute():
                raise RuntimeError("Production SQLite requires an absolute database file path")
            if not filename.parent.is_dir() or not os.access(filename.parent, os.W_OK):
                raise RuntimeError("Database directory must exist and be writable; attach the persistent disk")
    try:
        port = int(os.getenv("PORT", "10000"))
    except ValueError:
        raise RuntimeError("PORT must be an integer between 1 and 65535") from None
    if not 1 <= port <= 65535:
        raise RuntimeError("PORT must be an integer between 1 and 65535")
    seed_demo = os.getenv("SEED_DEMO", "false").lower()
    if seed_demo not in {"true", "false"}:
        raise RuntimeError("SEED_DEMO must be true or false")

    # Validate the access gate and compiled frontend before performing any writes.
    from app.main import app  # noqa: F401

    from app.db.database import init_database

    init_database()
    if seed_demo == "true":
        from app.db.seed import seed
        added = seed()
        print(f"Demo initialization: {added} tickets added; existing records preserved.", flush=True)
    return port


if __name__ == "__main__":
    try:
        port = prepare()
    except SQLAlchemyError:
        print("ResolveDesk startup failed: Database operation failed; check connectivity and DATABASE_URL", file=sys.stderr)
        raise SystemExit(1) from None
    except (RuntimeError, ValueError) as error:
        # Never print an environment dictionary, connection URL, or access password.
        print(f"ResolveDesk startup failed: {error}", file=sys.stderr)
        raise SystemExit(1) from None
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, workers=1, log_level="info")
