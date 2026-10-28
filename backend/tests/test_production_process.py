"""Run the production entry point from the repository root over real HTTP.

TLS belongs to the hosting edge; these subprocess tests use loopback HTTP only.
No application imports, TestClient, shared engines, or browser are involved.
"""
import base64
from contextlib import contextmanager
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import subprocess
import sys
import time

import httpx
import pytest


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
SECURITY_HEADERS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
}


class ProductionProcess:
    def __init__(self, directory, dist):
        self.directory = directory
        self.storage = directory / "storage"
        self.storage.mkdir()
        self.database = self.storage / "production.sqlite"
        self.password = secrets.token_urlsafe(32)
        self.username = "process-reviewer"
        self.logs = []
        self.environment = {
            key: value for key, value in os.environ.items()
            if key not in {
                "APP_ENV", "APP_ACCESS_USERNAME", "APP_ACCESS_PASSWORD",
                "DATABASE_URL", "FRONTEND_DIST", "PORT", "SEED_DEMO",
                "PYTHONPATH", "PYTHONHOME", "WEB_CONCURRENCY",
            } and not key.startswith("UVICORN_")
        }
        self.environment.update({
            "APP_ENV": "production",
            "APP_ACCESS_USERNAME": self.username,
            "APP_ACCESS_PASSWORD": self.password,
            "DATABASE_URL": f"sqlite:///{self.database.as_posix()}",
            "FRONTEND_DIST": str(dist),
            "SEED_DEMO": "false",
            "PYTHON_DOTENV_DISABLED": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONUNBUFFERED": "1",
        })

    @contextmanager
    def launch(self, overrides=None, ready=True):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        environment = {**self.environment, "PORT": str(port)}
        for key, value in (overrides or {}).items():
            if value is None:
                environment.pop(key, None)
            else:
                environment[key] = value
        log_path = self.directory / f"process-{len(self.logs)}.log"
        self.logs.append(log_path)
        # Keep secrets only in memory and the child environment, never in argv/files.
        forbidden = [self.password, environment.get("APP_ACCESS_PASSWORD")]
        token = base64.b64encode(f"{self.username}:{self.password}".encode()).decode()
        forbidden.append(token)

        def safe_log():
            output = log_path.read_text(encoding="utf-8", errors="replace")
            for secret in forbidden:
                if secret:
                    output = output.replace(secret, "[redacted]")
            return output

        with log_path.open("w", encoding="utf-8") as log:
            process = subprocess.Popen(
                [sys.executable, "backend/start.py"], cwd=ROOT, env=environment,
                stdout=log, stderr=subprocess.STDOUT,
            )
            try:
                with httpx.Client(
                    base_url=f"http://127.0.0.1:{port}",
                    auth=(self.username, self.password), timeout=2, trust_env=False,
                ) as client:
                    if ready:
                        deadline = time.monotonic() + 20
                        while time.monotonic() < deadline:
                            if process.poll() is not None:
                                pytest.fail(f"Production entry point exited early:\n{safe_log()}")
                            try:
                                if client.get("/healthz", auth=None).status_code == 200:
                                    break
                            except httpx.TransportError:
                                pass
                            time.sleep(0.05)
                        else:
                            pytest.fail(f"Production startup timed out:\n{safe_log()}")
                    yield process, client, log_path
            finally:
                if process.poll() is None:
                    process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
                log.flush()
                output = log_path.read_text(encoding="utf-8", errors="replace")
                if any(secret and secret in output for secret in forbidden):
                    pytest.fail("Production process leaked access credentials to its log")


