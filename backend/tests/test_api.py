from datetime import datetime, timedelta, timezone
from importlib import import_module
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import sessionmaker

from app.db.database import get_db, init_database, make_engine
from app.db.seed import seed
from app.main import create_app
from app.models.models import Activity, Agent, Entry, Ticket
from app.services.ticket_service import get_now

NOW = datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc)


@pytest.fixture
def env(tmp_path, monkeypatch):
    url = f"sqlite:///{(tmp_path / 'test.db').as_posix()}"
    engine = make_engine(url)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    init_database(engine)
    with factory() as db:
        db.add_all([Agent(name="Alex", email="alex@example.com"), Agent(name="Blair", email="blair@example.com")])
        db.commit()
    monkeypatch.setattr(import_module("app.main"), "init_database", lambda: init_database(engine))
    app = create_app()

    def override_db():
        with factory() as db:
            try:
                yield db
            finally:
                db.rollback()

    clock = {"now": NOW}
    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_now] = lambda: clock["now"]
    with TestClient(app) as client:
        yield client, factory, clock, url
    engine.dispose()


def create(client, **overrides):
    payload = {"subject": "Cannot log in", "customer_name": "Taylor", "description": "Password reset fails"}
    payload.update(overrides)
    result = client.post("/api/tickets", json=payload)
    assert result.status_code == 201, result.text
    return result.json()


def activities(client, ticket_id):
    response = client.get(f"/api/tickets/{ticket_id}/activities")
    assert response.status_code == 200
    return response.json()


def test_empty_arrays_dashboard_and_agents(env):
    client, *_ = env
    assert client.get("/api/tickets").json() == []
    assert client.get("/api/dashboard").json() == dict(total=0, open=0, in_progress=0, resolved=0, urgent=0, overdue=0)
    agents = client.get("/api/agents").json()
    assert agents == [{"id": 1, "name": "Alex", "email": "alex@example.com"}, {"id": 2, "name": "Blair", "email": "blair@example.com"}]


def test_create_detail_defaults_and_timestamps(env):
    client, *_ = env
    ticket = create(client)
    assert set(ticket) == {"id", "subject", "customer_name", "customer_email", "description", "priority", "status", "assignee_id", "assignee", "created_at", "updated_at"}
    assert ticket["priority"] == "Medium"
    assert ticket["status"] == "Open"
    assert ticket["assignee"] is None
    for field in ("created_at", "updated_at"):
        assert datetime.fromisoformat(ticket[field].replace("Z", "+00:00")) == NOW
    detail = client.get(f"/api/tickets/{ticket['id']}").json()
    assert detail["entries"] == []
    assert len(detail["activities"]) == 1
    activity = detail["activities"][0]
    assert activity["event_type"] == "ticket_created"
    assert activity["actor"] == "Support Team"
    assert set(activity) == {"id", "ticket_id", "event_type", "description", "actor", "created_at"}


def test_email_only_customer_and_assignee(env):
    client, *_ = env
    ticket = create(client, customer_name=" ", customer_email="taylor@example.com", assignee_id=1, actor="Alex")
    assert ticket["customer_name"] is None
    assert ticket["assignee"] == client.get("/api/agents").json()[0]
    assert activities(client, ticket["id"])[0]["actor"] == "Alex"


@pytest.mark.parametrize("payload", [
    {}, {"subject": "", "customer_name": "Taylor"},
    {"subject": "  ", "customer_name": "Taylor"},
    {"subject": "X"}, {"subject": "X", "customer_name": " ", "customer_email": ""},
    {"subject": "X", "customer_email": "not-email"},
    {"subject": "X", "customer_name": "T", "priority": "urgent"},
    {"subject": "X", "customer_name": "T", "status": "Closed"},
    {"subject": "X", "customer_name": "T", "actor": " "},
    {"subject": "X", "customer_name": "T", "assignee_id": -1},
    {"subject": "X", "customer_name": "T", "assignee_id": 999},
    {"subject": "X", "customer_name": "T", "unknown": True},
    {"subject": "X" * 256, "customer_name": "T"},
])
def test_create_validation(env, payload):
    client, *_ = env
    result = client.post("/api/tickets", json={"description": "Valid description", **payload})
    assert result.status_code == 422
    assert "detail" in result.json()
    assert client.get("/api/tickets").json() == []


