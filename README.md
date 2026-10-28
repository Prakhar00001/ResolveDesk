# ResolveDesk

A complete support desk built for the Comhard Technologies practical assessment: React + TypeScript on the frontend, FastAPI + SQLAlchemy on the backend, and persistent SQLite storage. All tickets, conversations, activities, filters, and dashboard metrics use the real API and database.

> Assessment scope follows the detailed requirements supplied with this project. The original challenge PDF was not present in the repository, so PDF-specific requirements beyond that brief have not been independently verified.

## Features

- Complete ticket CRUD with a dedicated detail route, full-field editor, inline status/priority/assignment controls, and confirmed **soft deletion**.
- Required subject, description, and at least one customer identifier; server-side and frontend validation.
- Four statuses: Open, In Progress, Waiting on Customer, Resolved. Four priorities: Low, Medium, High, Urgent.
- Public replies and visually distinct amber internal notes, each with author, timestamp, and ticket association. These are persisted conversations, **not outbound email**.
- Atomic activity logging for creation, field changes, assignment, replies, notes, and deletion; before/after descriptions and no duplicate events for unchanged values.
- Database-backed subject/customer/description search, AND-combined status/priority/assignee filters, newest-updated and priority sorting, reset, URL-persisted views, and client-side pagination.
- Backend-calculated total, open, in-progress, resolved, urgent, and overdue metrics; query invalidation after mutations and 30-second polling.
- Responsive laptop/tablet interface, Lucide icons, accessible focus-managed dialogs, keyboard navigation, readable timestamps with exact-time tooltips, notifications, and loading/error/retry/empty states.
- Reproducible, non-destructive seed: 3 agents, 12 tickets, all statuses/priorities, replies, notes, audit history, and both resolved and unresolved tickets older than 24 hours.

## Prerequisites

- **Python 3.11+** with `pip` and `venv`.
- **Node.js 24 LTS recommended**, npm. The current test runner supports Node 20.19+, 22.12+, or 24+; verified here on Node 24.11.0, npm 11.6.1, and Python 3.11.9 on Windows.
- No separate database server, API keys, credentials, Docker, or cloud account required.
- Installing dependencies and Chromium requires internet access. Package versions are locked in `frontend/package-lock.json`.

## Quick start — Windows / Zed shell

From the repository root, open **two terminals**. Commands below also work from PowerShell using forward slashes for the executable paths.

**Terminal 1 — backend**

```sh
cd backend
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt
.venv/Scripts/python.exe -m app.db.database
.venv/Scripts/python.exe -m app.db.seed
.venv/Scripts/python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

**Terminal 2 — frontend**

```sh
cd frontend
npm ci
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open **http://127.0.0.1:5173**. Interactive API docs: **http://127.0.0.1:8000/docs**.

No environment files need to be copied for the default setup. Stop either server with Ctrl+C. To restart later, run only the last command in each terminal; existing tickets persist.

### macOS / Linux

Use the same commands but replace `.venv/Scripts/python.exe` with `.venv/bin/python` (`python3 -m venv .venv` if your Python executable is named `python3`). The application and browser harness select platform-appropriate paths, but execution was verified on Windows only.

### Empty database versus demo data

`python -m app.db.database` initializes tables without demo tickets. API startup also creates missing tables. Seeding is **optional**; omit `python -m app.db.seed` for an empty inbox. Tickets work without agents or seed data (leave assignee Unassigned). The seed command supplies the realistic support-agent list.

Rerunning the seed adds only missing demo records. It does not modify user tickets, overwrite edits, or resurrect deleted demo tickets. Seed identities, subjects, agents, statuses, and priorities are deterministic; creation times are relative to the seed run to maintain useful overdue examples.

The normal database lives at **`backend/resolvedesk.db`**, outside temporary directories, and is ignored by Git. Do not delete it if you want to preserve your work. To try a separate clean database, use `DATABASE_URL` in `backend/.env` rather than removing your existing file.

## Configuration

Templates: [`backend/.env.example`](backend/.env.example) and [`frontend/.env.example`](frontend/.env.example).

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Absolute SQLite URL for `backend/resolvedesk.db` | Backend loads `backend/.env`. SQLite relative URLs are relative to the process working directory; prefer an absolute path. |
| `VITE_API_BASE_URL` | `/api` | Optional `frontend/.env.local`; public **build-time** value, never a secret. |
| `E2E_PYTHON` | Backend virtualenv Python for this OS | Optional browser-test interpreter override. |

Vite proxies `/api` to `http://localhost:8000` during development (and Vite preview). The production static bundle does **not** include that proxy. API CORS permits localhost/127.0.0.1 frontend origins on ports 5173 and 4173. For different hosts, update the backend origin allowlist or serve both behind a same-origin reverse proxy.

