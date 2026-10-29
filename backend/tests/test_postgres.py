"""PostgreSQL contracts; real SQL tests opt in with TEST_POSTGRES_URL.

Integration tests create and drop only a random schema, never public tables.
The supplied role must have CREATE SCHEMA permission on the test database.
"""
import os
import re
import subprocess
import sys
import traceback
from datetime import datetime, timedelta, timezone
from importlib import import_module
from pathlib import Path
from unittest.mock import Mock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool
from sqlalchemy.schema import CreateSchema, DropSchema

from app.db import database
from app.db.database import get_db, init_database, make_engine, normalize_database_url
from app.db.seed import seed
from app.main import create_app
from app.models.models import Activity, Agent, Entry, Ticket
from app.services.ticket_service import get_now

BACKEND = Path(__file__).resolve().parents[1]
NOW = datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize("scheme", ["postgres", "postgresql", "postgresql+psycopg"])
def test_postgres_url_normalization_preserves_encoded_credentials_and_options(scheme):
    url = normalize_database_url(
        f"{scheme}://us%40er:p%40ss%3A%2F%25%3F%23@db.example:5432/app"
        "?sslmode=require&channel_binding=require&application_name=ResolveDesk"
    )
    credentials_preserved = url.username == "us@er" and url.password == "p@ss:/%?#"
    assert credentials_preserved
    assert url.drivername == "postgresql+psycopg"
    assert (url.host, url.port, url.database) == ("db.example", 5432, "app")
    assert dict(url.query) == {
        "sslmode": "require", "channel_binding": "require", "application_name": "ResolveDesk",
    }
    assert normalize_database_url(url) == url
    password = url.password
    assert password is not None
    password_hidden = password not in str(url) and "p%40ss" not in str(url)
    assert password_hidden


@pytest.mark.parametrize("scheme", ["postgres", "postgresql", "postgresql+psycopg"])
def test_postgres_engine_uses_external_pool_and_finite_timeout(monkeypatch, scheme):
    creator = Mock(return_value=object())
    listener = Mock()
    monkeypatch.setattr(database, "create_engine", creator)
    monkeypatch.setattr(database.event, "listens_for", listener)
    url = f"{scheme}://user:password@db.example/app?sslmode=require&channel_binding=require"
    assert make_engine(url) is creator.return_value
    creator.assert_called_once_with(
        normalize_database_url(url), poolclass=NullPool, connect_args={"connect_timeout": 10},
    )
    listener.assert_not_called()


def test_psycopg_accepts_neon_options_without_connecting():
    engine = make_engine(
        "postgres://user:password@db.example/app?sslmode=require&channel_binding=require"
    )
    try:
        assert engine.dialect.driver == "psycopg"
        assert isinstance(engine.pool, NullPool)
        _, parameters = engine.dialect.create_connect_args(engine.url)
        assert parameters["sslmode"] == "require"
        assert parameters["channel_binding"] == "require"
        assert not engine.pool._pre_ping
    finally:
        engine.dispose()


@pytest.mark.parametrize("scheme", ["sqlite", "sqlite+pysqlite"])
def test_sqlite_configuration_is_unchanged(tmp_path, scheme):
    engine = make_engine(f"{scheme}:///{(tmp_path / 'sqlite.db').as_posix()}")
    try:
        with engine.connect() as connection:
            assert connection.scalar(text("PRAGMA foreign_keys")) == 1
            assert connection.scalar(text("PRAGMA busy_timeout")) == 30000
        assert engine.dialect.name == "sqlite"
        assert not isinstance(engine.pool, NullPool)
    finally:
        engine.dispose()


@pytest.mark.parametrize("url", [
    "PRIVATE-invalid-url", "postgresql://user:PRIVATE@host:PRIVATE/app",
    "mysql://user:PRIVATE@host/app", "postgresql+psycopg2://user:PRIVATE@host/app",
])
def test_invalid_urls_are_safe(url):
    with pytest.raises(ValueError) as error:
        make_engine(url)
    assert "PRIVATE" not in str(error.value)
    assert url not in str(error.value)
    assert "PRIVATE" not in "".join(traceback.format_exception(error.value))


def test_engine_configuration_failure_is_sanitized(monkeypatch):
    monkeypatch.setattr(database, "create_engine", Mock(side_effect=ValueError("PRIVATE password")))
    with pytest.raises(ValueError, match="could not configure") as error:
        make_engine("postgres://user:password@db.example/app")
    assert "PRIVATE" not in "".join(traceback.format_exception(error.value))


