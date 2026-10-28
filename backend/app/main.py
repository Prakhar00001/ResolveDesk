from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.access import AccessMiddleware, SECURITY_HEADERS, access_credentials
from app.api.routes import router
from app.db.database import init_database
from app.web import configure_web, frontend_directory

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    credentials = access_credentials()
    directory = frontend_directory()

    @asynccontextmanager
    async def lifespan(app):
        init_database()
        yield

    application = FastAPI(title="ResolveDesk API", version="1.0.0", lifespan=lifespan)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://localhost:4173", "http://127.0.0.1:5173", "http://127.0.0.1:4173"],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )

    # Added after CORS so preflight requests cannot bypass the shared gate.
    application.add_middleware(AccessMiddleware, credentials=credentials)

    @application.exception_handler(IntegrityError)
    async def integrity_error(request: Request, exc: IntegrityError):
        logger.warning("Database constraint rejected a request", exc_info=exc)
        if request.url.path == "/healthz":
            return JSONResponse(status_code=503, content={"status": "unavailable"}, headers=SECURITY_HEADERS)
        return JSONResponse(status_code=409, content={"detail": "Database constraint violation"}, headers=SECURITY_HEADERS)

    @application.exception_handler(SQLAlchemyError)
    async def database_error(request: Request, exc: SQLAlchemyError):
        logger.error("Database operation failed", exc_info=exc)
        if request.url.path == "/healthz":
            return JSONResponse(status_code=503, content={"status": "unavailable"}, headers=SECURITY_HEADERS)
        return JSONResponse(status_code=500, content={"detail": "Database operation failed"}, headers=SECURITY_HEADERS)

    @application.exception_handler(Exception)
    async def unexpected_error(request: Request, exc: Exception):
        logger.error("Unexpected request failure", exc_info=exc)
        if request.url.path == "/healthz":
            return JSONResponse(status_code=503, content={"status": "unavailable"}, headers=SECURITY_HEADERS)
        return JSONResponse(status_code=500, content={"detail": "Internal server error"}, headers=SECURITY_HEADERS)

    application.include_router(router)
    configure_web(application, directory)
    return application


app = create_app()