## API overview

All application endpoints begin with `/api`.

| Method | Endpoint | Result |
| --- | --- | --- |
| GET | `/agents` | Support agents |
| GET | `/tickets` | Nondeleted tickets, filtered and sorted |
| POST | `/tickets` | Create ticket and audit activity; `201` |
| GET | `/tickets/{id}` | Ticket, assignee, chronological entries and activities |
| PATCH | `/tickets/{id}` | Partial update plus audit events for actual changes |
| DELETE | `/tickets/{id}` | Soft delete and audit activity; `204` |
| GET / POST | `/tickets/{id}/entries` | List / add public reply or internal note (`201`) |
| GET | `/tickets/{id}/activities` | Chronological audit history |
| GET | `/dashboard` | Six live database aggregates |

List query parameters: `search`, `status`, `priority`, `assignee_id`, `sort=updated|priority`. All filters combine with AND; sorting is applied in SQL. Priority order is Urgent → High → Medium → Low, then updated time descending; IDs break ties. The API returns arrays; UI pagination occurs after database filtering, suitable for this small assessment dataset.

Ticket body example:

```json
{
  "subject": "Cannot export billing report",
  "customer_name": "Alex Morgan",
  "customer_email": "alex@example.com",
  "description": "The export completes but contains no rows.",
  "priority": "High",
  "status": "Open",
  "assignee_id": null,
  "actor": "Support Team"
}
```

Entry body: `{"content":"Investigating the export job.","author":"Maya Chen","entry_type":"Internal Note"}`. Entry types are exactly `Public Reply` and `Internal Note`. Actor attribution is explicitly entered; there is no pretend signed-in identity.

Omitted PATCH fields are preserved. Explicit null clears an assignee or one customer identifier; it cannot clear required fields or both identifiers. Empty/unchanged patches do not change `updated_at` or create activities. Invalid inputs return `422`, missing/deleted tickets `404`, constraint conflicts `409`, and unexpected/database failures a safe `500` detail. Failed operations never return fake success. See `/docs` for request/response schemas and [`backend/README.md`](backend/README.md) for detailed semantics.

### Dashboard and overdue rules

Counts exclude soft-deleted records. `open` means exactly Open; `in_progress` means exactly In Progress; waiting tickets are included in total but neither count. Urgent counts all nondeleted Urgent tickets, including resolved ones.

**Overdue is strictly:**

```text
status != "Resolved" AND created_at < now_utc - 24 hours
```

An exactly 24-hour-old ticket is not yet overdue. A resolved ticket is never overdue, open, or in progress. The calculation uses creation time, not last update. SQLite stores normalized UTC, API values include timezone information, and frontend dates display in the viewer's local timezone. Tests freeze the backend clock and cover the exact boundary plus one microsecond on either side.

## Architecture and data integrity

```text
frontend/src/
  api/          Typed HTTP client and shared query hooks
  components/   Forms, table, badges, dialogs, conversation, metrics
  pages/        Inbox/dashboard and ticket detail routes
  types/        Shared frontend contracts
  utils/        Validation and date presentation
frontend/e2e/   Real Chromium + live API acceptance tests
backend/app/
  api/          Thin FastAPI route handlers
  schemas/      Pydantic request and response contracts
  services/     Ticket workflows, activity logging, SQL filters and metrics
  models/       SQLAlchemy models, constraints and UTC timestamp adapter
  db/           Engine, sessions, initialization and idempotent seed
backend/tests/  Isolated API/business-rule tests and real-process restart test
```

Each mutation and related activity insertion share a transaction. Request sessions roll back on errors and close cleanly. Foreign keys are enabled for every SQLite connection. Agent deletion and physical deletion of tickets with children are restricted. Soft deletion retains entries/history with valid foreign keys, excludes tickets from list/metrics, and returns 404 for deleted nested resources. There is no restore/purge endpoint.

`create_all` initializes new databases; it is **not schema migration tooling**. If an existing database predates a schema change, preserve it and migrate/rebuild the affected tables, or initialize a separate demo database. Existing tables are not silently recreated. For a production schema lifecycle, introduce reviewed Alembic migrations.

Database access is isolated behind SQLAlchemy and `DATABASE_URL`; SQLite-specific connection settings are scoped to the SQLite dialect. PostgreSQL adoption would require installing a PostgreSQL driver, migrating data/schema, reviewing UTC/constraint behavior, and rerunning the suite against PostgreSQL. PostgreSQL is **not claimed as tested or ready out of the box**.

## Testing

Run from the indicated directory, with dependencies already installed:

```sh
# backend/
.venv/Scripts/python.exe -m pytest -q
.venv/Scripts/python.exe -m pip check

# frontend/
npm run typecheck
npm run typecheck:e2e
npm test
npm run build
npm audit
```

