import { randomUUID } from "node:crypto";
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
// Inherited by workers and teardown; never use the developer's DATABASE_URL.
process.env.RESOLVEDESK_E2E_RUN_DIR ??= path.join(
  frontend, "e2e", ".runtime", randomUUID(),
);

export default defineConfig({
  testDir: "./e2e",
  // Avoid Vitest's default *.test / *.spec discovery without changing its config.
  testMatch: "**/*.pw.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  globalTimeout: 110_000,
  expect: { timeout: 8_000 },
  outputDir: "./test-results",
  reporter: [["list"], ["html", { open: "never" }]],
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "off",
    launchOptions: { timeout: 20_000, args: ["--disable-gpu"] },
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 1000 },
  },
  projects: [{ name: "chromium" }],
  webServer: [
    {
      command: `${quotedPython} ../frontend/e2e/server.py`,
      cwd: backend,
      url: "http://127.0.0.1:8000/api/agents",
      env: { RESOLVEDESK_E2E_RUN_DIR: process.env.RESOLVEDESK_E2E_RUN_DIR },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "npm run dev -- --host 127.0.0.1 --port 5173 --strictPort",
      cwd: frontend,
      url: "http://127.0.0.1:5173",
      env: { VITE_API_BASE_URL: "/api", BROWSER: "none" },
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
