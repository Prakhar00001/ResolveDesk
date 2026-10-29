# Free deployment: Render + Neon

**Status:** free-hosting configuration is committed in this repository; no public service or Neon database has been created by the coding assistant. Your Render/Neon account connections are required. No Groq key is needed.

## Fast setup

### 1. Create the database — Neon Free

1. Sign in at [Neon](https://console.neon.tech/) and create a **Free** PostgreSQL project. Choose a region close to Render's Singapore service when available.
2. Click **Connect**, select the database/role, and enable **connection pooling**.
3. Copy only the PostgreSQL **connection URI**, not the surrounding `psql` command. Retain `sslmode=require` and any `channel_binding=require` parameter Neon supplies.
4. Keep this URI private. It contains a database password. **Do not paste it into chat or commit it.**

The app accepts `postgresql://`, `postgres://`, or `postgresql+psycopg://` URLs and uses the installed psycopg 3 driver. Neon supplies a complete encoded URL; do not manually edit its password.

### 2. Create the application — Render Free

1. Open [ResolveDesk's Render setup](https://render.com/deploy?repo=https://github.com/Prakhar00001/ResolveDesk).
2. Sign in, connect `Prakhar00001/ResolveDesk`, branch `main`, and use the root **`render.yaml`**. Alternatively choose **New → Blueprint** in Render.
3. When prompted for **`DATABASE_URL`**, paste the private Neon URI **directly into Render**.
4. Confirm the service plan is **Free**, there is **no disk**, and no paid database or workspace upgrade is selected. The Blueprint creates only the web service; Neon is managed separately.
5. Create/deploy the service. It builds React and installs Python dependencies, then initializes/seeds the Neon database at startup.
6. Once Live, open the actual HTTPS URL assigned by Render. Username: **`reviewer`**. Retrieve the generated **`APP_ACCESS_PASSWORD`** from Render's **Environment** settings and use it in the browser's login prompt.

Share the access password privately with reviewers; never put it in a README or chat. Account verification requirements can vary. There is no claimed public URL until your account creates the service.

**Important:** if updating an existing Blueprint, Render does not prompt for newly added `sync: false` secrets. Set `DATABASE_URL` manually in its Environment settings. A previously paid service/disk is not guaranteed to disappear just because this file changed: export needed data and explicitly remove the old paid disk/resources and select Free. Verify the dashboard estimate before applying changes.

### 3. Check the live deployment

- `/healthz` works without a password and returns minimal health information only.
- UI, API, assets and `/docs` require the shared password.
- Create a ticket, change status/priority/assignee, add a public reply/internal note, and verify activity history.
- Open a ticket's detail URL in a fresh tab and refresh it.
- Use **Manual Deploy → Deploy latest commit**, wait for Live again, and verify your ticket and conversation survived. Data lives in Neon, not Render's temporary filesystem.
- Test search, combined filters, priority sorting and dashboard counts.
- Delete only your test ticket; verify counts update.

Automatic deploys are off. Deploy reviewed changes manually. Check the repository's **Actions → PostgreSQL compatibility** result before deploying database changes.

## Why this setup is free and durable

| Component | Plan | Role |
| --- | --- | --- |
| Render Python web service | Free | FastAPI serves both compiled React and `/api` on one HTTPS origin |
| Neon PostgreSQL | Free | Persistent tickets, entries, agents and activity history |
| Local development | SQLite | Existing zero-configuration workflow remains unchanged |

Render Free's filesystem is ephemeral, so **SQLite is forbidden by the hosted Blueprint** using `REQUIRE_POSTGRES=true`. Missing/invalid database configuration stops startup instead of silently using a temporary database. No paid persistent disk is needed.

**Free-tier limitations:**

- Render sleeps after 15 minutes without inbound traffic. The next visit can take about a minute to wake. Open the app a couple of minutes before your interview.
- Render grants 750 free service hours per workspace/month, shared with your other free services. Bandwidth/build-minute quotas also apply.
- Neon currently advertises 1 GB database storage and 100 CU-hours per project/month on Free. Compute can suspend while idle; durable data remains stored. Quota exhaustion can interrupt availability.
- An open dashboard polls every 30 seconds, and health checks query the database while the service runs. Close unused demo tabs rather than keeping the app/database active continuously.
- Free plans are for assessment/hobby use, not production uptime guarantees. Do not use keep-alive services to defeat sleep behavior.
- Stay on Free, monitor usage and spend settings, and do not opt into metered upgrades unintentionally. Render can charge usage overages if a payment method is present; without one, services/builds may be suspended at quota limits.
- Render's own free PostgreSQL expires after 30 days; **this setup uses Neon instead**.

See current [Render Free limits](https://render.com/docs/free) and [Neon pricing](https://neon.com/pricing); providers can change their offers.

## Runtime configuration

| Variable | Hosted value |
| --- | --- |
| `APP_ENV` | `production` |
| `DATABASE_URL` | Neon pooled connection URI, entered privately in Render |
| `REQUIRE_POSTGRES` | `true`; prevents accidental ephemeral SQLite storage |
| `APP_ACCESS_USERNAME` | `reviewer` |
| `APP_ACCESS_PASSWORD` | Random secret generated by Render; minimum 16 characters |
| `SEED_DEMO` | `true`; non-destructive, idempotent demo seed |
| `PORT` | Supplied by Render |
| `FRONTEND_DIST` | Defaults to the compiled `frontend/dist` in `backend/start.py` |

Do not change the Render root directory to `backend`: the build also needs `frontend`. Native Python hosting includes Node/npm. `python backend/start.py` resolves paths, validates the access gate and database settings, initializes tables, optionally seeds and starts one worker. Do not use `--reload` in hosting.

Database URLs are normalized without losing encoded credentials or SSL options. PostgreSQL uses `NullPool` because Neon's pooled endpoint handles connection pooling, with a finite connection timeout. SQLite connections retain their local foreign-key/timeout settings.

Setting `SEED_DEMO=false` stops adding demo data but does not delete existing records. Running the seed again does not overwrite edits or restore soft-deleted tickets.

## Security and data

The shared HTTP Basic gate protects the whole hosted demo, not individual customer accounts. Everyone holding its password can view and modify all tickets and internal notes. Actor names remain user-supplied; there is no per-user verified identity, authorization or in-app logout. Use HTTPS, fictional data, a private browser window, and rotate the shared password after the assessment.

No secret belongs in React's `VITE_` variables. No Groq or other AI-provider key is used. Revoke previously exposed keys at their provider.

A new Neon database is initialized empty and optionally seeded. **Existing local SQLite tickets are not automatically migrated.** Your local SQLite file is left untouched. If you have important local records, export/migrate them deliberately before changing the local database URL.

`create_all` is initialization, not schema migrations. Back up important data and introduce reviewed migrations before making schema-changing updates. For a Neon backup, use its supported export tools or `pg_dump` from a trusted machine, keep the URI out of command history, and store backups privately. No database export is served through this app.

## Verification

Local validation after the switch: **227 backend tests passed, 7 skipped**, run in two serial groups after a combined run timed out. Four skips require a real PostgreSQL test URL; three require unavailable Windows symlink privileges. The existing compiled-production browser test was previously verified, and deployment changes do not change frontend code.

PostgreSQL URL/driver configuration, TLS option preservation, connection settings, safe errors, SQLite regression behavior and the startup PostgreSQL requirement are unit-tested. Real PostgreSQL API tests are included in `backend/tests/test_postgres.py` and run in `.github/workflows/postgres.yml` using a disposable PostgreSQL service. A passing GitHub Actions result is separate from a successful connection to your Neon account; live Neon/Render checks still require account setup.

```sh
# backend/ — Windows
.venv/Scripts/python.exe -m pip install -r requirements.txt
.venv/Scripts/python.exe -m pytest -q

# frontend/ — optional compiled-production browser check
npm run test:production
```

For an optional local PostgreSQL test, set `TEST_POSTGRES_URL` **privately** to a dedicated test database and run `python -m pytest tests/test_postgres.py -q -rs`. Tests create/drop an isolated random schema and require CREATE SCHEMA permission. Never use an important production database for testing. Without a test URL, integration tests explicitly skip rather than pretending to pass.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Missing `DATABASE_URL` | Enter Neon URI in Render Environment, not GitHub/source files |
| `REQUIRE_POSTGRES` rejects SQLite | Use Neon URI; do not fall back to SQLite on Render Free |
| Database connection fails | Check Neon project is active, correct pooled endpoint/credentials, SSL options, quotas and network status |
| Build cannot find frontend | Keep Render root at repository root and use Blueprint build command |
| First request is slow | Expected free-service/database cold start; wait before retrying |
| Browser keeps asking for login | Use `reviewer` and current generated password; cached browser credentials may require a fresh private window |
| Database schema changed | Initialization does not migrate existing tables; review migrations instead of deleting customer data |
| Existing Blueprint didn't request secret | Set new `DATABASE_URL` manually in Environment and redeploy |
| Unexpected billable service/disk | Stop and inspect existing resources; this Blueprint requests Free and creates no disk/database |
