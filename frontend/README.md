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

For production, serve `dist` with an SPA fallback to `index.html`, and reverse-proxy `/api` to the backend (or configure the API URL before building). `npm run preview` also proxies `/api` to `http://localhost:8000`, because Vite's preview server inherits `server.proxy` when `preview.proxy` is unset. This local preview behavior does not configure your production hosting; a deployed static build still needs the reverse proxy or a build-time API URL.

## Workspace

- Live dashboard statistics and URL-persisted search/status/priority/assignee filters combined with AND; last-updated or priority sorting, reset, and client-side pagination.
- Ticket creation, all-field editing with changed-fields-only PATCH payloads, inline status/priority/assignment updates, and confirmed soft deletion.
- Chronological conversation and activity history; public replies and internal notes with author attribution. Replies are saved through the API, not sent by email by the frontend.
- Exact local timestamps on hover/focus, relative time labels, accessible dialogs with focus trapping/restoration, loading/error/retry/empty states, and success notifications.
- Query invalidation after mutations, 30-second polling, and refresh on window focus. No authentication or fabricated signed-in user; agents come from `/api/agents`, while message author and optional update actor are entered explicitly.

## Tests

Vitest + Testing Library run without a browser installation. Tests cover API errors and payloads, filter encoding, validation, UTC/relative timestamps, chronological ordering, and core user workflows with mocked HTTP responses. Test fixtures are confined to test files.