### Live browser acceptance

Stop normal servers first; the suite owns ports **5173 and 8000** and refuses to reuse existing servers.

```sh
# frontend/ — one-time Chromium download
npx playwright install chromium
# Starts both real servers, exercises Chromium, then shuts them down
npm run test:e2e
```

On Linux CI you may need `npx playwright install --with-deps chromium` with suitable OS-package privileges. E2E creates an isolated database under ignored `frontend/e2e/.runtime/`, never touches your normal database, seeds real agents/tickets, checks UI and persisted API results, and cleans up its server processes and database. Backend tests likewise use isolated test databases. See [`frontend/e2e/README.md`](frontend/e2e/README.md) for timeout settings and troubleshooting.

### Executed verification

- **89 backend tests:** CRUD, required-field/enum/email validation, chronological ordering, actual-change audit logging, transaction rollback, SQL AND filters and priority sorting, dashboard counts, strict overdue boundaries, foreign keys, soft deletion, seed idempotence, safe errors, and real HTTP persistence across two backend processes.
- **31 frontend tests:** API contracts/errors, input limits/validation, timestamps, timelines, component workflows, and rapid filter/reset/back-navigation regressions.
- **3 live Chromium scenarios:** full ticket lifecycle; search, combined filters, sorting and rapid control changes; metric refresh after external mutation. These include desktop/tablet screenshots with no document overflow at 1440px and 768px.
- Frontend TypeScript, strict E2E TypeScript, production build, Python dependency checks, and npm security audit.

Screenshots and HTML reports are generated under ignored `frontend/test-results/` and `frontend/playwright-report/`; `npx playwright show-report` opens the report. Screenshots verify layout dimensions and aid review; this is not a pixel-diff visual regression suite.

## Demonstration walkthrough

1. Run the optional seed and start both servers. Show six metrics and the overdue definition.
2. Create a ticket; open its detail page and edit its subject/customer/description.
3. Change status, priority and assignee; show before/after activities. Save an unchanged editor to demonstrate no extra event.
4. Add a public reply and an amber internal note with an explicit author; reload to show persistence.
5. Search by subject/customer, combine all three filters, sort priorities, and reset.
6. Resolve an older seeded ticket and show overdue decreasing without it counting as open or in progress.
7. Delete a test ticket with confirmation; show its removal and updated metrics.
8. Restart the backend and reload another ticket to show its data remains intact.

## What works / limitations

All mandatory features in the supplied textual brief are implemented and covered by the checks above. There are no known blocking defects from the executed suites. Remaining intentional limitations:

- No authentication, authorization, customer portal, external email delivery, file attachments, or configurable SLA workflows. **Internal notes are visually distinct but not access-controlled. Do not expose this unauthenticated demo publicly.**
- No dark mode, agent-management UI, bulk actions, restore UI, or optimistic-concurrency/version checks. Last committed edit wins for simultaneous operators.
- No server-side pagination or migrations; SQLite is appropriate for the assessment, not a high-write multi-instance deployment.
- Browser verification uses Chromium on Windows, not Firefox/Safari or native mobile devices. Non-Windows commands are documented but not executed locally.
- A dependency deprecation warning from Starlette/httpx test integration may appear; tests pass. Dependency versions and advisories can change after this verification.

## Deployment guidance

This repository provides a buildable application, **not a public-production security configuration** or one-click deployment button.

1. Build with `npm ci && npm run build` in `frontend/`.
2. Serve `frontend/dist` through a static web server with SPA fallback to `index.html` for `/tickets/{id}` deep links.
3. Install Python dependencies into a server virtualenv, initialize the database, and run `python -m uvicorn app.main:app --host 127.0.0.1 --port 8000` behind a process supervisor, without `--reload`.
4. Reverse-proxy `/api` to Uvicorn on the same origin; do not expose the Vite development server. Use HTTPS.
5. Put the SQLite file on a persistent, backed-up local volume with write permission for the API process. Avoid ephemeral container filesystems, network-filesystem SQLite, and multiple write-heavy replicas. Use SQLite's backup tooling rather than an inconsistent live file copy.
6. Before any public deployment, add real access controls (including internal-note visibility), rate limiting, reviewed migrations, environment-specific origins, backups and monitoring. Do not put secrets into `VITE_` variables.

## AI tools usage

Developed with the AI coding assistant in Zed, including delegated backend/frontend implementation and browser verification. AI assisted with architecture, source, tests, debugging, dependency review, and documentation. Claims above are grounded in executed automated checks; AI output is not a substitute for human review. No paid external API, customer-data upload service, or credentials are required by the application.

All seeded names and customer information are fictional demo data. Source is in [`backend/`](backend/) and [`frontend/`](frontend/). Repository license: [`LICENSE`](LICENSE).
