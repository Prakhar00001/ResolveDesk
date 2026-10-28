"""Hosting contract: explicit opt-in, fail-closed demo access, and safe readiness."""
import base64
from importlib import import_module
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker

from app.access import CHALLENGE, SECURITY_HEADERS
from app.db.database import get_db, init_database, make_engine
from app.main import create_app


PASSWORD = "demo-password-at-least-16"


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch):
    for name in ("APP_ENV", "APP_ACCESS_USERNAME", "APP_ACCESS_PASSWORD", "FRONTEND_DIST"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def dist(tmp_path):
    directory = tmp_path / "dist"
    directory.mkdir()
    (directory / "index.html").write_text("<!doctype html><title>ResolveDesk demo</title>", encoding="utf-8")
    (directory / "assets").mkdir()
    (directory / "assets" / "app.js").write_text("console.log('demo');", encoding="utf-8")
    return directory


@pytest.fixture
def app_factory(tmp_path, monkeypatch):
    engine = make_engine(f"sqlite:///{(tmp_path / 'hosting.sqlite').as_posix()}")
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(import_module("app.main"), "init_database", lambda: init_database(engine))

    def build():
        application = create_app()

        def override_db():
            with factory() as db:
                try:
                    yield db
                finally:
                    db.rollback()

        application.dependency_overrides[get_db] = override_db
        return application

    yield build
    engine.dispose()


def production(monkeypatch, dist):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("APP_ACCESS_PASSWORD", PASSWORD)
    monkeypatch.setenv("FRONTEND_DIST", str(dist))


def basic(username="reviewer", password=PASSWORD):
    token = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
    return {"Authorization": "Basic " + token}


def assert_security(response):
    for name, value in SECURITY_HEADERS.items():
        assert response.headers[name] == value


@pytest.mark.parametrize("password", [None, "", "x" * 15])
def test_production_rejects_missing_or_short_password(monkeypatch, dist, password):
    production(monkeypatch, dist)
    if password is None:
        monkeypatch.delenv("APP_ACCESS_PASSWORD")
    else:
        monkeypatch.setenv("APP_ACCESS_PASSWORD", password)
    with pytest.raises(RuntimeError, match="APP_ACCESS_PASSWORD") as error:
        create_app()
    assert PASSWORD not in str(error.value)


@pytest.mark.parametrize("layout", ["unset", "empty", "missing", "file", "no-index", "no-assets", "index-directory", "assets-file"])
def test_production_rejects_invalid_frontend(monkeypatch, dist, layout):
    production(monkeypatch, dist)
    if layout == "unset":
        monkeypatch.delenv("FRONTEND_DIST")
    elif layout == "empty":
        monkeypatch.setenv("FRONTEND_DIST", "")
    elif layout == "missing":
        monkeypatch.setenv("FRONTEND_DIST", str(dist / "missing"))
    elif layout == "file":
        monkeypatch.setenv("FRONTEND_DIST", str(dist / "index.html"))
    elif layout in {"no-index", "index-directory"}:
        (dist / "index.html").unlink()
        if layout == "index-directory":
            (dist / "index.html").mkdir()
    else:
        (dist / "assets" / "app.js").unlink()
        (dist / "assets").rmdir()
        if layout == "assets-file":
            (dist / "assets").write_text("not a directory")
    with pytest.raises(RuntimeError, match="FRONTEND_DIST"):
        create_app()


def test_production_accepts_minimum_password(monkeypatch, dist, app_factory):
    production(monkeypatch, dist)
    monkeypatch.setenv("APP_ACCESS_PASSWORD", "x" * 16)
    with TestClient(app_factory()) as client:
        assert client.get("/", headers=basic(password="x" * 16)).status_code == 200


def test_local_api_is_untouched_without_hosting_env(app_factory):
    with TestClient(app_factory()) as client:
        assert client.get("/api/tickets").json() == []
        assert client.get("/docs").status_code == 200
        assert client.get("/openapi.json").status_code == 200
        for path in ("/", "/tickets", "/tickets/123", "/assets/app.js"):
            assert client.get(path).status_code == 404
        assert client.get("/healthz").json() == {"status": "ok"}


def test_dev_hosting_without_access_gate(monkeypatch, dist, app_factory):
    monkeypatch.setenv("FRONTEND_DIST", str(dist))
    with TestClient(app_factory()) as client:
        assert client.get("/").status_code == 200
        assert client.get("/assets/app.js").status_code == 200
        assert client.get("/api/tickets").status_code == 200


def test_dev_optional_gate_with_custom_utf8_credentials(monkeypatch, app_factory):
    monkeypatch.setenv("APP_ACCESS_USERNAME", "réviseur")
    monkeypatch.setenv("APP_ACCESS_PASSWORD", "démo:secret")
    with TestClient(app_factory()) as client:
        assert client.get("/api/tickets").status_code == 401
        assert client.get("/api/tickets", headers=basic("réviseur", "démo:secret")).status_code == 200
        assert client.get("/api/tickets", headers=basic()).status_code == 401


@pytest.mark.parametrize("method,path", [
    ("GET", "/"), ("HEAD", "/"), ("GET", "/tickets"), ("GET", "/tickets/123"),
    ("GET", "/assets/app.js"), ("GET", "/assets/missing.js"),
    ("GET", "/docs"), ("GET", "/redoc"), ("GET", "/docs/oauth2-redirect"),
    ("GET", "/openapi.json"), ("GET", "/api/tickets"), ("POST", "/api/tickets"),
    ("PATCH", "/api/tickets/1"), ("DELETE", "/api/tickets/1"),
    ("GET", "/api/not-a-route"), ("GET", "/not-a-route"),
    ("POST", "/healthz"), ("OPTIONS", "/healthz"), ("GET", "/healthz/"),
    ("OPTIONS", "/api/tickets"),
])
def test_gate_covers_entire_app(monkeypatch, dist, app_factory, method, path):
    production(monkeypatch, dist)
    with TestClient(app_factory()) as client:
        response = client.request(method, path, headers={
            "Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET",
        })
        assert response.status_code == 401
        assert response.headers["WWW-Authenticate"] == CHALLENGE
        assert_security(response)


@pytest.mark.parametrize("authorization", [
    "", "Basic", "Basic ", "Bearer token", "Basic !!!", "Basic YQ", "Basic YQ===",
    "Basic dXNlcg==", "Basic Og==", "Basic /zpwYXNz", "Basic dXNlcjpwYXNz extra",
    "Basic cmV2aWV3ZXI6d3Jvbmc=",
])
def test_malformed_or_invalid_credentials_are_safe_401(monkeypatch, dist, app_factory, authorization, caplog):
    production(monkeypatch, dist)
    with TestClient(app_factory()) as client:
        response = client.get("/api/tickets", headers={"Authorization": authorization})
        assert response.status_code == 401
        assert response.json() == {"detail": "Authentication required"}
        assert response.headers["WWW-Authenticate"] == CHALLENGE
        assert_security(response)
        assert PASSWORD not in response.text
        assert PASSWORD not in caplog.text


def test_duplicate_authorization_is_rejected(monkeypatch, dist, app_factory):
    production(monkeypatch, dist)
    with TestClient(app_factory()) as client:
        header = basic()["Authorization"]
        response = client.get("/", headers=[("Authorization", header), ("Authorization", header)])
        assert response.status_code == 401


@pytest.mark.parametrize("path", ["/", "/tickets", "/tickets/123", "/tickets/123/", "/assets/app.js", "/docs", "/redoc", "/openapi.json", "/api/tickets", "/api/dashboard"])
def test_valid_auth_accesses_frontend_docs_and_api(monkeypatch, dist, app_factory, path):
    production(monkeypatch, dist)
    with TestClient(app_factory()) as client:
        response = client.get(path, headers=basic())
        assert response.status_code == 200
        assert_security(response)


@pytest.mark.parametrize("path", ["/api", "/api/not-a-route", "/api/tickets/1/unknown", "/assets/missing.js", "/missing.js", "/index.html", "/unknown"])
def test_missing_api_and_assets_never_fall_back_to_spa(monkeypatch, dist, app_factory, path):
    production(monkeypatch, dist)
    with TestClient(app_factory()) as client:
        response = client.get(path, headers=basic())
        assert response.status_code == 404
        assert response.headers["content-type"] == "application/json"
        assert "ResolveDesk demo" not in response.text
        assert_security(response)


@pytest.mark.parametrize("path", [
    "/assets/%2e%2e/outside-secret.txt", "/assets/..%2foutside-secret.txt",
    "/assets/%2e%2e/%2e%2e/outside-secret.txt", "/assets/..%5coutside-secret.txt",
    "/tickets/%2e%2e/outside-secret.txt", "/tickets/..%5coutside-secret.txt",
    "/assets/%00outside-secret.txt",
])
def test_paths_do_not_expose_files(monkeypatch, dist, app_factory, path):
    (dist.parent / "outside-secret.txt").write_text("PRIVATE OUTSIDE FILE")
    (dist / "outside-secret.txt").write_text("PRIVATE INSIDE FILE")
    production(monkeypatch, dist)
    with TestClient(app_factory()) as client:
        response = client.get(path, headers=basic())
        assert response.status_code == 404
        assert "PRIVATE" not in response.text
        assert_security(response)


def make_symlink(link, target, directory=False):
    try:
        link.symlink_to(target, target_is_directory=directory)
    except (OSError, NotImplementedError):
        pytest.skip("Creating symlinks is not permitted on this system")


@pytest.mark.parametrize("name", ["index.html", "assets"])
def test_frontend_layout_rejects_external_symlinks(monkeypatch, dist, name):
    target = dist.parent / "external"
    if name == "assets":
        (dist / name / "app.js").unlink()
        (dist / name).rmdir()
        target.mkdir()
    else:
        (dist / name).unlink()
        target.write_text("PRIVATE")
    make_symlink(dist / name, target, directory=name == "assets")
    production(monkeypatch, dist)
    with pytest.raises(RuntimeError, match="FRONTEND_DIST"):
        create_app()


def test_asset_symlink_cannot_escape_dist(monkeypatch, dist, app_factory):
    target = dist.parent / "private.txt"
    target.write_text("PRIVATE")
    make_symlink(dist / "assets" / "private.txt", target)
    production(monkeypatch, dist)
    with TestClient(app_factory()) as client:
        response = client.get("/assets/private.txt", headers=basic())
        assert response.status_code == 404
        assert "PRIVATE" not in response.text


@pytest.mark.parametrize("method", ["GET", "HEAD"])
def test_health_is_public_and_uses_overridden_database(monkeypatch, dist, app_factory, method):
    production(monkeypatch, dist)
    app = app_factory()
    db = Mock()
    db.execute.return_value.scalar_one.return_value = 1
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as client:
        response = client.request(method, "/healthz", headers={"Authorization": "Basic !!!"})
        assert response.status_code == 200
        if method == "GET":
            assert response.json() == {"status": "ok"}
        else:
            assert response.content == b""
        assert "WWW-Authenticate" not in response.headers
        assert str(db.execute.call_args.args[0]) == str(text("SELECT 1"))
        db.execute.return_value.scalar_one.assert_called_once()
        assert_security(response)


@pytest.mark.parametrize("dependency_failure", [False, True])
def test_health_db_failure_is_safe_503(monkeypatch, dist, app_factory, dependency_failure):
    production(monkeypatch, dist)
    app = app_factory()
    db = Mock()
    db.execute.side_effect = SQLAlchemyError("PRIVATE database failure")

    def failed_db():
        if dependency_failure:
            raise SQLAlchemyError("PRIVATE connection failure")
        return db

    app.dependency_overrides[get_db] = failed_db
    with TestClient(app) as client:
        response = client.get("/healthz")
        assert response.status_code == 503
        assert response.json() == {"status": "unavailable"}
        assert "PRIVATE" not in response.text
        assert_security(response)


def test_unauthorized_request_never_uses_db(monkeypatch, dist, app_factory):
    production(monkeypatch, dist)
    app = app_factory()
    dependency = Mock(side_effect=AssertionError("Must not access database"))
    app.dependency_overrides[get_db] = dependency
    with TestClient(app) as client:
        assert client.get("/api/tickets").status_code == 401
        dependency.assert_not_called()


def test_index_ignores_stale_conditional_cache(monkeypatch, dist, app_factory):
    production(monkeypatch, dist)
    with TestClient(app_factory()) as client:
        first = client.get("/", headers=basic())
        response = client.get("/tickets/123", headers={
            **basic(), "If-None-Match": first.headers["etag"],
            "If-Modified-Since": first.headers["last-modified"],
        })
        assert response.status_code == 200
        assert response.text == first.text
        assert_security(response)
        (dist / "index.html").write_text("<!doctype html><title>Updated demo</title>", encoding="utf-8")
        updated = client.get("/", headers={**basic(), "If-None-Match": first.headers["etag"]})
        assert updated.status_code == 200
        assert "Updated demo" in updated.text
        assert_security(updated)


def test_ticket_responses_and_errors_are_not_cacheable(monkeypatch, dist, app_factory):
    production(monkeypatch, dist)
    with TestClient(app_factory(), headers=basic()) as client:
        created = client.post("/api/tickets", json={
            "subject": "Demo issue", "customer_name": "Demo customer", "description": "Demo description",
        })
        assert created.status_code == 201
        ticket_id = created.json()["id"]
        responses = [created, client.get("/api/tickets"), client.get(f"/api/tickets/{ticket_id}"),
                     client.get("/api/dashboard"), client.get("/api/tickets/999999"),
                     client.post("/api/tickets", json={})]
        for response in responses:
            assert_security(response)


def test_unhandled_error_still_has_security_headers(monkeypatch, dist, app_factory):
    production(monkeypatch, dist)
    app = app_factory()

    @app.get("/failure")
    def fail():
        raise RuntimeError("PRIVATE internal failure")

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/failure", headers=basic())
        assert response.status_code == 500
        assert response.json() == {"detail": "Internal server error"}
        assert_security(response)