def test_initialization_failure_is_sanitized(monkeypatch):
    failure = OperationalError(None, None, Exception("PRIVATE connection password"))
    monkeypatch.setattr(database.Base.metadata, "create_all", Mock(side_effect=failure))
    with pytest.raises(RuntimeError, match="Database initialization failed") as error:
        init_database()
    assert "PRIVATE" not in "".join(traceback.format_exception(error.value))


@pytest.mark.parametrize("flag,url,message", [
    ("true", None, "explicit DATABASE_URL"),
    ("true", "sqlite", "requires a PostgreSQL DATABASE_URL"),
    ("TRUE", "sqlite-memory", "requires a PostgreSQL DATABASE_URL"),
    ("true", "postgresql+psycopg2://user:PRIVATE@host/app", "requires a PostgreSQL DATABASE_URL"),
    ("true", "postgres://user:PRIVATE@host:PRIVATE/app", "valid SQLAlchemy connection URL"),
    ("yes", "sqlite", "REQUIRE_POSTGRES must be true or false"),
    ("1", "sqlite", "REQUIRE_POSTGRES must be true or false"),
    ("", "sqlite", "REQUIRE_POSTGRES must be true or false"),
])
def test_require_postgres_fails_before_any_writes(monkeypatch, tmp_path, flag, url, message):
    startup = import_module("start")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("REQUIRE_POSTGRES", flag)
    monkeypatch.setenv("SEED_DEMO", "true")
    filename = tmp_path / "must-not-exist.sqlite"
    if url == "sqlite":
        url = f"sqlite:///{filename.as_posix()}"
    elif url == "sqlite-memory":
        url = "sqlite:///:memory:"
    if url is None:
        monkeypatch.delenv("DATABASE_URL", raising=False)
    else:
        monkeypatch.setenv("DATABASE_URL", url)
    initialize = Mock()
    monkeypatch.setattr(database, "init_database", initialize)
    seed_mock = Mock()
    monkeypatch.setattr(import_module("app.db.seed"), "seed", seed_mock)
    with pytest.raises(RuntimeError, match=message) as error:
        startup.prepare()
    initialize.assert_not_called()
    seed_mock.assert_not_called()
    assert not filename.exists()
    assert "PRIVATE" not in str(error.value)


@pytest.mark.parametrize("flag,scheme", [(None, "sqlite"), ("false", "sqlite"), ("true", "postgres"), ("TRUE", "postgresql"), ("true", "postgresql+psycopg")])
def test_startup_accepts_optional_flag_and_postgres_aliases(monkeypatch, tmp_path, flag, scheme):
    startup = import_module("start")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:" if scheme == "sqlite" else f"{scheme}://user:password@db.example/app")
    monkeypatch.setenv("SEED_DEMO", "false")
    monkeypatch.setenv("PORT", "10000")
    if flag is None:
        monkeypatch.delenv("REQUIRE_POSTGRES", raising=False)
    else:
        monkeypatch.setenv("REQUIRE_POSTGRES", flag)
    # Configuration tests never connect to a real database or initialize global state.
    monkeypatch.setattr(import_module("app.main"), "app", object())
    initialize = Mock()
    monkeypatch.setattr(database, "init_database", initialize)
    assert startup.prepare() == 10000
    initialize.assert_called_once_with()


@pytest.mark.parametrize("seed_demo", ["true", "false"])
def test_entrypoint_database_failure_never_prints_driver_secrets(seed_demo):
    environment = os.environ.copy()
    environment.update(APP_ENV="development", REQUIRE_POSTGRES="false", SEED_DEMO=seed_demo, PORT="10000", DATABASE_URL="sqlite:///:memory:")
    script = """
import runpy
import sys
from types import ModuleType
from sqlalchemy.exc import OperationalError
main = ModuleType('app.main')
main.app = object()
sys.modules['app.main'] = main
database = ModuleType('app.db.database')
def fail():
    raise OperationalError(None, None, Exception('PRIVATE connection password'))
database.init_database = fail
sys.modules['app.db.database'] = database
runpy.run_path('start.py', run_name='__main__')
"""
    result = subprocess.run([sys.executable, "-c", script], cwd=BACKEND, env=environment, capture_output=True, text=True, timeout=15, check=False)
    output = result.stdout + result.stderr
    assert result.returncode == 1
    assert "ResolveDesk startup failed: Database operation failed" in output
    assert "PRIVATE" not in output
    assert "Traceback" not in output


