# ResolveDesk backend

FastAPI + Pydantic 2 + SQLAlchemy with persistent SQLite storage. Run commands from `backend/`.

## Setup

```sh
python -m venv .venv
# Windows:
.venv/Scripts/python.exe -m pip install -r requirements.txt
# macOS/Linux: use .venv/bin/python in place of .venv/Scripts/python.exe
```

Activate your virtual environment (`.venv/Scripts/activate` in a Windows POSIX shell,
`.venv\Scripts\Activate.ps1` in PowerShell, or `source .venv/bin/activate` on Unix), then:

```sh
python -m app.db.database
python -m app.db.seed
python -m uvicorn app.main:app --reload --port 8000
```

The default database is `backend/resolvedesk.db` regardless of working directory.
Optionally copy `.env.example` to `.env` and set `DATABASE_URL` (SQLite locally or PostgreSQL/Neon).
An explicit relative SQLite URL is relative to the process working directory.
Startup also creates missing tables; it does not seed automatically. The seed command
adds 3 demo agents and 12 demo tickets with public replies/internal notes. It never
updates existing records or resurrects soft-deleted demo tickets. Existing agents are
reused by email. Schema creation is not a migration system.

**Existing databases:** `create_all` does not alter existing tables or install newly
added constraints. In particular, an already initialized/seeded database will not
receive the `nonempty_description` check automatically. For disposable demo data,
stop the backend, back up the database, then use a fresh SQLite file and rerun init
and seed. To preserve existing data, apply a schema migration (SQLite requires a
table rebuild for this check), repairing any null/blank descriptions first. Do not
expect restarting the server or rerunning seed to migrate an existing database.

Engine connection arguments and PRAGMA listeners are SQLite-specific and are not
applied to other URL backends. PostgreSQL is not configured or integration-tested;
using it would require its driver dependency and a migration/deployment review.

Interactive API documentation: `http://localhost:8000/docs`.

## API

All routes are prefixed with `/api`:

| Method | Path | Response |
| --- | --- | --- |
| GET | `/agents` | Array of `{id,name,email}` |
| GET | `/tickets` | Array of tickets |
| POST | `/tickets` | Created ticket (201) |
| GET | `/tickets/{id}` | Ticket with `entries` and `activities` |
| PATCH | `/tickets/{id}` | Updated ticket |
| DELETE | `/tickets/{id}` | Empty response (204) |
| GET/POST | `/tickets/{id}/entries` | Array / created entry (201) |
| GET | `/tickets/{id}/activities` | Activity array |
| GET | `/dashboard` | `{total,open,in_progress,resolved,urgent,overdue}` |

Ticket list filters: `search`, `status`, `priority`, `assignee_id`, and
`sort=updated|priority` (default `updated`). Search is case-insensitive literal
substring matching across subject, customer name/email, and description. Filters
combine with AND. Priority sorts Urgent, High, Medium, Low, then updated time descending;
updated sorting is newest first. IDs break timestamp ties deterministically.

Create requires a nonblank subject, a nonblank `description`, and at least one
nonblank customer name or valid email. Description is trimmed and must contain at
least one non-whitespace character; omission, null, empty strings, and whitespace-only
strings return 422. PATCH may omit description to leave it unchanged, but any supplied
description must satisfy the same nonblank rule. New database schemas also enforce
NOT NULL and a nonempty trimmed description check.
Omitted identifiers are returned as null; blank identifiers normalize to null.
Defaults: priority `Medium`, status `Open`, assignee null.
Priorities: `Low`, `Medium`, `High`, `Urgent`. Statuses: `Open`, `In Progress`,
`Waiting on Customer`, `Resolved`. PATCH preserves omitted fields; null explicitly
clears an assignee/customer identifier but cannot clear required fields or both
customer identifiers. Unknown body fields and invalid enum/filter values return 422.

