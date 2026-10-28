import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { Activity, Entry, TicketDetail } from "./types";

const baseline: TicketDetail = {
  id: 1,
  subject: "Cannot access account",
  description: "My account is locked.",
  customer_name: "Mina Patel",
  customer_email: "mina@example.com",
  priority: "High",
  status: "Open",
  assignee_id: 1,
  assignee: { id: 1, name: "Sam Lee", email: "sam@example.com" },
  created_at: "2026-10-27T10:00:00Z",
  updated_at: "2026-10-28T10:00:00Z",
  entries: [],
  activities: [],
};
let ticket: TicketDetail;
let deleted: boolean;
let failTickets: boolean;
let fetcher: ReturnType<
  typeof vi.fn<(input: string, options?: RequestInit) => Promise<Response>>
>;
const clients: QueryClient[] = [];
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  ticket = structuredClone(baseline);
  deleted = false;
  failTickets = false;
  fetcher = vi.fn(async (input: string, options?: RequestInit) => {
    const url = new URL(input, "http://localhost");
    const path = url.pathname;
    const method = options?.method || "GET";
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    if (path === "/api/agents") return json([baseline.assignee]);
    if (path === "/api/dashboard")
      return json({
        total: deleted ? 0 : 1,
        open: !deleted && ticket.status === "Open" ? 1 : 0,
        in_progress: 0,
        resolved: !deleted && ticket.status === "Resolved" ? 1 : 0,
        urgent: 0,
        overdue: 0,
      });
    if (path === "/api/tickets" && method === "GET") {
      if (failTickets)
        return json({ detail: "The inbox is temporarily unavailable." }, 503);
      return json(deleted ? [] : [ticket]);
    }
    if (path === "/api/tickets" && method === "POST") {
      ticket = { ...ticket, ...body, id: 2 };
      return json(ticket, 201);
    }
    if (/^\/api\/tickets\/\d+\/entries$/.test(path)) {
      if (method === "POST") {
        const entry: Entry = {
          ...body,
          id: ticket.entries.length + 1,
          ticket_id: ticket.id,
          created_at: "2026-10-28T12:00:00Z",
        };
        ticket.entries.push(entry);
        return json(entry, 201);
      }
      return json(ticket.entries);
    }
    if (/^\/api\/tickets\/\d+\/activities$/.test(path))
      return json(ticket.activities);
    if (/^\/api\/tickets\/\d+$/.test(path)) {
      if (method === "PATCH") {
        ticket = { ...ticket, ...body };
        return json(ticket);
      }
      if (method === "DELETE") {
        deleted = true;
        return new Response(null, { status: 204 });
      }
      return deleted ? json({ detail: "Not found" }, 404) : json(ticket);
    }
    return json({ detail: "Unknown test route" }, 404);
  });
  vi.stubGlobal("fetch", fetcher);
});

afterEach(() => {
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.unstubAllGlobals();
});

function HistoryControls() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <button onClick={() => navigate(-1)}>History back</button>
      <button onClick={() => navigate(1)}>History forward</button>
      <output aria-label="Current location">
        {location.pathname}
        {location.search}
      </output>
    </>
  );
}

function open(path = "/tickets", withHistoryControls = false) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        {withHistoryControls && <HistoryControls />}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mutation(method: string) {
  return fetcher.mock.calls.find(
    ([, options]) => (options as RequestInit | undefined)?.method === method,
  );
}

