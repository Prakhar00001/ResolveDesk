# Deploy ResolveDesk to Render

## Status and platform choice

**The repository is deployment-ready; a public cloud deployment has not yet been created.** Launching requires your Render account, connecting this GitHub repository, and approving Render's paid service estimate. No Render account/API access was available to the coding assistant. Do not interpret the locally tested production configuration as an already-live URL.

Use **one Render native Python web service with a 1 GB persistent disk**. Render's Python runtime includes Node and npm, so its build can compile React and install FastAPI without Docker. FastAPI serves the built UI and API from the same HTTPS origin; this eliminates production CORS and frontend/API URL coordination. SQLite stays on the attached disk, not the service's ephemeral source filesystem.

This is suitable for a small assessment demo with a few reviewers. It is not a multi-tenant production help desk.

### Expected cost — approval required

Render's published pricing checked during this change lists:

| Resource | Configuration | Published monthly baseline |
| --- | --- | --- |
| Web service | `0.5c-512mb`, one instance | $7 |
| Persistent disk | 1 GB | $0.25 |
| Hobby workspace | No Pro workspace required | $0 |
| **Total baseline** | Before tax and metered overages | **$7.25/month** |

Review **the current estimate in your own Render dashboard** before approving. Prices, bandwidth/build-minute allowances, taxes, and other usage charges can change. No billable resources have been provisioned by this change.

**Do not switch this blueprint to a free service without changing storage architecture.** Render's free web services cannot attach a persistent disk; SQLite on an ephemeral filesystem would lose tickets during restarts/redeploys. A frontend-only Vercel deployment also does not provide persistent SQLite for this backend.

## Deploy steps

