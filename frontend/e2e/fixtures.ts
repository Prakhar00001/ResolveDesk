import { writeFile } from "node:fs/promises";
import { test as base, expect, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";

type Agent = { id: number; name: string };
export type Ticket = {
  id: number; subject: string; description: string;
  customer_name: string; customer_email: string;
  status: string; priority: string; assignee_id: number | null;
};
export type Metrics = {
  total: number; open: number; in_progress: number;
  resolved: number; urgent: number; overdue: number;
};

export type Desk = {
  agents: Agent[];
  track: (id: number) => void;
  create: (fields: Partial<Ticket> & { subject: string }) => Promise<Ticket>;
};

export const test = base.extend<{ desk: Desk }>({
  desk: async ({ request }, use) => {
    const response = await request.get("/api/agents");
    expect(response.ok()).toBeTruthy();
    const agents: Agent[] = await response.json();
    expect(agents.length).toBeGreaterThanOrEqual(2);
    const ids: number[] = [];
    try {
      await use({
        agents,
        track: (id) => ids.push(id),
        create: async (fields) => {
          const response = await request.post("/api/tickets", {
            data: {
              description: "Live browser fixture, not a mocked API.",
              customer_name: "E2E Customer", status: "Open", priority: "Medium",
              ...fields,
            },
          });
          expect(response.status()).toBe(201);
          const ticket: Ticket = await response.json();
          ids.push(ticket.id);
          return ticket;
        },
      });
    } finally {
      for (const id of ids.reverse()) {
        const response = await request.delete(`/api/tickets/${id}`);
        expect([204, 404]).toContain(response.status());
      }
    }
  },
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.url().includes("/api/") && response.status() >= 500)
        errors.push(`${response.status()} ${response.url()}`);
    });
    await use(page);
    expect(errors, "No uncaught browser errors or API 5xx responses").toEqual([]);
  },
});
export { expect };

export async function metrics(request: APIRequestContext): Promise<Metrics> {
  const response = await request.get("/api/dashboard");
  expect(response.ok()).toBeTruthy();
  return response.json();
}

export async function expectMetrics(page: Page, expected: Metrics) {
  const statistics = page.getByRole("region", { name: "Workspace statistics" });
  for (const [label, key] of [
    ["total tickets", "total"], ["open tickets", "open"],
    ["in progress", "in_progress"], ["resolved", "resolved"],
  ] as const) {
    await expect(statistics.getByRole("button", {
      name: `Show ${label}: ${expected[key]}`, exact: true,
    })).toBeVisible();
  }
  await expect(statistics.getByRole("button", { name: /urgent tickets/ }))
    .toHaveText(`${expected.urgent} urgent tickets`);
  await expect(statistics.locator('[title="Overdue count is calculated by the backend"]'))
    .toHaveText(`${expected.overdue} overdue`);
}

export async function screenshots(page: Page, info: TestInfo, name: string) {
  for (const viewport of [
    { width: 1440, height: 1000 }, { width: 768, height: 1024 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    const file = `${name}-${viewport.width}x${viewport.height}.png`;
    const path = info.outputPath(file);
    await page.screenshot({ path, animations: "disabled" });
    await info.attach(file, { path, contentType: "image/png" });
    const layout = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      overflowing: [...document.querySelectorAll("main, main section, main table")]
        .map((element) => ({ tag: element.tagName, width: element.getBoundingClientRect().width,
          right: element.getBoundingClientRect().right }))
        .filter((element) => element.right > window.innerWidth),
    }));
    const layoutFile = `${name}-${viewport.width}-layout.json`;
    const layoutPath = info.outputPath(layoutFile);
    await writeFile(layoutPath, JSON.stringify(layout, null, 2));
    await info.attach(layoutFile, { path: layoutPath, contentType: "application/json" });
    expect(layout.document, `${name}: document must fit the ${viewport.width}px viewport`)
      .toBeLessThanOrEqual(viewport.width);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