@pytest.fixture
def production(tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text(
        '<!doctype html><title>Process test</title><script src="/assets/app.js"></script>',
        encoding="utf-8",
    )
    (dist / "assets").mkdir()
    (dist / "assets" / "app.js").write_text("console.log('compiled fixture');", encoding="utf-8")
    return ProductionProcess(tmp_path, dist)


def assert_security(response):
    for name, value in SECURITY_HEADERS.items():
        assert response.headers[name] == value


def database_rows(database):
    with sqlite3.connect(database) as connection:
        return {
            table: connection.execute(f"SELECT * FROM {table} ORDER BY id").fetchall()
            for table in ("agents", "tickets", "entries", "activities")
        }


def test_production_entrypoint_real_http_access_and_static_ui(production):
    with production.launch() as (_, client, log_path):
        health = client.get("/healthz", auth=None)
        assert health.status_code == 200
        assert health.json() == {"status": "ok"}
        assert "www-authenticate" not in health.headers
        assert_security(health)
        assert client.head("/healthz", auth=None).status_code == 200
        for path in (
            "/", "/tickets", "/tickets/123", "/assets/app.js",
            "/api/tickets", "/api/not-a-route", "/docs", "/redoc", "/openapi.json",
        ):
            denied = client.get(path, auth=None)
            assert denied.status_code == 401, path
            assert denied.json() == {"detail": "Authentication required"}
            assert denied.headers["www-authenticate"] == 'Basic realm="ResolveDesk", charset="UTF-8"'
            assert_security(denied)
        assert client.get("/", auth=(production.username, "wrong")).status_code == 401
        assert client.get("/api/tickets", auth=("wrong", production.password)).status_code == 401
        for path in ("/", "/tickets", "/tickets/123", "/tickets/123/"):
            response = client.get(path)
            assert response.status_code == 200
            assert response.headers["content-type"].startswith("text/html")
            assert response.content == (production.directory / "dist" / "index.html").read_bytes()
            assert_security(response)
        asset = client.get("/assets/app.js")
        assert asset.status_code == 200
        assert asset.content == (production.directory / "dist" / "assets" / "app.js").read_bytes()
        assert_security(asset)
        for path in ("/api/not-a-route", "/assets/missing.js", "/index.html"):
            response = client.get(path)
            assert response.status_code == 404
            assert response.headers["content-type"] == "application/json"
            assert response.json() == {"detail": "Not Found"}
            assert_security(response)
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert client.get(path).status_code == 200
        assert client.get("/api/tickets").json() == []
        assert client.get("/api/dashboard").json()["total"] == 0
    output = log_path.read_text(encoding="utf-8")
    assert output.count("Started server process") == 1
    assert "Started parent process" not in output
    assert "Demo initialization:" not in output


def test_whole_start_script_restart_seed_idempotence_and_soft_delete(production):
    with production.launch() as (_, client, _):
        response = client.post("/api/tickets", json={
            "subject": "Preserve real user data", "customer_name": "Process Tester",
            "description": "Survive full production entry point restarts.",
        })
        assert response.status_code == 201
        ticket_id = response.json()["id"]
        path = f"/api/tickets/{ticket_id}"
        assert client.patch(path, json={
            "status": "In Progress", "priority": "Urgent", "actor": "Process Tester",
        }).status_code == 200
        for entry_type in ("Public Reply", "Internal Note"):
            response = client.post(path + "/entries", json={
                "entry_type": entry_type, "content": f"Preserve {entry_type}",
                "author": "Process Tester",
            })
            assert response.status_code == 201
        response = client.get(path)
        assert response.status_code == 200
        before = response.json()
        assert [entry["entry_type"] for entry in before["entries"]] == ["Public Reply", "Internal Note"]
        assert len(before["activities"]) == 5
        assert {activity["event_type"] for activity in before["activities"]} >= {
            "ticket_created", "reply_added", "note_added",
        }
        assert client.get(path + "/entries").json() == before["entries"]
        assert client.get(path + "/activities").json() == before["activities"]

    with production.launch({"SEED_DEMO": "true"}) as (_, client, seeded_log):
        assert client.get(path).json() == before
        assert client.get("/api/dashboard").json()["total"] == 13
        tickets = client.get("/api/tickets").json()
        assert len(tickets) == 13
        demo_id = next(ticket["id"] for ticket in tickets if ticket["id"] != ticket_id)
        demo_path = f"/api/tickets/{demo_id}"
        assert client.patch(demo_path, json={"subject": "Keep edited demo"}).status_code == 200
        assert client.delete(demo_path).status_code == 204
    assert "Demo initialization: 12 tickets added" in seeded_log.read_text(encoding="utf-8")
    snapshot = database_rows(production.database)
    with sqlite3.connect(production.database) as connection:
        assert connection.execute("SELECT count(*) FROM tickets WHERE seed_key IS NOT NULL").fetchone()[0] == 12

    with production.launch({"SEED_DEMO": "true"}) as (_, client, repeated_log):
        assert database_rows(production.database) == snapshot
        assert client.get(path).json() == before
        assert client.get(demo_path).status_code == 404
        assert client.get("/api/dashboard").json()["total"] == 12
        assert len(client.get("/api/tickets").json()) == 12
        deleted = client.delete(path, params={"actor": "Process Tester"})
        assert deleted.status_code == 204
        assert deleted.content == b""
        for method, suffix, payload in (
            ("GET", "", None), ("GET", "/entries", None), ("GET", "/activities", None),
            ("PATCH", "", {"subject": "Invisible"}),
            ("POST", "/entries", {"content": "Invisible"}), ("DELETE", "", None),
        ):
            response = client.request(method, path + suffix, json=payload)
            assert response.status_code == 404
            assert response.json() == {"detail": "Ticket not found"}
        assert ticket_id not in {ticket["id"] for ticket in client.get("/api/tickets").json()}
        assert client.get("/api/tickets", params={"search": "Preserve real user data"}).json() == []
        assert client.get("/api/dashboard").json()["total"] == 11
    assert "Demo initialization: 0 tickets added" in repeated_log.read_text(encoding="utf-8")
    with sqlite3.connect(production.database) as connection:
        assert connection.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert connection.execute("SELECT count(*) FROM tickets").fetchone()[0] == 13
        assert connection.execute("SELECT deleted_at FROM tickets WHERE id = ?", (ticket_id,)).fetchone()[0]

        assert connection.execute("SELECT subject FROM tickets WHERE id = ?", (demo_id,)).fetchone()[0] == "Keep edited demo"
        assert connection.execute("SELECT deleted_at FROM tickets WHERE id = ?", (demo_id,)).fetchone()[0]
        assert connection.execute("SELECT count(*) FROM entries WHERE ticket_id = ?", (ticket_id,)).fetchone()[0] == 2
        assert connection.execute("SELECT count(*) FROM activities WHERE ticket_id = ?", (ticket_id,)).fetchone()[0] == 6
        assert connection.execute(
            "SELECT event_type, actor FROM activities WHERE ticket_id = ? ORDER BY id DESC LIMIT 1",
            (ticket_id,),
        ).fetchone() == ("ticket_deleted", "Process Tester")
        for table in ("entries", "activities"):
            assert connection.execute(
                f"SELECT count(*) FROM {table} child LEFT JOIN tickets parent "
                "ON parent.id = child.ticket_id WHERE parent.id IS NULL"
            ).fetchone()[0] == 0
    if production.password.encode() in production.database.read_bytes():
        pytest.fail("Access password was stored in SQLite")


def test_repository_compiled_frontend_and_default_dist_when_available(production):
    dist = ROOT / "frontend" / "dist"
    scripts = sorted((dist / "assets").rglob("*.js"))
    if not (dist / "index.html").is_file() or not scripts:
        pytest.skip("No compiled frontend/dist available; fixture frontend is covered separately")
    with production.launch({"FRONTEND_DIST": None}) as (_, client, _):
        for path in ("/", "/tickets/123"):
            response = client.get(path)
            assert response.status_code == 200
            assert response.content == (dist / "index.html").read_bytes()
        asset_path = "/" + scripts[0].relative_to(dist).as_posix()
        assert client.get(asset_path, auth=None).status_code == 401
        response = client.get(asset_path)
        assert response.status_code == 200
        assert response.content == scripts[0].read_bytes()


@pytest.mark.parametrize("case,expected", [
    ("password-missing", "APP_ACCESS_PASSWORD"),
    ("password-empty", "APP_ACCESS_PASSWORD"),
    ("password-short", "APP_ACCESS_PASSWORD"),
    ("database-missing", "explicit DATABASE_URL"),
    ("database-empty", "explicit DATABASE_URL"),
    ("database-memory", "absolute database file path"),
    ("database-no-file", "absolute database file path"),
    ("database-relative", "absolute database file path"),
    ("database-malformed", "valid SQLAlchemy connection URL"),
    ("database-missing-directory", "Database directory must exist and be writable"),
    ("port-empty", "PORT must be an integer between 1 and 65535"),
    ("port-text", "PORT must be an integer between 1 and 65535"),
    ("port-zero", "PORT must be an integer between 1 and 65535"),
    ("port-negative", "PORT must be an integer between 1 and 65535"),
    ("port-too-large", "PORT must be an integer between 1 and 65535"),
    ("seed-empty", "SEED_DEMO must be true or false"),
    ("seed-text", "SEED_DEMO must be true or false"),
    ("seed-number", "SEED_DEMO must be true or false"),
    ("frontend-empty", "FRONTEND_DIST"),
    ("frontend-missing", "FRONTEND_DIST"),
    ("frontend-file", "FRONTEND_DIST"),
    ("frontend-no-index", "FRONTEND_DIST"),
    ("frontend-no-assets", "FRONTEND_DIST"),
    ("frontend-index-directory", "FRONTEND_DIST"),
    ("frontend-assets-file", "FRONTEND_DIST"),
])
def test_invalid_production_startup_fails_before_writes(production, case, expected):
    directory = production.directory
    dist = directory / "dist"
    overrides = {"SEED_DEMO": "true"}
    configurations = {
        "password-missing": ("APP_ACCESS_PASSWORD", None),
        "password-empty": ("APP_ACCESS_PASSWORD", ""),
        "password-short": ("APP_ACCESS_PASSWORD", production.password[:15]),
        "database-missing": ("DATABASE_URL", None),
        "database-empty": ("DATABASE_URL", ""),
        "database-memory": ("DATABASE_URL", "sqlite:///:memory:"),
        "database-no-file": ("DATABASE_URL", "sqlite://"),
        "database-relative": ("DATABASE_URL", "sqlite:///production-process-invalid.sqlite"),
        "database-malformed": ("DATABASE_URL", "not-a-connection-url"),
        "database-missing-directory": (
            "DATABASE_URL", f"sqlite:///{(production.storage / 'missing' / 'db.sqlite').as_posix()}",
        ),
        "port-empty": ("PORT", ""), "port-text": ("PORT", "not-a-port"),
        "port-zero": ("PORT", "0"), "port-negative": ("PORT", "-1"),
        "port-too-large": ("PORT", "65536"),
        "seed-empty": ("SEED_DEMO", ""), "seed-text": ("SEED_DEMO", "yes"),
        "seed-number": ("SEED_DEMO", "1"),
        "frontend-empty": ("FRONTEND_DIST", ""),
        "frontend-missing": ("FRONTEND_DIST", str(directory / "missing-dist")),
        "frontend-file": ("FRONTEND_DIST", str(dist / "index.html")),
    }
    if case in configurations:
        key, value = configurations[case]
        overrides[key] = value
    elif case in {"frontend-no-index", "frontend-index-directory"}:
        (dist / "index.html").unlink()
        if case == "frontend-index-directory":
            (dist / "index.html").mkdir()
    else:
        (dist / "assets" / "app.js").unlink()
        (dist / "assets").rmdir()
        if case == "frontend-assets-file":
            (dist / "assets").write_text("not a directory", encoding="utf-8")

    # Also guard against accidentally falling back to the developer's database.
    default_database = BACKEND / "resolvedesk.db"
    default_before = default_database.read_bytes() if default_database.exists() else None
    with production.launch(overrides, ready=False) as (process, _, log_path):
        try:
            returncode = process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            pytest.fail("Invalid production configuration did not exit promptly")
        assert returncode == 1
    output = log_path.read_text(encoding="utf-8")
    assert "ResolveDesk startup failed:" in output
    assert expected in output
    assert "Started server process" not in output
    assert "Demo initialization:" not in output
    assert "Traceback" not in output
    assert list(production.storage.iterdir()) == []
    assert not (BACKEND / "production-process-invalid.sqlite").exists()
    assert (default_database.read_bytes() if default_database.exists() else None) == default_before
