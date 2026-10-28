import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const frontend = path.dirname(fileURLToPath(import.meta.url));
const backend = path.join(frontend, "../backend");
const python = process.env.E2E_PYTHON ?? path.join(
  backend, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const quotedPython = process.platform === "win32"
  ? `"${python}"`
  : `'${python.replace(/'/g, "'\\''")}'`;
const baseURL = "http://127.0.0.1:8002";
// Workers inherit these values; neither the password nor an auth trace is written to disk.
process.env.RESOLVEDESK_E2E_RUN_DIR ??= path.join(frontend, "e2e", ".runtime", randomUUID());
process.env.RESOLVEDESK_PRODUCTION_PASSWORD ??= randomBytes(32).toString("hex");

export default defineConfig({
  testDir: "./e2e",
  testMatch: "production/*.prod.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  globalTimeout: 110_000,
  expect: { timeout: 8_000 },
  outputDir: "./test-results/production",
  reporter: "list",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    httpCredentials: {
      username: "production-smoke",
      password: process.env.RESOLVEDESK_PRODUCTION_PASSWORD,
      origin: baseURL,
    },
    viewport: { width: 1440, height: 1000 },
    launchOptions: { timeout: 20_000, args: ["--disable-gpu"] },
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "production-chromium" }],
  webServer: {
    command: `${quotedPython} ../frontend/e2e/production/server.py`,
    cwd: backend,
    url: `${baseURL}/healthz`,
    env: {
      RESOLVEDESK_E2E_RUN_DIR: process.env.RESOLVEDESK_E2E_RUN_DIR,
      APP_ACCESS_USERNAME: "production-smoke",
      APP_ACCESS_PASSWORD: process.env.RESOLVEDESK_PRODUCTION_PASSWORD,
      APP_ENV: "production",
      PORT: "8002",
      SEED_DEMO: "true",
    },
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