@pytest.fixture
def postgres_database():
    raw_url = os.getenv("TEST_POSTGRES_URL")
    if not raw_url:
        pytest.skip("TEST_POSTGRES_URL is not set; real PostgreSQL integration is opt-in")
    assert raw_url is not None
    url = normalize_database_url(raw_url)
    if url.get_backend_name() != "postgresql":
        pytest.fail("TEST_POSTGRES_URL must be PostgreSQL", pytrace=False)
    schema = "resolvedesk_test_" + uuid4().hex
    assert re.fullmatch(r"resolvedesk_test_[0-9a-f]{32}", schema)
    admin = make_engine(url)
    engine = None
    created = False
    try:
        with admin.begin() as connection:
            connection.execute(CreateSchema(schema))
        created = True
        # Every NullPool connection gets its own isolated search_path, not SET on
        # a previous connection. No fallback to public is permitted.
        engine = make_engine(url.update_query_dict({"options": f"-csearch_path={schema}"}))
        with engine.connect() as connection:
            assert connection.scalar(text("SELECT current_schema()")) == schema
        init_database(engine)
        yield engine, sessionmaker(bind=engine, expire_on_commit=False)
    finally:
        if engine is not None:
            engine.dispose()
        try:
            if created:
                with admin.begin() as connection:
                    connection.execute(DropSchema(schema, cascade=True))
        finally:
            admin.dispose()