def test_patch_atomic_changes_actor_and_noop(env):
    client, _, clock, _ = env
    ticket = create(client)
    path = f"/api/tickets/{ticket['id']}"
    clock["now"] += timedelta(hours=1)
    result = client.patch(path, json={"priority": "Urgent", "status": "In Progress", "assignee_id": 1, "actor": "Blair"})
    assert result.status_code == 200
    changed = result.json()
    assert changed["assignee"]["id"] == 1
    assert changed["created_at"] == ticket["created_at"]
    assert changed["updated_at"] != ticket["updated_at"]
    events = activities(client, ticket["id"])
    assert [e["event_type"] for e in events] == ["ticket_created", "priority_changed", "status_changed", "assignee_id_changed"]
    assert all(e["actor"] == "Blair" for e in events[1:])
    clock["now"] += timedelta(hours=1)
    for patch in ({"priority": "Urgent", "status": "In Progress", "assignee_id": 1}, {}, {"actor": "Alex"}):
        assert client.patch(path, json=patch).json()["updated_at"] == changed["updated_at"]
    assert activities(client, ticket["id"]) == events
    assert client.patch(path, json={"assignee_id": None}).json()["assignee"] is None
    assert len(activities(client, ticket["id"])) == 5


@pytest.mark.parametrize("patch", [
    {"customer_name": None}, {"customer_name": " "}, {"customer_email": "broken"},
    {"subject": None}, {"description": None}, {"description": ""},
    {"description": " "}, {"description": "\t\r\n"}, {"priority": None}, {"status": None},
    {"actor": None}, {"subject": " "}, {"status": "closed"},
    {"priority": "normal"}, {"assignee_id": 1000}, {"surprise": "value"},
])
def test_invalid_patch_changes_nothing(env, patch):
    client, *_ = env
    ticket = create(client)
    path = f"/api/tickets/{ticket['id']}"
    original = client.get(path).json()
    response = client.patch(path, json={"description": "Must roll back", **patch})
    assert response.status_code == 422
    assert client.get(path).json() == original


def test_replace_customer_identifier_and_edit_fields(env):
    client, *_ = env
    ticket = create(client)
    response = client.patch(f"/api/tickets/{ticket['id']}", json={"customer_name": None, "customer_email": "new@example.com", "subject": "Updated", "description": "New details"})
    assert response.status_code == 200
    assert response.json()["customer_name"] is None
    assert len(activities(client, ticket["id"])) == 5


@pytest.mark.parametrize("entry_type,event_type", [("Public Reply", "reply_added"), ("Internal Note", "note_added")])
def test_entries_detail_order_and_activity(env, entry_type, event_type):
    client, _, clock, _ = env
    ticket = create(client)
    clock["now"] += timedelta(minutes=1)
    path = f"/api/tickets/{ticket['id']}"
    for content in ("First message", "Second message"):
        result = client.post(path + "/entries", json={"content": content, "author": "Alex", "entry_type": entry_type})
        assert result.status_code == 201
        assert set(result.json()) == {"id", "ticket_id", "content", "author", "entry_type", "created_at"}
    entries = client.get(path + "/entries").json()
    assert [e["content"] for e in entries] == ["First message", "Second message"]
    assert entries[0]["id"] < entries[1]["id"]
    detail = client.get(path).json()
    assert detail["entries"] == entries
    assert detail["updated_at"] != ticket["updated_at"]
    assert [a["event_type"] for a in detail["activities"]] == ["ticket_created", event_type, event_type]
    assert all(a["actor"] == "Alex" for a in detail["activities"][1:])


