"""Production startup with a Playwright-owned database and Windows-safe shutdown."""
import os
from pathlib import Path
import shutil
import sys
import threading

FRONTEND = Path(__file__).resolve().parents[2]
BACKEND = FRONTEND.parent / "backend"
run_dir = Path(os.environ["RESOLVEDESK_E2E_RUN_DIR"]).resolve()
if run_dir.parent != (FRONTEND / "e2e" / ".runtime").resolve():
    raise RuntimeError("Refusing to create/delete a database outside e2e/.runtime")
run_dir.mkdir(parents=True, exist_ok=False)
os.environ.update({
    "DATABASE_URL": f"sqlite:///{(run_dir / 'production.sqlite').as_posix()}",
    "FRONTEND_DIST": str(FRONTEND / "dist"),
    "APP_ENV": "production",
    "PORT": "8002",
    "SEED_DEMO": "true",
})
sys.path.insert(0, str(BACKEND))
stopped = threading.Event()

try:
    import start
    import uvicorn

    # Use the hosted entry point's validation, compiled assets and seed logic,
    # not the development harness's separate seed CLI or a replacement app.
    port = start.prepare()
    server = uvicorn.Server(uvicorn.Config(
        "app.main:app", host="127.0.0.1", port=port, workers=1,
        log_level="warning", timeout_graceful_shutdown=5,
    ))

    def watch_shutdown():
        # The existing teardown waits for database removal before Playwright
        # force-kills its process tree on Windows.
        while not stopped.wait(0.1):
            if (run_dir / "shutdown").exists():
                server.should_exit = True
                return

    threading.Thread(target=watch_shutdown, daemon=True).start()
    server.run()
finally:
    stopped.set()
    database = sys.modules.get("app.db.database")
    if database is not None:
        database.engine.dispose()
    shutil.rmtree(run_dir)
