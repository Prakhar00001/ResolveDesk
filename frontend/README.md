# ResolveDesk frontend

A responsive React + TypeScript support workspace using Vite, Tailwind CSS, Lucide, React Router, and TanStack Query. All workspace data comes from the backend; the UI does not seed or substitute demo data.

## Run

Use Node.js 24 (validated with 24.11.0). Vitest 5 requires Node.js `^22.12.0 || ^24.0.0 || >=26.0.0`; the application itself requires Node.js 20+ for React Router 7.

```sh
npm install
npm run dev
```

Run the backend on `http://localhost:8000`. The Vite development server proxies `/api` to that address. To use another API, set `VITE_API_BASE_URL` in `.env.local` (see `.env.example`); cross-origin requests require the backend to allow your frontend origin. `VITE_` values are public build-time configuration, not secrets.

```sh
npm run typecheck
npm test
npm run build
```

The recommended Render deployment serves this compiled `dist` through FastAPI on the same origin as `/api`, with a shared access password and persistent database; see [`../DEPLOYMENT.md`](../DEPLOYMENT.md). No separate frontend service or Groq key is required. No live cloud URL exists until the account owner creates the Blueprint and approves billing.

For alternative production hosts, serve `dist` with an SPA fallback to `index.html`, and reverse-proxy `/api` to the backend (or configure the API URL before building). `npm run preview` also proxies `/api` to `http://localhost:8000`, because Vite's preview server inherits `server.proxy` when `preview.proxy` is unset. This local preview behavior does not configure your production hosting; a deployed static build still needs the reverse proxy or a build-time API URL.

## Workspace

- Live dashboard statistics and URL-persisted search/status/priority/assignee filters combined with AND; last-updated or priority sorting, reset, and client-side pagination.
- Ticket creation, all-field editing with changed-fields-only PATCH payloads, inline status/priority/assignment updates, and confirmed soft deletion.
- Chronological conversation and activity history; public replies and internal notes with author attribution. Replies are saved through the API, not sent by email by the frontend.
- Exact local timestamps on hover/focus, relative time labels, accessible dialogs with focus trapping/restoration, loading/error/retry/empty states, and success notifications.
- Query invalidation after mutations, 30-second polling, and refresh on window focus. No per-user authentication or fabricated signed-in user; the hosted demo has a shared server-level access gate. Agents come from `/api/agents`, while message author and optional update actor are entered explicitly.

## Tests

Vitest + Testing Library run without a browser installation. Tests cover API errors and payloads, filter encoding, validation, UTC/relative timestamps, chronological ordering, and core user workflows with mocked HTTP responses. Test fixtures are confined to test files.

```sh
npm run typecheck:e2e
npx playwright install chromium
npm run test:production
```

The production smoke builds React, starts FastAPI on port 8002 with production
settings and an isolated database, and runs real Chromium against the compiled UI
without Vite. Generated credentials stay in memory/environment variables; traces
and video are disabled. It verifies protected UI/API/assets/docs, public health,
authenticated ticket creation and internal notes, reload persistence, deep links,
and metrics. Artifacts are ignored under `test-results/production/`; test data and
servers are cleaned up. Stop any process using port 8002 first.