@pytest.mark.parametrize("payload", [{}, {"content": " "}, {"content": "X", "author": " "}, {"content": "X", "entry_type": "Note"}, {"content": "X", "extra": 1}])
def test_invalid_entries(env, payload):
    client, *_ = env
    ticket = create(client)
    path = f"/api/tickets/{ticket['id']}"
    assert client.post(path + "/entries", json=payload).status_code == 422
    assert client.get(path + "/entries").json() == []
    assert len(activities(client, ticket["id"])) == 1


def test_default_entry_author_and_explicit_actor(env):
    client, *_ = env
    ticket = create(client)
    result = client.post(f"/api/tickets/{ticket['id']}/entries", json={"content": "Hello", "actor": "Blair"})
    assert result.json()["author"] == "Support Team"
    assert activities(client, ticket["id"])[-1]["actor"] == "Blair"


def test_search_filters_and_priority_sort(env):
    client, _, clock, _ = env
    rows = []
    for priority in ("High", "Low", "Urgent", "Medium", "Urgent"):
        clock["now"] += timedelta(minutes=1)
        rows.append(create(client, subject=f"Issue {priority}", priority=priority, assignee_id=1 if priority == "Urgent" else 2, status="In Progress" if priority == "Urgent" else "Open"))
    assert [t["id"] for t in client.get("/api/tickets").json()] == [t["id"] for t in reversed(rows)]
    ordered = client.get("/api/tickets", params={"sort": "priority"}).json()
    assert [t["priority"] for t in ordered] == ["Urgent", "Urgent", "High", "Medium", "Low"]
    assert ordered[0]["id"] == rows[-1]["id"]
    assert len(client.get("/api/tickets", params={"search": "iSsUe uRgEnT", "status": "In Progress", "priority": "Urgent", "assignee_id": 1}).json()) == 2
    for params in ({"status": "Open", "priority": "Urgent"}, {"assignee_id": 999}, {"search": "not present"}):
        assert client.get("/api/tickets", params=params).json() == []
    unique = create(client, subject="100%_literal", customer_name="Unique Person", customer_email="unique@example.com", description="SpecialNeedle")
    for search in ("%_", "unique person", "UNIQUE@EXAMPLE.COM", "specialneedle"):
        assert [t["id"] for t in client.get("/api/tickets", params={"search": search}).json()] == [unique["id"]]
    assert len(client.get("/api/tickets", params={"search": "   "}).json()) == 6


@pytest.mark.parametrize("params", [{"status": "Closed"}, {"priority": "urgent"}, {"sort": "oldest"}, {"assignee_id": "bad"}, {"assignee_id": 0}])
def test_invalid_query_filters(env, params):
    assert env[0].get("/api/tickets", params=params).status_code == 422


def test_dashboard_strict_boundary_and_counts(env):
    client, factory, clock, _ = env
    specs = [
        ("Open", "Urgent", NOW - timedelta(hours=24, microseconds=1)),
        ("In Progress", "High", NOW - timedelta(hours=24)),
        ("Waiting on Customer", "Medium", NOW - timedelta(hours=23)),
        ("Resolved", "Urgent", NOW - timedelta(days=5)),
        ("In Progress", "Low", NOW - timedelta(days=2)),
    ]
    ids = []
    for status, priority, created in specs:
        clock["now"] = created
        ids.append(create(client, status=status, priority=priority)["id"])
    clock["now"] = NOW
    assert client.get("/api/dashboard").json() == dict(total=5, open=1, in_progress=2, resolved=1, urgent=2, overdue=2)
    clock["now"] += timedelta(microseconds=1)
    assert client.get("/api/dashboard").json()["overdue"] == 3
    assert client.patch(f"/api/tickets/{ids[0]}", json={"description": "Recently updated"}).status_code == 200
    assert client.get("/api/dashboard").json()["overdue"] == 3
    assert client.patch(f"/api/tickets/{ids[0]}", json={"status": "Resolved"}).status_code == 200
    assert client.get("/api/dashboard").json()["overdue"] == 2


