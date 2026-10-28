"""Playwright-owned, seeded SQLite + Uvicorn; no product configuration changes."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading

BACKEND = Path(__file__).resolve().parents[2] / "backend"
RUNTIME = Path(__file__).resolve().parent / ".runtime"
run_dir = Path(os.environ["RESOLVEDESK_E2E_RUN_DIR"]).resolve()
if run_dir.parent != RUNTIME.resolve():
    raise RuntimeError("Refusing to create/delete a database outside e2e/.runtime")
run_dir.mkdir(parents=True, exist_ok=False)
os.environ["DATABASE_URL"] = f"sqlite:///{(run_dir / 'test.sqlite').as_posix()}"
sys.path.insert(0, str(BACKEND))

try:
    # The real seed CLI initializes the schema and agents before serving requests.
    subprocess.run([sys.executable, "-m", "app.db.seed"], cwd=BACKEND, check=True, timeout=20)
    import uvicorn
    from app.db.database import engine

    server = uvicorn.Server(uvicorn.Config(
        "app.main:app", host="127.0.0.1", port=8000, log_level="warning",
        timeout_graceful_shutdown=5,
    ))
    stopped = threading.Event()

    def watch_shutdown():
        # Playwright force-kills process trees on Windows. A file handshake lets
        # teardown stop Uvicorn and close SQLite handles before that happens.
        while not stopped.wait(0.1):
            if (run_dir / "shutdown").exists():
                server.should_exit = True
                return

    threading.Thread(target=watch_shutdown, daemon=True).start()
    try:
        server.run()
    finally:
        stopped.set()
        engine.dispose()
finally:
    shutil.rmtree(run_dir)
