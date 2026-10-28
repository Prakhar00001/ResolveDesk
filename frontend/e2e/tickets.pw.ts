import type { Locator, Page } from "@playwright/test";
import { rapidFilterScenario } from "./rapid-filters";
import { test, expect, metrics, expectMetrics, screenshots, type Ticket } from "./fixtures";

async function changeProperty(page: Page, control: Locator, value: string) {
  const saved = page.waitForResponse((response) =>
    /\/api\/tickets\/\d+$/.test(response.url()) && response.request().method() === "PATCH",
  );
  await control.selectOption(value);
  expect((await saved).status()).toBe(200);
  await expect(control).toHaveValue(value);
  await expect(control).toBeEnabled();
}

const inbox = (page: Page) => page.getByRole("region", { name: "Ticket inbox", exact: true });
const subjects = (page: Page) => inbox(page).locator("tbody tr td:first-child a");

test("validated create, edit, assignment, conversation, history, metrics and deletion", async ({ page, request, desk }, info) => {
  const before = await metrics(request);
  const [maya, jordan] = desk.agents;
  await page.goto("/tickets");
  await expectMetrics(page, before);
  await inbox(page).getByRole("button", { name: "New ticket", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Create a ticket" });
  const submit = modal.getByRole("button", { name: "Create ticket", exact: true });
  const subject = modal.getByRole("textbox", { name: "Subject" });
  const description = modal.getByRole("textbox", { name: "Description" });
  const email = modal.getByRole("textbox", { name: "Customer email" });
  const posts: string[] = [];
  const record = (req: import("@playwright/test").Request) => {
    if (req.method() === "POST" && req.url().endsWith("/api/tickets")) posts.push(req.postData() || "");
  };
  page.on("request", record);

  await submit.click();
  expect(await subject.evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBeTruthy();
  await subject.fill("   ");
  await description.fill("Valid issue description");
  await submit.click();
  await expect(modal.getByText("Please enter a subject.", { exact: true })).toBeVisible();
  await subject.fill("E2E browser lifecycle");
  await description.fill("   ");
  await submit.click();
  await expect(modal.getByText("Please describe the issue.", { exact: true })).toBeVisible();
  await description.fill("  Original browser-created issue  ");
  await submit.click();
  await expect(modal.getByText("Enter a customer name or email address.", { exact: true })).toBeVisible();
  await modal.getByRole("textbox", { name: "Customer name" }).fill("  Alex Browser  ");
  await email.fill("not-an-email");
  await submit.click();
  expect(await email.evaluate((el: HTMLInputElement) => el.validity.typeMismatch)).toBeTruthy();
  await email.fill("alex@example");
  await submit.click();
  await expect(modal.getByText("Please enter a valid customer email address.", { exact: true })).toBeVisible();
  expect(posts, "Invalid forms must not reach the backend").toHaveLength(0);

  await email.fill("alex@example.com");
  await subject.fill("  E2E browser lifecycle  ");
  await modal.getByLabel("Status", { exact: true }).selectOption("Open");
  await modal.getByLabel("Priority", { exact: true }).selectOption("Medium");
  await modal.getByLabel("Assignee", { exact: true }).selectOption(String(maya.id));
  const createdResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith("/api/tickets"),
  );
  await submit.click();
  const created = await createdResponse;
  expect(created.status()).toBe(201);
  const ticket: Ticket = await created.json();
  desk.track(ticket.id);
  expect(ticket).toMatchObject({
    subject: "E2E browser lifecycle", description: "Original browser-created issue",
    customer_name: "Alex Browser", customer_email: "alex@example.com",
    status: "Open", priority: "Medium", assignee_id: maya.id,
  });
  expect(posts).toHaveLength(1);
  page.off("request", record);
  await expect(page).toHaveURL(`/tickets/${ticket.id}`);
  await expect(page.getByRole("heading", { level: 1, name: ticket.subject })).toBeVisible();
  await page.getByRole("link", { name: "Back to ticket inbox" }).click();
  await expectMetrics(page, { ...before, total: before.total + 1, open: before.open + 1 });
  await inbox(page).getByRole("link", { name: ticket.subject, exact: true }).click();

  const properties = page.getByRole("complementary", { name: "Ticket information" });
  await properties.getByRole("textbox", { name: /Your name/ }).fill("E2E Operator");
  await page.getByRole("button", { name: "Edit ticket", exact: true }).click();
  const edit = page.getByRole("dialog", { name: `Edit ticket #${ticket.id}` });
  await expect(edit.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await edit.getByRole("textbox", { name: "Subject" }).fill("E2E browser lifecycle edited");
  await edit.getByRole("textbox", { name: "Description" }).fill("Revised issue with browser-verified details.");
  await edit.getByRole("textbox", { name: "Customer name" }).fill("Alex Updated");
  await edit.getByRole("textbox", { name: "Customer email" }).fill("updated@example.com");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("E2E browser lifecycle edited");
  await expect(page.getByRole("article").filter({ hasText: "Original request" }))
    .toContainText("Revised issue with browser-verified details.");
  await expect(properties.getByRole("link", { name: "updated@example.com" })).toBeVisible();

  await changeProperty(page, properties.getByLabel("Status", { exact: true }), "In Progress");
  await changeProperty(page, properties.getByLabel("Priority", { exact: true }), "Urgent");
  await changeProperty(page, properties.getByLabel("Assigned to", { exact: true }), String(jordan.id));
  await changeProperty(page, properties.getByLabel("Assigned to", { exact: true }), "");
  await changeProperty(page, properties.getByLabel("Assigned to", { exact: true }), String(jordan.id));

  const conversation = page.getByRole("tabpanel", { name: /Conversation/ });
  await expect(conversation.getByRole("button", { name: "Add reply" })).toBeDisabled();
  await conversation.getByRole("textbox", { name: "Reply message", exact: true }).fill("Public answer from the live browser.");
  await conversation.getByRole("button", { name: "Add reply", exact: true }).click();
  const entries = conversation.getByRole("list", { name: "Conversation, oldest first" }).getByRole("listitem");
  const publicEntry = entries.filter({ hasText: "Public answer from the live browser." });
  await expect(publicEntry).toHaveCount(1);
  await expect(publicEntry.getByText("Public Reply", { exact: true })).toBeVisible();
  await expect(publicEntry.getByText("Internal Note", { exact: true })).toHaveCount(0);
  await conversation.getByLabel("Message type", { exact: true }).selectOption("Internal Note");
  await expect(conversation.getByText("For your team only", { exact: true })).toBeVisible();
  await conversation.getByRole("textbox", { name: "Internal note", exact: true }).fill("Private handoff context from the live browser.");
  await conversation.getByRole("button", { name: "Add note", exact: true }).click();
  const noteEntry = entries.filter({ hasText: "Private handoff context from the live browser." });
  await expect(noteEntry).toHaveCount(1);
  await expect(noteEntry.getByText("Internal Note", { exact: true })).toBeVisible();
  await expect(noteEntry.getByText("Public Reply", { exact: true })).toHaveCount(0);
  await expect(noteEntry.getByRole("article")).toHaveClass(/bg-amber-/);
  await expect(publicEntry.getByRole("article")).not.toHaveClass(/bg-amber-/);
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText("Public answer from the live browser.");
  await expect(entries.nth(1)).toContainText("Private handoff context from the live browser.");

  await page.reload();
  await expect(entries).toHaveCount(2);
  await expect(properties.getByLabel("Status", { exact: true })).toHaveValue("In Progress");
  await expect(properties.getByLabel("Priority", { exact: true })).toHaveValue("Urgent");
  await expect(properties.getByLabel("Assigned to", { exact: true })).toHaveValue(String(jordan.id));
  const persisted = await request.get(`/api/tickets/${ticket.id}`);
  expect(persisted.status()).toBe(200);
  expect(await persisted.json()).toMatchObject({
    subject: "E2E browser lifecycle edited", description: "Revised issue with browser-verified details.",
    customer_name: "Alex Updated", customer_email: "updated@example.com",
    status: "In Progress", priority: "Urgent", assignee_id: jordan.id,
    entries: [
      { entry_type: "Public Reply", content: "Public answer from the live browser." },
      { entry_type: "Internal Note", content: "Private handoff context from the live browser." },
    ],
  });
  await screenshots(page, info, "ticket-conversation");
  await page.getByRole("tab", { name: "Activity history", exact: true }).click();
  const activities = page.getByRole("list", { name: "Activity history, oldest first" });
  for (const description of [
    "Ticket created",
    "Subject changed from E2E browser lifecycle to E2E browser lifecycle edited",
    "Description changed from Original browser-created issue to Revised issue with browser-verified details.",
    "Customer name changed from Alex Browser to Alex Updated",
    "Customer email changed from alex@example.com to updated@example.com",
    "Status changed from Open to In Progress",
    "Priority changed from Medium to Urgent",
    `Assignee changed from ${maya.name} to ${jordan.name}`,
    `Assignee changed from ${jordan.name} to Unassigned`,
    `Assignee changed from Unassigned to ${jordan.name}`,
    "Public Reply added", "Internal Note added",
  ]) {
    const activity = activities.getByRole("listitem").filter({ has: page.getByText(description, { exact: true }) });
    await expect(activity).toHaveCount(1);
    if (description !== "Ticket created") await expect(activity).toContainText("by E2E Operator");
  }
  await expect(activities.getByRole("listitem")).toHaveCount(12);
  await screenshots(page, info, "ticket-history");

  await page.getByRole("link", { name: "Back to ticket inbox" }).click();
  await expectMetrics(page, {
    ...before, total: before.total + 1, in_progress: before.in_progress + 1, urgent: before.urgent + 1,
  });
  await screenshots(page, info, "dashboard");
  await inbox(page).getByRole("link", { name: "E2E browser lifecycle edited", exact: true }).click();
  await changeProperty(page, properties.getByLabel("Status", { exact: true }), "Resolved");
  await page.getByRole("link", { name: "Back to ticket inbox" }).click();
  await expectMetrics(page, {
    ...before, total: before.total + 1, resolved: before.resolved + 1, urgent: before.urgent + 1,
  });
  await inbox(page).getByRole("link", { name: "E2E browser lifecycle edited", exact: true }).click();
  await page.getByRole("button", { name: "Delete ticket", exact: true }).click();
  const deletion = page.getByRole("dialog", { name: "Delete this ticket?" });
  await deletion.getByRole("button", { name: "Keep ticket" }).click();
  await expect(deletion).toBeHidden();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("E2E browser lifecycle edited");
  await page.getByRole("button", { name: "Delete ticket", exact: true }).click();
  await deletion.getByRole("button", { name: "Delete ticket", exact: true }).click();
  await expect(page).toHaveURL("/tickets");
  await expectMetrics(page, before);
  await expect(inbox(page).getByRole("link", { name: "E2E browser lifecycle edited", exact: true })).toHaveCount(0);
  for (const suffix of ["", "/entries", "/activities"]) {
    expect((await request.get(`/api/tickets/${ticket.id}${suffix}`)).status()).toBe(404);
  }
  await page.goto(`/tickets/${ticket.id}`);
  await expect(page.getByRole("heading", { name: "This ticket isn’t here" })).toBeVisible();
});

test("search, status, priority and assignee combine with AND; both sort orders persist", async ({ page, desk }) => {
  const [maya, jordan] = desk.agents;
  const prefix = "E2E-AND-browser";
  const tickets: Ticket[] = [];
  for (const fields of [
    { subject: `${prefix} match older`, status: "In Progress", priority: "High", assignee_id: jordan.id },
    { subject: `${prefix} match newer`, status: "In Progress", priority: "High", assignee_id: jordan.id },
    { subject: `${prefix} wrong status`, status: "Resolved", priority: "High", assignee_id: jordan.id },
    { subject: `${prefix} wrong priority`, status: "In Progress", priority: "Low", assignee_id: jordan.id },
    { subject: `${prefix} wrong assignee`, status: "In Progress", priority: "High", assignee_id: maya.id },
    { subject: "E2E unrelated search", status: "In Progress", priority: "High", assignee_id: jordan.id },
    { subject: `${prefix} urgent`, status: "Open", priority: "Urgent", assignee_id: maya.id },
    { subject: `${prefix} medium`, status: "Open", priority: "Medium", assignee_id: maya.id },
  ]) tickets.push(await desk.create(fields));

  await page.goto("/tickets");
  await page.getByRole("searchbox", { name: "Search tickets" }).fill(prefix);
  await expect(page).toHaveURL(new RegExp(`search=${prefix}`));
  await expect(page.getByText("1 active filter · Combined with AND", { exact: true })).toBeVisible();
  await page.getByLabel("Filter by status", { exact: true }).selectOption("In Progress");
  await expect(page).toHaveURL(/status=In\+Progress/);
  await expect(page.getByText("2 active filters · Combined with AND", { exact: true })).toBeVisible();
  await page.getByLabel("Filter by priority", { exact: true }).selectOption("High");
  await expect(page).toHaveURL(/priority=High/);
  await expect(page.getByText("3 active filters · Combined with AND", { exact: true })).toBeVisible();
  await page.getByLabel("Filter by assignee", { exact: true }).selectOption(String(jordan.id));
  await expect(page).toHaveURL(new RegExp(`assignee_id=${jordan.id}`));
  await expect(page.getByText("4 active filters · Combined with AND", { exact: true })).toBeVisible();
  await expect(subjects(page)).toHaveText([tickets[1].subject, tickets[0].subject]);
  await expect(page).toHaveURL(/assignee_id=/);
  await page.reload();
  await expect(subjects(page)).toHaveText([tickets[1].subject, tickets[0].subject]);
  await expect(page.getByLabel("Filter by status", { exact: true })).toHaveValue("In Progress");
  await expect(page.getByLabel("Filter by priority", { exact: true })).toHaveValue("High");
  await expect(page.getByLabel("Filter by assignee", { exact: true })).toHaveValue(String(jordan.id));
  await page.getByLabel("Filter by priority", { exact: true }).selectOption("Urgent");
  await expect(page.getByRole("heading", { name: "No tickets match this view" })).toBeVisible();
  await expect(subjects(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Reset view", exact: true }).click();
  await expect(page).toHaveURL("/tickets");
  await expect(page.getByRole("searchbox", { name: "Search tickets" })).toHaveValue("");
  for (const name of ["Filter by status", "Filter by priority", "Filter by assignee"])
    await expect(page.getByLabel(name, { exact: true })).toHaveValue("");

  await page.getByRole("searchbox", { name: "Search tickets" }).fill(prefix);
  await expect(page).toHaveURL(new RegExp(`search=${prefix}`));
  await expect(page.getByText("1 active filter · Combined with AND", { exact: true })).toBeVisible();
  await expect(inbox(page).locator("[aria-busy]")).toHaveAttribute("aria-busy", "false");
  const matching = tickets.filter((ticket) => ticket.subject.includes(prefix));
  await expect(subjects(page)).toHaveText([...matching].reverse().map((ticket) => ticket.subject));
  await page.getByLabel("Sort tickets", { exact: true }).selectOption("priority");
  const rank: Record<string, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
  const byPriority = [...matching].sort((a, b) => rank[a.priority] - rank[b.priority] || b.id - a.id);
  await expect(page).toHaveURL(new RegExp(`search=${prefix}.*sort=priority`));
  await expect(inbox(page).locator("[aria-busy]")).toHaveAttribute("aria-busy", "false");
  await expect(subjects(page)).toHaveText(byPriority.map((ticket) => ticket.subject));
  await page.reload();
  await expect(page.getByLabel("Sort tickets", { exact: true })).toHaveValue("priority");
  await expect(subjects(page)).toHaveText(byPriority.map((ticket) => ticket.subject));
  await page.getByLabel("Sort tickets", { exact: true }).selectOption("updated");
  await expect(subjects(page)).toHaveText([...matching].reverse().map((ticket) => ticket.subject));
  await test.step("rapid synchronous filters preserve AND state through reload, reset and browser back", async () => {
    await rapidFilterScenario(page, desk);
  });
});

test("manual refresh updates live statistics and inbox after an external mutation", async ({ page, request, desk }) => {
  await page.goto("/tickets");
  const before = await metrics(request);
  await expectMetrics(page, before);
  const ticket = await desk.create({ subject: "E2E external refresh", priority: "Urgent", status: "Open" });
  const refreshed = page.waitForResponse((response) => response.url().endsWith("/api/dashboard") && response.ok());
  await page.getByRole("button", { name: "Refresh tickets and statistics" }).click();
  await refreshed;
  await expectMetrics(page, {
    ...before, total: before.total + 1, open: before.open + 1, urgent: before.urgent + 1,
  });
  await expect(inbox(page).getByRole("link", { name: ticket.subject, exact: true })).toBeVisible();
  expect((await request.delete(`/api/tickets/${ticket.id}`)).status()).toBe(204);
  await page.getByRole("button", { name: "Refresh tickets and statistics" }).click();
  await expectMetrics(page, before);
  await expect(inbox(page).getByRole("link", { name: ticket.subject, exact: true })).toHaveCount(0);
});
