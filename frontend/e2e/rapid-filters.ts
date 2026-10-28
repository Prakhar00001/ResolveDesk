import type { Page } from "@playwright/test";
import { expect, type Desk, type Ticket } from "./fixtures";

type Filters = {
  search: string;
  status: string;
  priority: string;
  assignee_id: string;
  sort: string;
};

const defaults: Filters = { search: "", status: "", priority: "", assignee_id: "", sort: "updated" };
const labels: Record<keyof Filters, string> = {
  search: "Search tickets", status: "Filter by status", priority: "Filter by priority",
  assignee_id: "Filter by assignee", sort: "Sort tickets",
};
const subjects = (page: Page) => page.getByRole("region", { name: "Ticket inbox", exact: true })
  .locator("tbody tr td:first-child a");

async function expectFilters(page: Page, filters: Filters) {
  const params = Object.fromEntries(Object.entries(filters)
    .filter(([key, value]) => value && !(key === "sort" && value === "updated")));
  await expect.poll(() => Object.fromEntries(new URL(page.url()).searchParams)).toEqual(params);
  for (const key of Object.keys(filters) as (keyof Filters)[])
    await expect(page.getByLabel(labels[key], { exact: true })).toHaveValue(filters[key]);
  const active = [filters.search, filters.status, filters.priority, filters.assignee_id].filter(Boolean).length;
  if (active) {
    await expect(page.getByText(`${active} active filter${active === 1 ? "" : "s"} · Combined with AND`, { exact: true }))
      .toBeVisible();
  } else {
    await expect(page.getByText(/active filters? · Combined with AND/)).toHaveCount(0);
  }
}

async function rapidFilters(page: Page, filters: Partial<Filters>, reset = false) {
  // One browser task, no awaits/settling between events. Use the native input
  // setter so React sees a real value change rather than its tracked setter.
  await page.evaluate(({ filters, reset }) => {
    if (reset) {
      const button = [...document.querySelectorAll("button")]
        .find((element) => element.textContent?.trim() === "Reset view");
      if (!button) throw new Error("Reset view button is missing");
      button.click();
    }
    const ids = {
      search: "ticket-search", status: "status-filter", priority: "priority-filter",
      assignee_id: "assignee-filter", sort: "sort-tickets",
    };
    for (const key of Object.keys(filters) as (keyof typeof filters)[]) {
      const control = document.getElementById(ids[key]);
      const value = filters[key];
      if (value === undefined) throw new Error(`Missing value for ${key}`);
      if (control instanceof HTMLInputElement) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        if (!setter) throw new Error("Native input value setter is missing");
        setter.call(control, value);
        control.dispatchEvent(new Event("input", { bubbles: true }));
      } else if (control instanceof HTMLSelectElement) {
        control.value = value;
        control.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        throw new Error(`Filter control is missing: ${key}`);
      }
    }
  }, { filters, reset });
}

export async function rapidFilterScenario(page: Page, desk: Desk) {
  const [otherAgent, agent] = desk.agents;
  const prefix = "E2E-rapid-browser";
  const tickets: Ticket[] = [];
  for (const fields of [
    { subject: `${prefix} match older`, status: "In Progress", priority: "High", assignee_id: agent.id },
    { subject: `${prefix} match newer`, status: "In Progress", priority: "High", assignee_id: agent.id },
    { subject: `${prefix} wrong status`, status: "Resolved", priority: "High", assignee_id: agent.id },
    { subject: `${prefix} wrong priority`, status: "In Progress", priority: "Low", assignee_id: agent.id },
    { subject: `${prefix} wrong assignee`, status: "In Progress", priority: "High", assignee_id: otherAgent.id },
    { subject: "E2E rapid unrelated search", status: "In Progress", priority: "High", assignee_id: agent.id },
  ]) tickets.push(await desk.create(fields));

  await page.goto("/tickets");
  await expect(page.getByLabel("Filter by assignee", { exact: true })).toBeEnabled();
  const combined: Filters = {
    search: prefix, status: "In Progress", priority: "High", assignee_id: String(agent.id), sort: "priority",
  };
  const queried = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/tickets" && response.request().method() === "GET"
      && Object.entries(combined).every(([key, value]) => url.searchParams.get(key) === value);
  });
  await rapidFilters(page, combined);
  const response = await queried;
  expect(response.status()).toBe(200);
  const results: Ticket[] = await response.json();
  expect(results.map((ticket) => ticket.id)).toEqual([tickets[1].id, tickets[0].id]);
  await expectFilters(page, combined);
  await expect(subjects(page)).toHaveText([tickets[1].subject, tickets[0].subject]);
  await page.reload();
  await expectFilters(page, combined);
  await expect(subjects(page)).toHaveText([tickets[1].subject, tickets[0].subject]);

  // Reset and edit in the same task: the new merge base must not resurrect
  // the old status, assignee or sort, even before the reset navigation commits.
  // Change the actual input value: re-dispatching the identical pre-reset value
  // would be ignored by React's input tracker rather than exercising onChange.
  const resetSearch = prefix.toLowerCase();
  await rapidFilters(page, { search: resetSearch, priority: "Low" }, true);
  const resetState = { ...defaults, search: resetSearch, priority: "Low" };
  await expectFilters(page, resetState);
  await expect(subjects(page)).toHaveText([tickets[3].subject]);

  // Create one committed history entry so Back has a deterministic destination.
  await page.getByLabel("Filter by status", { exact: true }).selectOption("In Progress");
  const nextState = { ...resetState, status: "In Progress" };
  await expectFilters(page, nextState);
  await page.goBack();
  await expectFilters(page, resetState);
  await expect(subjects(page)).toHaveText([tickets[3].subject]);
  await page.goForward();
  await expectFilters(page, nextState);
  await page.goBack();
  await expectFilters(page, resetState);

  // After Back, another synchronous batch must merge against history's state,
  // not the newer status selection or the original combined view.
  await rapidFilters(page, { priority: "High", assignee_id: String(agent.id), sort: "priority" });
  const afterBack = { ...resetState, priority: "High", assignee_id: String(agent.id), sort: "priority" };
  await expectFilters(page, afterBack);
  await expect(subjects(page)).toHaveText([tickets[2].subject, tickets[1].subject, tickets[0].subject]);
  await page.reload();
  await expectFilters(page, afterBack);
  await expect(subjects(page)).toHaveText([tickets[2].subject, tickets[1].subject, tickets[0].subject]);
  await page.getByRole("button", { name: "Reset view", exact: true }).click();
  await expect(page).toHaveURL("/tickets");
  await expectFilters(page, defaults);
  await page.goBack();
  await expectFilters(page, afterBack);
  await expect(subjects(page)).toHaveText([tickets[2].subject, tickets[1].subject, tickets[0].subject]);
}