def test_soft_delete_excludes_everywhere_and_retains_rows(env):
    client, factory, clock, _ = env
    clock["now"] = NOW - timedelta(days=2)
    ticket = create(client, priority="Urgent")
    path = f"/api/tickets/{ticket['id']}"
    client.post(path + "/entries", json={"content": "Keep for audit"})
    clock["now"] = NOW
    response = client.delete(path, params={"actor": "Alex"})
    assert response.status_code == 204
    assert response.content == b""
    assert client.get("/api/tickets", params={"search": "Cannot"}).json() == []
    assert client.get("/api/dashboard").json() == dict(total=0, open=0, in_progress=0, resolved=0, urgent=0, overdue=0)
    for method, suffix, kwargs in (
        ("get", "", {}), ("patch", "", {"json": {"status": "Resolved"}}),
        ("delete", "", {}), ("get", "/entries", {}),
        ("post", "/entries", {"json": {"content": "Invisible"}}), ("get", "/activities", {}),
    ):
        result = getattr(client, method)(path + suffix, **kwargs)
        assert result.status_code == 404
        assert result.json() == {"detail": "Ticket not found"}
    with factory() as db:
        row = db.get(Ticket, ticket["id"])
        assert row.deleted_at == NOW
        assert len(row.entries) == 1
        assert row.activities[-1].event_type == "ticket_deleted"
        assert row.activities[-1].actor == "Alex"
        assert len(row.activities) == 3


def test_missing_tickets_structured_404(env):
    client, *_ = env
    for method, suffix, kwargs in (
        ("get", "", {}), ("patch", "", {"json": {}}), ("delete", "", {}),
        ("get", "/entries", {}), ("post", "/entries", {"json": {"content": "Hi"}}),
        ("get", "/activities", {}),
    ):
        response = getattr(client, method)("/api/tickets/999" + suffix, **kwargs)
        assert response.status_code == 404
        assert isinstance(response.json()["detail"], str)


@pytest.mark.parametrize("operation", ["create", "patch", "entry", "delete"])
def test_activity_failure_rolls_back_entire_operation(env, operation):
    client, factory, clock, _ = env
    ticket = create(client)
    path = f"/api/tickets/{ticket['id']}"
    original = client.get(path).json()
    clock["now"] += timedelta(hours=1)

    def fail_activity(mapper, connection, target):
        raise IntegrityError("injected failure", {}, Exception("activity failed"))

    event.listen(Activity, "before_insert", fail_activity)
    try:
        if operation == "create":
            response = client.post("/api/tickets", json={"subject": "Must not persist", "customer_name": "X", "description": "Valid description"})
        elif operation == "patch":
            response = client.patch(path, json={"status": "Resolved", "priority": "Urgent"})
        elif operation == "entry":
            response = client.post(path + "/entries", json={"content": "Must not persist"})
        else:
            response = client.delete(path)
        assert response.status_code == 409
        assert isinstance(response.json()["detail"], str)
    finally:
        event.remove(Activity, "before_insert", fail_activity)
    assert client.get(path).json() == original
    assert len(client.get("/api/tickets").json()) == 1
    with factory() as db:
        assert db.scalar(select(func.count(Entry.id))) == 0
        assert db.scalar(select(func.count(Activity.id))) == 1


@pytest.mark.parametrize("kind", ["priority", "status", "identifier", "subject", "description", "assignee_fk", "entry_fk", "activity_fk", "entry_type", "entry_content"])
def test_sqlite_constraints(env, kind):
    client, factory, *_ = env
    ticket = create(client, assignee_id=1)
    with factory() as db:
        row = db.get(Ticket, ticket["id"])
        if kind in ("priority", "status"):
            setattr(row, kind, "Invalid")
        elif kind == "identifier":
            row.customer_name = " "
            row.customer_email = None
        elif kind in ("subject", "description"):
            setattr(row, kind, " ")
        elif kind == "assignee_fk":
            row.assignee_id = 999
        elif kind == "activity_fk":
            db.add(Activity(ticket_id=999, event_type="test", description="X", actor="Alex", created_at=NOW))
        else:
            db.add(Entry(ticket_id=999 if kind == "entry_fk" else row.id, content=" " if kind == "entry_content" else "X", author="Alex", entry_type="bad" if kind == "entry_type" else "Internal Note", created_at=NOW))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
    assert client.get(f"/api/tickets/{ticket['id']}").json()["status"] == "Open"


