"""Exercise real HTTP and SQLite persistence across two Uvicorn processes."""
from contextlib import closing, contextmanager
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import time

import httpx


BACKEND = Path(__file__).resolve().parents[1]


def http(client, path, method="GET", payload=None):
    response = client.request(method, "/api" + path, json=payload)
    return response.status_code, response.json() if response.content else None


@contextmanager
def running_backend(database, log_path):
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    environment = {
        key: value for key, value in os.environ.items()
        if key not in {
            "APP_ENV", "APP_ACCESS_USERNAME", "APP_ACCESS_PASSWORD",
            "DATABASE_URL", "FRONTEND_DIST", "PORT", "SEED_DEMO",
            "PYTHONPATH", "PYTHONHOME", "WEB_CONCURRENCY",
        } and not key.startswith("UVICORN_")
    }
    environment.update({
        "APP_ENV": "test",
        "DATABASE_URL": f"sqlite:///{database.as_posix()}",
        "FRONTEND_DIST": "",
        "SEED_DEMO": "false",
        "PYTHON_DOTENV_DISABLED": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONUNBUFFERED": "1",
    })
    with log_path.open("w", encoding="utf-8") as log:
        process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1",
             "--port", str(port), "--log-level", "warning"],
            cwd=BACKEND, env=environment, stdout=log, stderr=subprocess.STDOUT,
        )
        try:
            with httpx.Client(base_url=base, timeout=2, trust_env=False) as client:
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        raise AssertionError(f"Backend exited early: {log_path.read_text()}")
                    try:
                        # Refused Windows HTTP connects can consume the full request
                        # timeout; probe the listener with a much shorter budget first.
                        with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                            pass
                        if http(client, "/dashboard")[0] == 200:
                            break
                    except (httpx.TransportError, OSError):
                        pass
                    time.sleep(0.05)
                else:
                    raise AssertionError(f"Backend startup timed out: {log_path.read_text()}")
                yield client
        finally:
            try:
                if os.name == "nt" and process.poll() is None:
                    # A Windows venv python.exe can be a launcher: killing only its
                    # PID need not stop the actual interpreter holding the DB open.
                    subprocess.run(
                        ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                        stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
                        # Killing the interpreter can also exit its launcher
                        # before taskkill reaches it (a harmless nonzero status).
                        timeout=5, check=False,
                    )
            finally:
                if process.poll() is None:
                    process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


def test_real_http_restart_preserves_ticket_entries_and_audit(tmp_path, monkeypatch):
    # Hosting settings in the invoking shell must not gate or seed this API test.
    inherited_database = tmp_path / "inherited.sqlite"
    for key, value in {
        "APP_ENV": "production", "APP_ACCESS_USERNAME": "inherited-reviewer",
        "APP_ACCESS_PASSWORD": os.urandom(24).hex(),
        "DATABASE_URL": f"sqlite:///{inherited_database.as_posix()}",
        "FRONTEND_DIST": str(tmp_path / "missing-inherited-dist"),
        "SEED_DEMO": "true", "PORT": "invalid", "WEB_CONCURRENCY": "2",
        "UVICORN_WORKERS": "2",
    }.items():
        monkeypatch.setenv(key, value)
    database = tmp_path / "restart.sqlite"
    with running_backend(database, tmp_path / "first.log") as client:
        assert http(client, "/dashboard")[1]["total"] == 0
        status, ticket = http(client, "/tickets", "POST", {
            "subject": "Persist through restart", "customer_email": "demo@example.com",
            "description": "Verify real HTTP writes survive process termination.",
        })
        assert status == 201
        path = f"/tickets/{ticket['id']}"
        assert http(client, path, "PATCH", {
            "status": "In Progress", "priority": "Urgent", "actor": "Restart Tester",
        })[0] == 200
        for entry_type in ("Public Reply", "Internal Note"):
            assert http(client, path + "/entries", "POST", {
                "entry_type": entry_type, "content": f"Persist {entry_type}",
                "author": "Restart Tester",
            })[0] == 201
        status, before = http(client, path)
        assert status == 200
        assert len(before["entries"]) == 2
        assert len(before["activities"]) == 5
        assert http(client, "/tickets", "POST", {
            "subject": "Invalid", "customer_name": "Demo",
        })[0] == 422

    # No TestClient, shared application object, or engine survives this boundary.
    with running_backend(database, tmp_path / "second.log") as client:
        assert http(client, path) == (200, before)
        assert http(client, "/dashboard")[1] == {
            "total": 1, "open": 0, "in_progress": 1, "resolved": 0,
            "urgent": 1, "overdue": 0,
        }
        assert http(client, path, "DELETE")[0] == 204
        for resource in (path, path + "/entries", path + "/activities"):
            assert http(client, resource)[0] == 404
        assert http(client, "/tickets")[1] == []
        assert all(value == 0 for value in http(client, "/dashboard")[1].values())

    assert not inherited_database.exists()
    with closing(sqlite3.connect(database)) as connection:
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert connection.execute("SELECT deleted_at FROM tickets").fetchone()[0]
        assert connection.execute("SELECT count(*) FROM entries").fetchone()[0] == 2
        assert connection.execute("SELECT count(*) FROM activities").fetchone()[0] == 6