1. Sign in to [Render](https://dashboard.render.com/) using your own account. Do not paste account credentials, API tokens, or card information into chat.
2. Open the repository's [Render deployment setup](https://render.com/deploy?repo=https://github.com/Prakhar00001/ResolveDesk). Alternatively, choose **New → Blueprint** in Render and connect `Prakhar00001/ResolveDesk`, branch `main`.
3. Grant the Render GitHub App access to this repository if prompted. Use the root **`render.yaml`**; do not set a `backend` root directory, because the build needs `frontend/` too.
4. Review the configuration and billing estimate. It creates only one Python web service, in Singapore, with one attached disk at `/var/data`. Change the region before creation if appropriate for your audience.
5. Approve and create the Blueprint only if you accept the charges. The build installs backend dependencies and runs `npm ci` and the frontend production build.
6. Render generates **`APP_ACCESS_PASSWORD`** securely. When the service is Live, reveal it in the service's **Environment** settings. The username is **`reviewer`**. Keep this password in a password manager and share it with interviewers through a private channel, not in GitHub or chat.
7. Open the **actual HTTPS URL assigned by Render**, visible in the service dashboard. Your browser prompts for the shared username and password. No exact public hostname is claimed in this repository because the service has not yet been created.
8. Perform the post-deploy acceptance checks below. Redeploy once to verify persistence on the actual disk.

Automatic deploys are intentionally **off** in the Blueprint. To publish later changes, use Render's **Manual Deploy → Deploy latest commit** after reviewing/testing them. You can deliberately enable automatic deploys later in the dashboard. Do not delete/recreate the persistent disk when deploying changes.

## Runtime configuration

| Variable | Render value / behavior |
| --- | --- |
| `APP_ENV` | `production`; refuses startup without the access password and valid built frontend |
| `APP_ACCESS_USERNAME` | `reviewer` |
| `APP_ACCESS_PASSWORD` | Render-generated random secret; at least 16 characters required in production |
| `DATABASE_URL` | `sqlite:////var/data/resolvedesk.db` — four slashes represent an absolute Unix path |
| `SEED_DEMO` | `true` for the assessment; idempotently adds missing demo records at startup |
| `PORT` | Supplied by Render; defaults to 10000 locally |
| `FRONTEND_DIST` | Set automatically by `backend/start.py` to the repository's compiled `frontend/dist` |
| `PYTHON_VERSION` | `3.11.14` in the Blueprint; same Python minor as the verified local environment |
| `NODE_VERSION` | `24` for builds |

No Groq/AI provider key, external API key, or email service is needed. **Never add the exposed key from chat to this service. Revoke it at its provider.**

The startup command is **`python backend/start.py`**, run from the repository root. It resolves paths, validates configuration, optionally seeds, then starts one Uvicorn worker on `0.0.0.0` and the platform's port. Do not run the development server or use `--reload` in hosting.

The persistent disk is available only **at runtime**, not during a Render build or pre-deploy command. Initialization/seeding therefore happens in the startup command. Repeated seeding does not overwrite edits, duplicate demo tickets, or restore deleted demo tickets. Set `SEED_DEMO=false` for no new demo records; this does not delete existing ones.

### Health checks

Render checks **`GET /healthz`** without authentication. A successful database probe returns only `{"status":"ok"}` with HTTP 200. A failed probe returns 503 without exposing database or ticket details. UI, API, assets, and API documentation all require the access password in production; anonymous access returns 401.

## Access/security boundary

The deployment adds a **shared HTTP Basic access gate**, not full application accounts or roles. It covers the entire app, including internal notes and API docs. Browser credentials are reused on same-origin UI/API requests. Render provides HTTPS; never send the production password over plain HTTP or put it in a URL.

- Every person with the shared password can read and modify **all** tickets and notes.
- Names entered for authors/activity actors remain user-supplied, not verified account identities.
- There is no per-user audit identity, customer portal isolation, password-reset flow, or granular permission model.
- There is no in-app logout for browser Basic authentication. Use a private window and close it when done; browser credential caching behavior varies. Rotate the shared password in Render after the demonstration or if shared too widely, then redeploy.
- Credentials are never placed in React's `VITE_` variables, the source repository, images, or documentation.
- Responses include no-store caching and security headers. This shared gate is not a substitute for rate limiting, SSO, or proper account authorization for real customer data.

Only use fictional support data for this assessment deployment. For a real production help desk, add account-based access control, protected internal-note permissions, rate limiting, migrations, monitoring, and a reviewed backup/recovery policy first.

## Post-deploy acceptance — must run against the live URL

These checks cannot be claimed as passed until the account-owned service exists:

1. Open `/healthz` in a private browser without credentials: HTTP 200, no ticket information.
2. Open `/` and `/api/tickets` without credentials: a login prompt / HTTP 401, never ticket data.
3. Log in with the Render-generated credentials and confirm the UI loads, all metrics appear, and seeded agents/tickets are available.
4. Create a ticket, edit status/priority/assignee, add a public reply and an internal note, and verify their activities.
5. Search by customer, combine status/priority/assignee filters, sort by priority, and reset.
6. Copy a ticket detail URL into a fresh tab and refresh it; the React page must render, not return a server 404.
7. Use **Manual Deploy → Deploy latest commit**, wait for the service to become Live again, and verify the ticket, entries, and history still exist. Demo records should not duplicate.
8. Confirm resolved tickets are not overdue and that overdue metrics use creation time.
9. Delete only your test ticket and verify the counts update.

After those pass, record the actual deployment URL and date in the README. Do not commit its access password.

## Local verification of the hosted configuration

No cloud account is needed to test the production build and access gate locally:

```sh
# frontend/
npm ci
npx playwright install chromium
npm run typecheck:e2e
npm run test:production

# backend/
.venv/Scripts/python.exe -m pytest -q
```

`test:production` builds React, serves that actual compiled bundle through FastAPI with production settings, and runs Chromium using generated runtime-only credentials and an isolated test database. It covers anonymous access denial, health, authenticated UI, ticket creation, an authored internal note, reload persistence, deep links, and metrics. It does not use Vite or a mocked API. Its test servers and database are cleaned up afterward. It is **local production-mode verification**, not proof of a successful Render deployment.

Executed checks for this configuration: **197 backend tests passed, 3 Windows symlink-privilege skips; 31 frontend tests passed; the production Chromium scenario passed; frontend/E2E TypeScript and production build passed; npm audit reported zero vulnerabilities.** The Blueprint also passed validation against Render's published JSON schema. This validates its structure, not account provisioning, billing, regional capacity, or a successful remote build.

Use `.venv/bin/python` on macOS/Linux. Non-Windows execution has not been independently verified here.

## Storage, backups, and operational limits

- Keep **one service instance and one Uvicorn worker** for this assessment configuration. Render disks cannot be shared between instances; do not horizontally scale this SQLite deployment.
- Disk-backed Render services have **brief downtime during redeploys**; the disk is attached to one instance at a time. No zero-downtime claim is made.
- Render's daily disk snapshots are not a substitute for database-aware SQLite backups. Use SQLite's online backup API and securely download/store backups separately from the service disk.
- Example in the Render service's Shell (creates a database backup on the same disk; copy it off-host afterward):

```sh
python -c "import sqlite3; from pathlib import Path; Path('/var/data/backups').mkdir(exist_ok=True); source=sqlite3.connect('/var/data/resolvedesk.db'); target=sqlite3.connect('/var/data/backups/resolvedesk-backup.db'); source.backup(target); target.close(); source.close()"
```

Do not copy a live SQLite file blindly, and do not publish backups through the web server. The app serves only the frontend build assets, not the database directory.

Schema creation uses `create_all`, not migrations. Take a backup before schema-changing updates and add reviewed migrations before storing important data. Restoring an older code build does not automatically reverse database changes.

To stop ongoing charges after the assessment, review Render billing and delete the service/Blueprint and disk when no longer needed **after exporting any data you want to retain**. Removing a disk destroys its data; suspending compute alone can leave storage charges.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `APP_ACCESS_PASSWORD` startup error | Generated secret exists, is at least 16 characters, and the service was redeployed after an environment change |
| `FRONTEND_DIST` startup error | Root directory is the repository root and the build ran `npm run build --prefix frontend` |
| Database directory not writable | Disk is attached at `/var/data`; do not use pre-deploy seeding or the ephemeral default database |
| Health check fails | `/healthz` is configured; inspect startup logs and disk/database permissions, not the password-protected API |
| UI loads but API fails | Use the same service URL and default `/api`; remove stale `VITE_API_BASE_URL` overrides and reauthenticate |
| Login keeps returning 401 | Username is `reviewer`, password matches the environment, and browser isn't reusing cached old credentials |
| Tickets disappear after deploy | Confirm `DATABASE_URL` and disk mount exactly match the Blueprint; stop testing with important data until fixed |
| Old UI after deployment | Confirm the intended commit was manually deployed and refresh; index and API responses use no-store |

### Authoritative platform references

- [Render native runtimes and included Node/npm tools](https://render.com/docs/native-runtimes)
- [Blueprint specification](https://render.com/docs/blueprint-spec)
- [Persistent disk guarantees and limitations](https://render.com/docs/disks)
- [Current pricing](https://render.com/pricing)
- [Official repository deployment-link format](https://render.com/docs/deploy-to-render)