POST/PATCH tickets accept optional `actor` (default `Support Team`). DELETE accepts
optional `actor` as a query parameter. Every changed field produces one activity;
unchanged values, empty patches, and actor-only patches produce none and do not bump
`updated_at`. Assignment activities describe the previous and next agent by name
(or `Unassigned`), not numeric IDs. Creation, entry creation, changes, and soft deletion commit atomically
with their audit activities. Unknown assignees return 422; database constraint
violations return 409. Missing/deleted tickets return 404, including nested routes.
Errors use `{"detail": "message"}` or FastAPI's standard validation `detail` array.
Unexpected exceptions are logged with a traceback and return 500 with
`{"detail": "Internal server error"}`, never the internal exception text. The specific
database handlers remain in place (409 for integrity errors, 500 with
`{"detail": "Database operation failed"}` for other SQLAlchemy errors).

Entry creation requires nonblank `content`, optional `author` (default `Support Team`),
`entry_type` (`Public Reply` default or `Internal Note`), and optional `actor` (defaults
to author). Entries and activities are ordered oldest first, then ID. Entry creation
bumps the ticket's updated time. All timestamps are UTC ISO 8601.

Dashboard counts exclude soft-deleted tickets. `open` means precisely `Open`;
`in_progress` means precisely `In Progress`; waiting tickets count toward `total`.
`urgent` counts every active Urgent ticket, including resolved ones. `overdue` means
status is not `Resolved` AND creation time is strictly before now minus 24 hours;
it does not use updated time. Soft deletion retains all audit records in SQLite
but hides the ticket and its nested resources from the API.

CORS permits localhost and 127.0.0.1 on ports 5173 and 4173. The normal local API
command remains unauthenticated by default. Do not expose that configuration publicly.

## Hosted assessment demo

The root `render.yaml` runs `python backend/start.py` from the repository root. It
builds/serves React on the same origin as this API on Render Free, stores hosted data
in Neon Free PostgreSQL, and uses a Render-generated shared Basic-auth password.
There is no paid disk. Full instructions, free-tier limits, account-connection steps,
and the pending live-deployment status
are in [`../DEPLOYMENT.md`](../DEPLOYMENT.md).

Production requires `APP_ENV=production`, `APP_ACCESS_PASSWORD` of at least 16
characters, a valid compiled frontend, and an explicit persistent `DATABASE_URL`.
`APP_ACCESS_USERNAME` defaults to `reviewer`. `start.py` supplies the frontend path,
validates configuration, optionally seeds with `SEED_DEMO=true`, then starts one
worker on `PORT` (default 10000). The Blueprint sets `REQUIRE_POSTGRES=true`; enter
Neon's pooled connection URI directly in Render's private `DATABASE_URL` field.
`postgresql://` and `postgres://` normalize to psycopg 3 without losing SSL options.
PostgreSQL uses `NullPool` and a 10-second connection timeout. Local SQLite remains
the default; no local data is automatically migrated. Real PostgreSQL tests require
`TEST_POSTGRES_URL` and are configured in the repository's PostgreSQL CI workflow.

Only GET/HEAD `/healthz` bypasses the gate; it probes the database and returns a
minimal 200/503 response. UI, assets, API, and docs require the password. This is a
shared demo gate, not per-user authorization: everyone with the password sees all
internal notes. There is no outbound email or external AI/API integration. Groq is
not needed. Use HTTPS and fictional data; never commit access credentials.

## Tests

```sh
python -m pytest -q
```

Tests use isolated temporary file-backed SQLite databases and override the FastAPI
`app.services.ticket_service.get_now` dependency to test exact clock boundaries.
They cover CRUD, response schemas, validation, dashboard counts, search/filter/sort,
no-op activity deduplication, entry ordering, CORS, soft deletion, seed idempotence,
persistence across engines, SQLite foreign-key/check constraints, and rollback when
activity insertion fails during create/update/entry/delete. Additional tests cover
required/trimmed descriptions, description database constraints, named assignment
activities, sanitized/logged 500 errors with rollback, and backend-specific engine
configuration without requiring a PostgreSQL driver. Hosting tests cover the shared
access gate, malformed credentials, safe frontend routing, security headers and
readiness failures. Production subprocess tests verify `start.py`, real HTTP,
persistence and idempotent seeding across restarts, and rejection of invalid
configuration before database writes. The production browser smoke command is
`npm run test:production` from `frontend/`.