def test_referenced_agent_cannot_be_deleted(env):
    client, factory, *_ = env
    create(client, assignee_id=1)
    with factory() as db:
        db.delete(db.get(Agent, 1))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()


def test_persistence_across_engines(env):
    client, _, _, url = env
    ticket = create(client, assignee_id=1)
    client.post(f"/api/tickets/{ticket['id']}/entries", json={"content": "Persisted note", "entry_type": "Internal Note"})
    second_engine = make_engine(url)
    try:
        with sessionmaker(bind=second_engine)() as db:
            row = db.get(Ticket, ticket["id"])
            assert row.subject == ticket["subject"]
            assert row.assignee.name == "Alex"
            assert row.entries[0].content == "Persisted note"
            assert len(row.activities) == 2
            assert row.created_at == NOW
    finally:
        second_engine.dispose()


def test_seed_non_destructive_idempotent_including_deleted(env):
    client, factory, *_ = env
    user_ticket = create(client, subject="User ticket")
    assert seed(factory, NOW) == 12
    with factory() as db:
        counts = tuple(db.scalar(select(func.count(model.id))) for model in (Agent, Ticket, Entry, Activity))
        seeded = db.scalar(select(Ticket).where(Ticket.seed_key == "demo-v1-1"))
        seeded_id = seeded.id
    assert client.patch(f"/api/tickets/{seeded_id}", json={"subject": "User edited demo"}).status_code == 200
    assert client.delete(f"/api/tickets/{seeded_id}").status_code == 204
    assert seed(factory, NOW + timedelta(days=1)) == 0
    with factory() as db:
        assert tuple(db.scalar(select(func.count(model.id))) for model in (Agent, Ticket, Entry)) == counts[:3]
        assert db.scalar(select(func.count(Activity.id))) == counts[3] + 2
        assert db.get(Ticket, seeded_id).subject == "User edited demo"
        assert db.get(Ticket, seeded_id).deleted_at is not None
        assert db.get(Ticket, user_ticket["id"]).subject == "User ticket"
    dashboard = client.get("/api/dashboard").json()
    assert dashboard["total"] == 12
    assert dashboard["resolved"] == 3
    assert dashboard["overdue"] > 0


@pytest.mark.parametrize("origin", ["http://localhost:5173", "http://localhost:4173"])
def test_cors_preflight(env, origin):
    response = env[0].options("/api/tickets", headers={"Origin": origin, "Access-Control-Request-Method": "PATCH", "Access-Control-Request-Headers": "content-type"})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


def test_cors_rejects_unknown_origin(env):
    response = env[0].options("/api/tickets", headers={"Origin": "https://untrusted.example", "Access-Control-Request-Method": "GET"})
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


@pytest.mark.parametrize("description_fields", [
    {}, {"description": None}, {"description": ""},
    {"description": "   "}, {"description": "\t\r\n"},
])
def test_create_requires_nonblank_description(env, description_fields):
    client, factory, *_ = env
    response = client.post("/api/tickets", json={
        "subject": "Valid subject", "customer_name": "Taylor", **description_fields,
    })
    assert response.status_code == 422
    assert any(error["loc"] == ["body", "description"] for error in response.json()["detail"])
    with factory() as db:
        assert db.scalar(select(func.count(Ticket.id))) == 0
        assert db.scalar(select(func.count(Activity.id))) == 0


