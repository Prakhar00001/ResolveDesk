"""Explicit, narrowly scoped frontend hosting and dependency-backed readiness."""
import os
from pathlib import Path

from fastapi import Depends, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from starlette.staticfiles import StaticFiles

from app.db.database import get_db


def frontend_directory():
    configured = os.getenv("FRONTEND_DIST")
    if not configured:
        if os.getenv("APP_ENV", "").lower() == "production":
            raise RuntimeError("Production requires FRONTEND_DIST")
        return None
    try:
        directory = Path(configured).resolve(strict=True)
        index = (directory / "index.html").resolve(strict=True)
        assets = (directory / "assets").resolve(strict=True)
        if (not directory.is_dir() or not index.is_file() or not assets.is_dir()
                or not index.is_relative_to(directory) or not assets.is_relative_to(directory)):
            raise ValueError("Invalid frontend layout")
    except (OSError, ValueError, RuntimeError) as exc:
        raise RuntimeError("FRONTEND_DIST must contain index.html and an assets directory within it") from exc
    return directory


def configure_web(application, directory):
    @application.api_route("/healthz", methods=["GET", "HEAD"], include_in_schema=False)
    def healthz(db=Depends(get_db)):
        try:
            db.execute(text("SELECT 1")).scalar_one()
        except SQLAlchemyError:
            return JSONResponse({"status": "unavailable"}, status_code=503)
        return {"status": "ok"}

    if directory is None:
        return

    application.mount("/assets", StaticFiles(directory=directory / "assets", follow_symlink=False), name="assets")

    @application.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
    @application.api_route("/tickets", methods=["GET", "HEAD"], include_in_schema=False)
    @application.api_route("/tickets/{frontend_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def index(frontend_path: str = ""):
        # Never turn a traversal attempt into a filesystem lookup or SPA response.
        if "\\" in frontend_path or "\x00" in frontend_path or any(
            part in {".", ".."} for part in frontend_path.split("/")
        ):
            raise HTTPException(status_code=404, detail="Not Found")
        try:
            filename = (directory / "index.html").resolve(strict=True)
            if not filename.is_relative_to(directory) or not filename.is_file():
                raise OSError("Invalid index")
        except (OSError, ValueError, RuntimeError):
            raise HTTPException(status_code=404, detail="Not Found") from None
        # FileResponse, unlike StaticFiles, does not return a stale conditional 304.
        return FileResponse(filename, media_type="text/html", headers={"Cache-Control": "no-store"})
