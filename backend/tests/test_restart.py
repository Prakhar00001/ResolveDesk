"""Exercise real HTTP and SQLite persistence across two Uvicorn processes."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


BACKEND = Path(__file__).resolve().parents[1]


def http(base, path, method="GET", payload=None):
    request = Request(
        base + "/api" + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=2) as response:
            body = response.read()
            return response.status, json.loads(body) if body else None
    except HTTPError as error:
        return error.code, json.loads(error.read())


@contextmanager
def running_backend(database, log_path):
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    environment = {
        **os.environ,
        "DATABASE_URL": f"sqlite:///{database.as_posix()}",
        "PYTHONUNBUFFERED": "1",
    }
    with log_path.open("w", encoding="utf-8") as log:
        process = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1",
             "--port", str(port), "--log-level", "warning"],
            cwd=BACKEND, env=environment, stdout=log, stderr=subprocess.STDOUT,
        )
        try:
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise AssertionError(f"Backend exited early: {log_path.read_text()}")
                try:
                    if http(base, "/dashboard")[0] == 200:
                        break
                except (URLError, TimeoutError, OSError):
                    pass
                time.sleep(0.1)
            else:
                raise AssertionError(f"Backend startup timed out: {log_path.read_text()}")
            yield base
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


def test_real_http_restart_preserves_ticket_entries_and_audit(tmp_path):
    database = tmp_path / "restart.sqlite"
    with running_backend(database, tmp_path / "first.log") as base:
        assert http(base, "/dashboard")[1]["total"] == 0
        status, ticket = http(base, "/tickets", "POST", {
            "subject": "Persist through restart", "customer_email": "demo@example.com",
            "description": "Verify real HTTP writes survive process termination.",
        })
        assert status == 201
        path = f"/tickets/{ticket['id']}"
        assert http(base, path, "PATCH", {
            "status": "In Progress", "priority": "Urgent", "actor": "Restart Tester",
        })[0] == 200
        for entry_type in ("Public Reply", "Internal Note"):
            assert http(base, path + "/entries", "POST", {
                "entry_type": entry_type, "content": f"Persist {entry_type}",
                "author": "Restart Tester",
            })[0] == 201
        status, before = http(base, path)
        assert status == 200
        assert len(before["entries"]) == 2
        assert len(before["activities"]) == 5
        assert http(base, "/tickets", "POST", {
            "subject": "Invalid", "customer_name": "Demo",
        })[0] == 422

    # No TestClient, shared application object, or engine survives this boundary.
    with running_backend(database, tmp_path / "second.log") as base:
        assert http(base, path) == (200, before)
        assert http(base, "/dashboard")[1] == {
            "total": 1, "open": 0, "in_progress": 1, "resolved": 0,
            "urgent": 1, "overdue": 0,
        }
        assert http(base, path, "DELETE")[0] == 204
        for resource in (path, path + "/entries", path + "/activities"):
            assert http(base, resource)[0] == 404
        assert http(base, "/tickets")[1] == []
        assert all(value == 0 for value in http(base, "/dashboard")[1].values())

    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert connection.execute("SELECT deleted_at FROM tickets").fetchone()[0]
        assert connection.execute("SELECT count(*) FROM entries").fetchone()[0] == 2
        assert connection.execute("SELECT count(*) FROM activities").fetchone()[0] == 6