def test_description_trimmed_patch_omission_and_normalized_noop(env):
    client, _, clock, _ = env
    ticket = create(client, description=" \tInitial description\r\n ")
    assert ticket["description"] == "Initial description"
    path = f"/api/tickets/{ticket['id']}"
    assert client.patch(path, json={"subject": "Updated subject"}).json()["description"] == "Initial description"
    clock["now"] += timedelta(hours=1)
    response = client.patch(path, json={"description": " \tNew description\r\n "})
    assert response.status_code == 200
    changed = response.json()
    assert changed["description"] == "New description"
    events = activities(client, ticket["id"])
    assert events[-1]["event_type"] == "description_changed"
    clock["now"] += timedelta(hours=1)
    assert client.patch(path, json={"description": " New description "}).json() == changed
    assert activities(client, ticket["id"]) == events


@pytest.mark.parametrize("description_fields", [
    {}, {"description": None}, {"description": ""}, {"description": "   "},
])
def test_database_rejects_missing_or_blank_description(env, description_fields):
    _, factory, *_ = env
    with factory() as db:
        db.add(Ticket(subject="Valid subject", customer_name="Taylor", created_at=NOW,
                      updated_at=NOW, **description_fields))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()
        assert db.scalar(select(func.count(Ticket.id))) == 0


def test_assignment_activity_uses_names_before_and_after(env):
    client, *_ = env
    ticket = create(client)
    path = f"/api/tickets/{ticket['id']}"
    for assignee_id in (1, 2, None):
        assert client.patch(path, json={"assignee_id": assignee_id}).status_code == 200
    events = activities(client, ticket["id"])
    assert [activity["description"] for activity in events[1:]] == [
        "Assignee changed from Unassigned to Alex",
        "Assignee changed from Alex to Blair",
        "Assignee changed from Blair to Unassigned",
    ]
    assert all(activity["event_type"] == "assignee_id_changed" for activity in events[1:])
    assert client.patch(path, json={"assignee_id": None}).status_code == 200
    assert activities(client, ticket["id"]) == events


@pytest.mark.parametrize("error_type,detail,log_message", [
    (RuntimeError, "Internal server error", "Unexpected request failure"),
    (SQLAlchemyError, "Database operation failed", "Database operation failed"),
])
def test_server_errors_logged_safe_and_transaction_rolled_back(env, monkeypatch, caplog,
                                                               error_type, detail, log_message):
    client, factory, *_ = env
    secret = "sensitive internal diagnostic"

    def fail_record(*args, **kwargs):
        raise error_type(secret)

    monkeypatch.setattr(import_module("app.services.ticket_service"), "record", fail_record)
    # ServerErrorMiddleware re-raises unexpected exceptions after sending the response.
    with TestClient(client.app, raise_server_exceptions=False) as safe_client:
        response = safe_client.post("/api/tickets", json={
            "subject": "Must roll back", "customer_name": "Taylor", "description": "Valid description",
        })
    assert response.status_code == 500
    assert response.json() == {"detail": detail}
    assert secret not in response.text
    assert any(record.message == log_message and record.exc_info for record in caplog.records)
    with factory() as db:
        assert db.scalar(select(func.count(Ticket.id))) == 0
        assert db.scalar(select(func.count(Activity.id))) == 0


@pytest.mark.parametrize("url,is_sqlite", [
    ("sqlite:///example.db", True), ("sqlite+pysqlite:///example.db", True),
    ("postgresql://user:password@localhost/resolvedesk", False),
    ("postgresql+psycopg://user:password@localhost/resolvedesk", False),
])
def test_engine_configuration_is_backend_specific(monkeypatch, url, is_sqlite):
    database = import_module("app.db.database")
    fake_engine = object()
    create_engine = Mock(return_value=fake_engine)
    listen = Mock(return_value=lambda handler: handler)
    monkeypatch.setattr(database, "create_engine", create_engine)
    monkeypatch.setattr(database.event, "listens_for", listen)
    assert make_engine(url) is fake_engine
    if is_sqlite:
        create_engine.assert_called_once_with(database.normalize_database_url(url), connect_args={"check_same_thread": False, "timeout": 30})
        listen.assert_called_once_with(fake_engine, "connect")
    else:
        create_engine.assert_called_once_with(database.normalize_database_url(url), poolclass=database.NullPool, connect_args={"connect_timeout": 10})
        listen.assert_not_called()