@pytest.fixture
def postgres_api(postgres_database, monkeypatch):
    engine, factory = postgres_database
    for name in ("APP_ENV", "APP_ACCESS_USERNAME", "APP_ACCESS_PASSWORD", "FRONTEND_DIST"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(import_module("app.main"), "init_database", lambda: init_database(engine))
    application = create_app()
    clock = {"now": NOW}

    def override_db():
        with factory() as session:
            try:
                yield session
            finally:
                session.rollback()

    application.dependency_overrides[get_db] = override_db
    application.dependency_overrides[get_now] = lambda: clock["now"]
    with TestClient(application) as client:
        yield client, factory, clock


def create_ticket(client, **changes):
    payload = {"subject": "PostgreSQL issue", "customer_name": "Taylor", "description": "Investigate the report"}
    payload.update(changes)
    response = client.post("/api/tickets", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_postgres_real_initialization_seed_idempotence_and_soft_delete(postgres_database):
    engine, factory = postgres_database
    init_database(engine)
    assert seed(factory, NOW) == 12
    with factory() as session:
        ticket = session.scalar(select(Ticket).order_by(Ticket.id))
        ticket.subject = "Preserve customer edits"
        ticket.deleted_at = NOW
        ticket_id = ticket.id
        session.commit()
    assert seed(factory, NOW + timedelta(days=1)) == 0
    with factory() as session:
        assert session.scalar(select(func.count(Ticket.id))) == 12
        assert session.scalar(select(func.count(Agent.id))) == 3
        assert session.scalar(select(func.count(Entry.id))) == 24
        assert session.scalar(select(func.count(Activity.id))) == 36
        ticket = session.get(Ticket, ticket_id)
        assert ticket.subject == "Preserve customer edits"
        assert ticket.deleted_at == NOW


def test_postgres_real_crud_notes_audit_and_foreign_keys(postgres_api):
    client, factory, clock = postgres_api
    with factory() as session:
        agent = Agent(name="Alex", email="alex@example.com")
        session.add(agent)
        session.commit()
        agent_id = agent.id
    ticket = create_ticket(client, assignee_id=agent_id)
    path = f"/api/tickets/{ticket['id']}"
    assert client.get(path).json()["assignee"]["name"] == "Alex"
    clock["now"] += timedelta(minutes=1)
    response = client.patch(path, json={"status": "In Progress", "priority": "Urgent", "actor": "Alex"})
    assert response.status_code == 200
    for kind in ("Public Reply", "Internal Note"):
        response = client.post(path + "/entries", json={"content": f"Saved {kind}", "entry_type": kind, "author": "Alex"})
        assert response.status_code == 201
    detail = client.get(path).json()
    assert [entry["entry_type"] for entry in detail["entries"]] == ["Public Reply", "Internal Note"]
    assert [event["event_type"] for event in detail["activities"]] == [
        "ticket_created", "priority_changed", "status_changed", "reply_added", "note_added",
    ]
    assert client.get(path + "/activities").json() == detail["activities"]
    with factory() as session:
        session.delete(session.get(Agent, agent_id))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
        session.add(Entry(ticket_id=ticket["id"] + 99999, content="Invalid FK", author="Alex", entry_type="Internal Note", created_at=NOW))
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()
    assert client.delete(path, params={"actor": "Alex"}).status_code == 204
    assert client.get(path).status_code == 404
    assert client.get(path + "/entries").status_code == 404
    assert client.get(path + "/activities").status_code == 404
    assert client.get("/api/tickets").json() == []
    assert client.get("/api/dashboard").json()["total"] == 0
    with factory() as session:
        row = session.get(Ticket, ticket["id"])
        assert row.deleted_at == clock["now"]
        assert len(row.entries) == 2
        assert row.activities[-1].event_type == "ticket_deleted"
        assert row.activities[-1].actor == "Alex"


def test_postgres_real_filter_sort_and_strict_24_hour_counts(postgres_api):
    client, factory, clock = postgres_api
    with factory() as session:
        agent = Agent(name="Alex", email="alex@example.com")
        session.add(agent)
        session.commit()
        agent_id = agent.id
    specs = [
        ("Open", "Urgent", NOW - timedelta(hours=24, microseconds=1)),
        ("In Progress", "High", NOW - timedelta(hours=24)),
        ("Waiting on Customer", "Medium", NOW - timedelta(hours=23)),
        ("Resolved", "Urgent", NOW - timedelta(days=5)),
        ("In Progress", "Low", NOW - timedelta(days=2)),
    ]
    tickets = []
    for status, priority, created in specs:
        clock["now"] = created
        tickets.append(create_ticket(client, subject=f"Issue {priority} 100%_literal", status=status, priority=priority, assignee_id=agent_id))
    clock["now"] = NOW
    assert client.get("/api/dashboard").json() == dict(total=5, open=1, in_progress=2, resolved=1, urgent=2, overdue=2)
    clock["now"] += timedelta(microseconds=1)
    assert client.get("/api/dashboard").json()["overdue"] == 3
    rows = client.get("/api/tickets", params={"sort": "priority"}).json()
    assert [row["priority"] for row in rows] == ["Urgent", "Urgent", "High", "Medium", "Low"]
    assert [row["id"] for row in client.get("/api/tickets").json()] == [tickets[i]["id"] for i in (2, 1, 0, 4, 3)]
    params = {"search": "iSsUe uRgEnT", "status": "Open", "priority": "Urgent", "assignee_id": agent_id}
    assert [row["id"] for row in client.get("/api/tickets", params=params).json()] == [tickets[0]["id"]]
    assert len(client.get("/api/tickets", params={"search": "%_"}).json()) == 5
    assert client.get("/api/tickets", params={"assignee_id": agent_id + 99999}).json() == []
    assert client.patch(f"/api/tickets/{tickets[0]['id']}", json={"description": "Updated"}).status_code == 200
    assert client.get("/api/dashboard").json()["overdue"] == 3
    assert client.delete(f"/api/tickets/{tickets[0]['id']}").status_code == 204
    assert client.get("/api/dashboard").json() == dict(total=4, open=0, in_progress=2, resolved=1, urgent=1, overdue=2)


def test_postgres_real_utc_datetime_round_trip(postgres_database):
    _, factory = postgres_database
    local_time = datetime(2026, 10, 28, 17, 30, 0, 123456, tzinfo=timezone(timedelta(hours=5, minutes=30)))
    expected = local_time.astimezone(timezone.utc)
    with factory() as session:
        ticket = Ticket(subject="Timezone", customer_name="Taylor", description="UTC round trip", created_at=local_time, updated_at=local_time)
        session.add(ticket)
        session.commit()
        ticket_id = ticket.id
    # A fresh session/NullPool connection ensures this is a real database read.
    with factory() as session:
        ticket = session.get(Ticket, ticket_id)
        assert ticket.created_at == expected
        assert ticket.updated_at == expected
        assert ticket.created_at.tzinfo == timezone.utc
        assert ticket.deleted_at is None