describe("workspace workflows", () => {
  it("combines search, status, priority, and assignee filters, sorts, and resets", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("link", { name: "Cannot access account" });
    await user.selectOptions(screen.getByLabelText("Filter by status"), "Open");
    await user.selectOptions(
      screen.getByLabelText("Filter by priority"),
      "High",
    );
    await user.selectOptions(screen.getByLabelText("Filter by assignee"), "1");
    await user.selectOptions(screen.getByLabelText("Sort tickets"), "priority");
    await user.type(screen.getByLabelText("Search tickets"), "account");
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(([input]) => {
          const params = new URL(String(input), "http://localhost")
            .searchParams;
          return (
            params.get("search") === "account" &&
            params.get("status") === "Open" &&
            params.get("priority") === "High" &&
            params.get("assignee_id") === "1" &&
            params.get("sort") === "priority"
          );
        }),
      ).toBe(true),
    );
    await user.click(screen.getByRole("button", { name: "Reset view" }));
    expect(screen.getByLabelText("Search tickets")).toHaveValue("");
    expect(screen.getByLabelText("Filter by status")).toHaveValue("");
    expect(screen.getByLabelText("Sort tickets")).toHaveValue("updated");
  });

  it("preserves every filter when several controls change before navigation commits", async () => {
    open();
    await screen.findByRole("link", { name: baseline.subject });
    await waitFor(() =>
      expect(screen.getByLabelText("Filter by assignee")).toBeEnabled(),
    );
    act(() => {
      fireEvent.change(screen.getByLabelText("Search tickets"), {
        target: { value: "account" },
      });
      fireEvent.change(screen.getByLabelText("Filter by status"), {
        target: { value: "Open" },
      });
      fireEvent.change(screen.getByLabelText("Filter by priority"), {
        target: { value: "High" },
      });
      fireEvent.change(screen.getByLabelText("Filter by assignee"), {
        target: { value: "1" },
      });
      fireEvent.change(screen.getByLabelText("Sort tickets"), {
        target: { value: "priority" },
      });
    });
    expect(screen.getByLabelText("Search tickets")).toHaveValue("account");
    expect(screen.getByLabelText("Filter by status")).toHaveValue("Open");
    expect(screen.getByLabelText("Filter by priority")).toHaveValue("High");
    expect(screen.getByLabelText("Filter by assignee")).toHaveValue("1");
    expect(screen.getByLabelText("Sort tickets")).toHaveValue("priority");
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(([input]) => {
          const params = new URL(input, "http://localhost").searchParams;
          return (
            params.get("search") === "account" &&
            params.get("status") === "Open" &&
            params.get("priority") === "High" &&
            params.get("assignee_id") === "1" &&
            params.get("sort") === "priority"
          );
        }),
      ).toBe(true),
    );
  });

  it("merges rapid changes against the reset or summary view, not the old filters", async () => {
    open(
      "/tickets?search=account&status=Open&priority=High&assignee_id=1&sort=priority",
      true,
    );
    await screen.findByRole("link", { name: baseline.subject });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
      fireEvent.change(screen.getByLabelText("Filter by priority"), {
        target: { value: "Low" },
      });
    });
    expect(screen.getByLabelText("Current location")).toHaveTextContent(
      /^\/tickets\?priority=Low$/,
    );
    expect(screen.getByLabelText("Search tickets")).toHaveValue("");
    expect(screen.getByLabelText("Filter by status")).toHaveValue("");
    expect(screen.getByLabelText("Filter by assignee")).toHaveValue("");
    expect(screen.getByLabelText("Sort tickets")).toHaveValue("updated");
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "Show open tickets: 1" }),
      );
      fireEvent.change(screen.getByLabelText("Filter by assignee"), {
        target: { value: "1" },
      });
    });
    expect(screen.getByLabelText("Current location")).toHaveTextContent(
      /^\/tickets\?status=Open&assignee_id=1$/,
    );
    expect(screen.getByLabelText("Filter by priority")).toHaveValue("");
  });

  it("resynchronizes pending filters on back and forward navigation before the next edit", async () => {
    const user = userEvent.setup();
    open("/tickets?search=account&status=Open", true);
    await screen.findByRole("link", { name: baseline.subject });
    await user.selectOptions(
      screen.getByLabelText("Filter by priority"),
      "High",
    );
    await user.selectOptions(screen.getByLabelText("Sort tickets"), "priority");
    await user.click(screen.getByRole("button", { name: "History back" }));
    expect(screen.getByLabelText("Sort tickets")).toHaveValue("updated");
    expect(screen.getByLabelText("Filter by priority")).toHaveValue("High");
    await user.click(screen.getByRole("button", { name: "History back" }));
    expect(screen.getByLabelText("Filter by priority")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "History forward" }));
    expect(screen.getByLabelText("Filter by priority")).toHaveValue("High");
    await user.selectOptions(screen.getByLabelText("Filter by assignee"), "1");
    expect(screen.getByLabelText("Current location")).toHaveTextContent(
      /^\/tickets\?search=account&status=Open&priority=High&assignee_id=1$/,
    );
    await user.click(screen.getByRole("button", { name: "Reset view" }));
    expect(screen.getByLabelText("Current location")).toHaveTextContent(
      /^\/tickets$/,
    );
    await user.click(screen.getByRole("button", { name: "History back" }));
    expect(screen.getByLabelText("Filter by assignee")).toHaveValue("1");
    act(() => {
      fireEvent.change(screen.getByLabelText("Search tickets"), {
        target: { value: "updated" },
      });
      fireEvent.change(screen.getByLabelText("Filter by status"), {
        target: { value: "Resolved" },
      });
    });
    expect(screen.getByLabelText("Current location")).toHaveTextContent(
      /^\/tickets\?search=updated&status=Resolved&priority=High&assignee_id=1$/,
    );
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByLabelText("Search tickets")).toHaveValue("");
    expect(screen.getByLabelText("Filter by status")).toHaveValue("Resolved");
  });

  it("creates a real ticket payload from the modal", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByRole("heading", { name: "Ticket inbox" });
    await user.click(screen.getAllByRole("button", { name: "New ticket" })[0]);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Customer name")).toHaveAttribute(
      "maxlength",
      "120",
    );
    expect(within(dialog).getByLabelText("Customer email")).toHaveAttribute(
      "maxlength",
      "254",
    );
    await user.type(within(dialog).getByLabelText(/Subject/), "Payment failed");
    await user.type(
      within(dialog).getByLabelText("Customer email"),
      "customer@example.com",
    );
    await user.type(
      within(dialog).getByLabelText(/Description/),
      "My card was declined.",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Create ticket" }),
    );
    await screen.findByRole("heading", { name: "Payment failed", level: 1 });
    const call = mutation("POST");
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      subject: "Payment failed",
      customer_email: "customer@example.com",
      customer_name: "",
      priority: "Medium",
      status: "Open",
      assignee_id: null,
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "created successfully",
    );
  });

  it("patches only changed fields when editing and refreshes displayed data", async () => {
    const user = userEvent.setup();
    open("/tickets/1");
    await screen.findByRole("heading", { name: baseline.subject, level: 1 });
    await user.click(screen.getByRole("button", { name: "Edit ticket" }));
    const dialog = screen.getByRole("dialog");
    await user.clear(within(dialog).getByLabelText(/Subject/));
    await user.type(
      within(dialog).getByLabelText(/Subject/),
      "Updated account issue",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save changes" }),
    );
    await screen.findByRole("heading", {
      name: "Updated account issue",
      level: 1,
    });
    expect(JSON.parse(String(mutation("PATCH")?.[1]?.body))).toEqual({
      subject: "Updated account issue",
    });
  });

  it("updates status inline with an explicit actor and invalidates dashboard counts", async () => {
    const user = userEvent.setup();
    open("/tickets/1");
    await screen.findByRole("heading", { name: baseline.subject, level: 1 });
    await user.type(screen.getByLabelText(/Your name.*optional/), "Jordan");
    await user.selectOptions(screen.getByLabelText("Status"), "Resolved");
    await waitFor(() =>
      expect(screen.getByLabelText("Status")).toHaveValue("Resolved"),
    );
    expect(JSON.parse(String(mutation("PATCH")?.[1]?.body))).toEqual({
      status: "Resolved",
      actor: "Jordan",
    });
    expect(
      fetcher.mock.calls.filter(([input]) => input === "/api/dashboard").length,
    ).toBeGreaterThan(1);
  });

  it("limits both the reply author and update actor to 120 characters", async () => {
    const user = userEvent.setup();
    open("/tickets/1");
    await screen.findByRole("heading", { name: baseline.subject, level: 1 });
    const author = screen.getByLabelText(/Your name \*/);
    const actor = screen.getByLabelText(/Your name.*optional/);
    expect(author).toHaveAttribute("maxlength", "120");
    expect(actor).toHaveAttribute("maxlength", "120");
    await user.click(author);
    await user.paste("a".repeat(121));
    expect(author).toHaveValue("a".repeat(120));
    expect(actor).toHaveValue("a".repeat(120));
    await user.clear(actor);
    await user.paste("b".repeat(121));
    expect(actor).toHaveValue("b".repeat(120));
    expect(author).toHaveValue("b".repeat(120));
  });

  it("adds an internal note with the author and preserves chronological conversation order", async () => {
    ticket.entries = [
      {
        id: 2,
        ticket_id: 1,
        author: "Sam",
        content: "Second message",
        entry_type: "Public Reply",
        created_at: "2026-10-28T11:00:00Z",
      },
      {
        id: 1,
        ticket_id: 1,
        author: "Mina",
        content: "First message",
        entry_type: "Public Reply",
        created_at: "2026-10-28T10:00:00Z",
      },
    ];
    const user = userEvent.setup();
    open("/tickets/1");
    const list = await screen.findByRole("list", {
      name: "Conversation, oldest first",
    });
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent(
      "First message",
    );
    await user.selectOptions(
      screen.getByLabelText("Message type"),
      "Internal Note",
    );
    await user.type(screen.getByLabelText(/Your name \*/), "Jordan");
    await user.type(
      screen.getByLabelText("Internal note"),
      "Escalating to billing.",
    );
    await user.click(screen.getByRole("button", { name: "Add note" }));
    await screen.findByText("Escalating to billing.");
    expect(JSON.parse(String(mutation("POST")?.[1]?.body))).toEqual({
      content: "Escalating to billing.",
      author: "Jordan",
      entry_type: "Internal Note",
    });
    expect(screen.getByLabelText("Internal note")).toHaveValue("");
  });

  it("shows chronological activity history with actor attribution", async () => {
    const events: Activity[] = [
      {
        id: 2,
        ticket_id: 1,
        event_type: "status_changed",
        description: "Moved to resolved",
        actor: "Sam",
        created_at: "2026-10-28T11:00:00Z",
      },
      {
        id: 1,
        ticket_id: 1,
        event_type: "created",
        description: "Ticket created",
        actor: "Mina",
        created_at: "2026-10-27T10:00:00Z",
      },
    ];
    ticket.activities = events;
    const user = userEvent.setup();
    open("/tickets/1");
    await screen.findByRole("heading", { name: baseline.subject, level: 1 });
    await user.click(screen.getByRole("tab", { name: "Activity history" }));
    const list = await screen.findByRole("list", {
      name: "Activity history, oldest first",
    });
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent(
      "Ticket created",
    );
    expect(within(list).getAllByRole("listitem")[1]).toHaveTextContent(
      "by Sam",
    );
  });

  it("requires confirmation before deletion and returns to an empty live inbox", async () => {
    const user = userEvent.setup();
    open("/tickets/1");
    await screen.findByRole("heading", { name: baseline.subject, level: 1 });
    await user.click(screen.getByRole("button", { name: "Delete ticket" }));
    expect(mutation("DELETE")).toBeUndefined();
    await user.click(screen.getByRole("button", { name: "Keep ticket" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete ticket" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete ticket",
      }),
    );
    await screen.findByRole("heading", {
      name: "A fresh start for great support",
    });
    expect(mutation("DELETE")?.[0]).toBe("/api/tickets/1");
    expect(
      screen.getByRole("button", { name: "Show total tickets: 0" }),
    ).toBeInTheDocument();
  });

  it("adds a public reply with the selected author", async () => {
    const user = userEvent.setup();
    open("/tickets/1");
    await screen.findByRole("heading", { name: baseline.subject, level: 1 });
    await user.type(screen.getByLabelText(/Your name \*/), "Jordan");
    await user.type(
      screen.getByLabelText("Reply message"),
      "Your account is ready.",
    );
    await user.click(screen.getByRole("button", { name: "Add reply" }));
    await screen.findByText("Your account is ready.");
    expect(JSON.parse(String(mutation("POST")?.[1]?.body))).toEqual({
      content: "Your account is ready.",
      author: "Jordan",
      entry_type: "Public Reply",
    });
  });

  it("updates priority and clears assignment through nullable PATCH fields", async () => {
    const user = userEvent.setup();
    open("/tickets/1");
    await screen.findByRole("heading", { name: baseline.subject, level: 1 });
    await user.selectOptions(screen.getByLabelText("Priority"), "Urgent");
    await waitFor(() =>
      expect(screen.getByLabelText("Priority")).toHaveValue("Urgent"),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Assigned to")).toBeEnabled(),
    );
    await user.selectOptions(screen.getByLabelText("Assigned to"), "");
    await waitFor(() =>
      expect(screen.getByLabelText("Assigned to")).toHaveValue(""),
    );
    const patches = fetcher.mock.calls
      .filter(([, options]) => options?.method === "PATCH")
      .map(([, options]) => JSON.parse(String(options?.body)));
    expect(patches).toEqual([{ priority: "Urgent" }, { assignee_id: null }]);
  });

  it("validates customer identity before creating a ticket", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getAllByRole("button", { name: "New ticket" })[0]);
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Subject/), "New issue");
    await user.type(
      within(dialog).getByLabelText(/Description/),
      "Please help.",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Create ticket" }),
    );
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Enter a customer name or email address.",
    );
    expect(mutation("POST")).toBeUndefined();
  });

  it("recovers from an API error through Retry", async () => {
    failTickets = true;
    const user = userEvent.setup();
    open();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The inbox is temporarily unavailable.");
    failTickets = false;
    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    await screen.findByRole("link", { name: baseline.subject });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("traps modal focus, closes on Escape, and restores the trigger", async () => {
    const user = userEvent.setup();
    open();
    const trigger = screen.getAllByRole("button", { name: "New ticket" })[0];
    await user.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/Subject/)).toHaveFocus();
    const submit = within(dialog).getByRole("button", {
      name: "Create ticket",
    });
    submit.focus();
    await user.tab();
    expect(
      within(dialog).getByRole("button", { name: "Close dialog" }),
    ).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
