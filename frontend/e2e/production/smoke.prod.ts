import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

test("production access gate, compiled UI and persisted ticket conversation", async ({
  page, request, playwright, baseURL,
}, info) => {
  const index = await readFile(new URL("../../dist/index.html", import.meta.url), "utf8");
  const assets = [...index.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)]
    .map((match) => match[1]);
  expect(assets.length, "The built index must reference compiled assets").toBeGreaterThan(0);

  // Do not use the authenticated request fixture for these access-gate probes.
  const anonymous = await playwright.request.newContext({ baseURL, httpCredentials: undefined });
  try {
    const health = await anonymous.get("/healthz");
    expect(health.status()).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });
    for (const url of ["/", "/tickets", "/api/tickets", "/docs", "/openapi.json", ...assets]) {
      const response = await anonymous.get(url);
      expect(response.status(), `Anonymous GET ${url}`).toBe(401);
      expect(response.headers()["www-authenticate"]).toMatch(/^Basic /);
    }
  } finally {
    await anonymous.dispose();
  }

  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  const scripts = page.waitForResponse((response) =>
    response.url().startsWith(`${baseURL}/assets/`) &&
    response.request().resourceType() === "script" && response.status() === 200,
  );
  const inboxRequest = page.waitForResponse((response) =>
    response.url().startsWith(`${baseURL}/api/tickets?`) && response.status() === 200,
  );
  const navigation = await page.goto("/tickets");
  expect(navigation?.status()).toBe(200);
  expect(await navigation!.text()).toBe(index);
  await scripts;
  await inboxRequest;

  const beforeResponse = await request.get("/api/dashboard");
  expect(beforeResponse.status()).toBe(200);
  const before: { total: number } = await beforeResponse.json();
  expect(before.total, "Production startup seeded the isolated database").toBeGreaterThan(0);

  await page.getByRole("region", { name: "Ticket inbox", exact: true })
    .getByRole("button", { name: "New ticket", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Create a ticket" });
  const fields = {
    subject: "Production browser smoke ticket",
    description: "Created through the compiled UI and real production backend.",
    customer_name: "Production Customer",
    customer_email: "production@example.com",
    status: "Open",
    priority: "Medium",
  };
  await modal.getByRole("textbox", { name: "Subject" }).fill(fields.subject);
  await modal.getByRole("textbox", { name: "Description" }).fill(fields.description);
  await modal.getByRole("textbox", { name: "Customer name" }).fill(fields.customer_name);
  await modal.getByRole("textbox", { name: "Customer email" }).fill(fields.customer_email);
  await modal.getByLabel("Status", { exact: true }).selectOption(fields.status);
  await modal.getByLabel("Priority", { exact: true }).selectOption(fields.priority);
  const createdResponse = page.waitForResponse((response) =>
    response.url() === `${baseURL}/api/tickets` && response.request().method() === "POST",
  );
  await modal.getByRole("button", { name: "Create ticket", exact: true }).click();
  const created = await createdResponse;
  expect(created.status()).toBe(201);
  const ticket: { id: number } = await created.json();
  expect(await created.json()).toMatchObject(fields);
  const route = `/tickets/${ticket.id}`;
  await expect(page).toHaveURL(route);
  await expect(page.getByRole("heading", { level: 1, name: fields.subject })).toBeVisible();

  const conversation = page.getByRole("tabpanel", { name: /Conversation/ });
  const note = {
    author: "Production Reviewer",
    content: "Persist this internal handoff from the production browser.",
    entry_type: "Internal Note",
  };
  await conversation.getByLabel("Message type", { exact: true }).selectOption(note.entry_type);
  await conversation.getByRole("textbox", { name: /Your name/ }).fill(note.author);
  await conversation.getByRole("textbox", { name: "Internal note", exact: true }).fill(note.content);
  const addedResponse = page.waitForResponse((response) =>
    response.url() === `${baseURL}/api/tickets/${ticket.id}/entries` &&
    response.request().method() === "POST",
  );
  await conversation.getByRole("button", { name: "Add note", exact: true }).click();
  const added = await addedResponse;
  expect(added.status()).toBe(201);
  expect(await added.json()).toMatchObject(note);
  const entry = conversation.getByRole("listitem").filter({ hasText: note.content });
  await expect(entry).toHaveCount(1);
  await expect(entry.getByRole("heading", { name: note.author, exact: true })).toBeVisible();
  await expect(entry.getByText(note.entry_type, { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: fields.subject })).toBeVisible();
  await expect(entry).toHaveCount(1);
  await expect(entry.getByRole("heading", { name: note.author, exact: true })).toBeVisible();
  const persisted = await request.get(`/api/tickets/${ticket.id}`);
  expect(persisted.status()).toBe(200);
  expect(await persisted.json()).toMatchObject({ ...fields, entries: [note] });

  // A new document navigation must be served by the backend's SPA fallback,
  // rather than only working through React Router's client-side transitions.
  const freshPage = await page.context().newPage();
  try {
    const deepLink = await freshPage.goto(route);
    expect(deepLink?.status()).toBe(200);
    expect(deepLink?.headers()["content-type"]).toContain("text/html");
    expect(await deepLink!.text()).toBe(index);
    await expect(freshPage.getByRole("heading", { level: 1, name: fields.subject })).toBeVisible();
    await expect(freshPage.getByRole("listitem").filter({ hasText: note.content })).toContainText(note.author);
    await freshPage.screenshot({
      path: info.outputPath("production-1440x1000.png"), animations: "disabled",
    });
  } finally {
    await freshPage.close();
  }

  const metrics = await request.get("/api/dashboard");
  expect(metrics.status()).toBe(200);
  expect(await metrics.json()).toMatchObject({ total: before.total + 1 });
  expect(browserErrors, "No uncaught errors in the compiled UI").toEqual([]);
});
