# Live browser E2E

From `frontend/`, with Node/npm and the backend virtual environment and requirements installed:

```sh
npm ci
npx playwright install chromium
npm run typecheck:e2e
npm run test:e2e
```

The suite runs real Chromium against Vite (`127.0.0.1:5173`) and Uvicorn
(`127.0.0.1:8000`). Stop normal development servers first: neither server may be
reused, and Vite uses `--strictPort`. `VITE_API_BASE_URL=/api` is forced for the
existing Vite proxy to backend port 8000, avoiding environment overrides and CORS
changes. The backend command runs from `backend/`; `e2e/server.py` seeds via
`python -m app.db.seed` and runs Uvicorn's `app.main:app` without reload.

## Python selection

`playwright.config.ts` selects the existing backend interpreter by platform:

- Windows (`process.platform === "win32"`): `backend/.venv/Scripts/python.exe`.
- Other platforms: `backend/.venv/bin/python`.

Optionally set **`E2E_PYTHON` to the literal executable path** for another
interpreter with the backend requirements installed. It is one executable, not
a shell command, activation script, argument list, or environment-variable
expression. Prefer an absolute path; relative paths resolve from `backend/`.
Paths with spaces are quoted. For example, in PowerShell:

```powershell
$env:E2E_PYTHON = 'C:\Python\python.exe'
npm run test:e2e
```

Or in a POSIX shell:

```sh
E2E_PYTHON=/absolute/path/to/venv/bin/python npm run test:e2e
```

Windows execution is validated locally; the non-Windows selection is configured
but has not been executed on this Windows machine.

## Isolation and cleanup

Each run gets a UUID directory under ignored `e2e/.runtime/`, with an absolute
SQLite `DATABASE_URL` set **before any backend import or seed subprocess**.
Neither an inherited database URL nor the normal application database is used.
The seed CLI supplies real agents and demo tickets. Assertions use observed
baseline metrics/deltas, not fixed seed counts or agent IDs. Test-created tickets
are also cleaned up by a fixture, including after assertion failures.

A single worker runs three independent tests; the filter test includes both
settled and rapid-change scenarios in one browser context. All UI mutations in the lifecycle
test go through the browser; API requests inspect persisted results and
prepare/clean up fixtures for filter/refresh scenarios. No request interception,
response stubs, or mocked servers are used. Uncaught page errors and API 5xx
responses fail tests. `*.pw.ts` deliberately avoids Vitest's default test discovery.

Global teardown asks the Python wrapper to stop via a run-local shutdown file.
The wrapper stops Uvicorn, disposes SQLite connections and removes its entire
run directory before Playwright terminates its process trees (important on
Windows, where force-kill does not execute Python `finally` blocks). Cleanup
failure fails the run. Playwright owns both server processes; a 110-second suite
limit and server/test timeouts bound execution. If the runner/OS is forcibly
terminated, ignored runtime files can remain: first verify no E2E server is
running, then remove only `e2e/.runtime/`. Ordinary success and assertion-failure
runs shut down and clean up automatically.

## Coverage

- Required/whitespace fields, missing customer identifier, native and app email
  validation; invalid forms send no create requests.
- Full create and normalized persisted fields; edit subject, description, customer
  name/email; automatic status, priority, assignment, unassignment/reassignment.
- Public reply versus amber internal-note DOM, chronological ordering, persistence
  after reload, activity descriptions with old/new values and actor names.
- Observed metric deltas on create, status changes, urgency and deletion; explicit
  dashboard/inbox refresh after out-of-band API changes.
- AND search/status/priority/assignee with one-field-mismatch decoys, empty results,
  reset, updated/priority order (including ties), filter/sort URL persistence.
- A named rapid-change test step (`e2e/rapid-filters.ts`) dispatches native search-input and select
  events for all five controls in **one synchronous `page.evaluate` call**, with
  no waits between those events. It checks the real API query and exact matching
  tickets, all controls and URL parameters, reload, reset followed immediately by
  edits in another synchronous batch, back/forward, additional rapid edits after
  Back, and reset/Back restoration. The older settled-interaction test remains.
- Cancel/confirm deletion, restored metric baseline, API 404s and missing-ticket UI.

## Screenshots and layout regression

Six viewport screenshots are attached to the lifecycle test, under
`test-results/tickets.pw.ts-validated-cr-55d4e-istory-metrics-and-deletion-chromium/`
(directory name is chosen by Playwright):

| Page | 1440x1000 | 768x1024 |
| --- | --- | --- |
| Dashboard | `dashboard-1440x1000.png` | `dashboard-768x1024.png` |
| Conversation | `ticket-conversation-1440x1000.png` | `ticket-conversation-768x1024.png` |
| Activity history | `ticket-history-1440x1000.png` | `ticket-history-768x1024.png` |

They are viewport images, not full-page images or pixel-diff baselines. Each
capture records viewport/document widths and overflowing table/section bounds in
adjacent `*-layout.json` artifacts, then **asserts
`document.documentElement.scrollWidth <= viewport.width`**. Document overflow
fails the functional suite at either size; internal table scrolling is allowed.
The prior overflow and filter-race defects are resolved in product source and are
now covered against the live backend; see `DEFECTS.md` for historical context.

`test-results/` and `playwright-report/` are ignored. Failure screenshots
are retained; open the HTML report with `npx playwright show-report`. Tracing is
off by default to keep the suite within a bounded 120-second command on this
Windows machine. Chromium uses `--disable-gpu` to reduce resource demand and a
20-second launch timeout. On resource-constrained machines, use the lightweight
reporter (`npm run test:e2e -- --reporter=list`) to avoid HTML-report overhead.
For diagnosis, enable tracing explicitly with:

```sh
npm run test:e2e -- --grep "search, status" --trace on
```

## Typechecking and validation

`npm run typecheck:e2e` uses `tsconfig.e2e.json`: strict TypeScript, no emit,
ES2022 target, ESNext modules, Bundler resolution, DOM libraries and `@types/node`.
It includes `playwright.config.ts` and every TypeScript file under `e2e/`, separate
from the product build's TypeScript project.

The existing unit suite contains **31 tests**. Full validation commands are:

```sh
npm run typecheck:e2e
npm run build
npm test
npm run test:e2e
npm audit
```

Executed validation: strict E2E typechecking and production build passed,
**31/31 unit tests** passed, and `npm audit` reported **0 vulnerabilities**. The
full live suite exited successfully with **3/3 tests**, including its synchronous
rapid-filter step, using `npm run test:e2e -- --reporter=list`. All six layout
assertions passed: document widths were exactly **1440px** and **768px** at the
requested viewports. Some earlier attempts hit the bounded command timeout on
this resource-constrained machine; see `DEFECTS.md` for the distinction between
those attempts and the final completed run.

No product source is changed by this E2E extension. After a completed live run,
verify `e2e/.runtime/` is empty, ports 5173/8000 are closed and no matching E2E
server/browser processes remain.
