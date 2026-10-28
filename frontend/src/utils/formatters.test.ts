import { describe, expect, it } from "vitest";
import type { TicketFields } from "../types";
import {
  changedFields,
  chronological,
  initials,
  normalizeFields,
  parseTimestamp,
  relativeTime,
  validateTicket,
} from "./formatters";

const fields: TicketFields = {
  subject: "Account issue",
  description: "Cannot sign in",
  customer_name: "Mina",
  customer_email: "",
  priority: "Medium",
  status: "Open",
  assignee_id: null,
};

describe("ticket validation and patches", () => {
  it("accepts either customer name or email", () => {
    expect(validateTicket(fields)).toBeNull();
    expect(
      validateTicket({
        ...fields,
        customer_name: "",
        customer_email: "mina@example.com",
      }),
    ).toBeNull();
    expect(
      validateTicket({ ...fields, customer_name: " ", customer_email: "" }),
    ).toContain("name or email");
  });
  it("rejects whitespace-only required fields and malformed email", () => {
    expect(validateTicket({ ...fields, subject: "  " })).toContain("subject");
    expect(validateTicket({ ...fields, description: "  " })).toContain(
      "describe",
    );
    expect(
      validateTicket({ ...fields, customer_email: "not-an-email" }),
    ).toContain("valid");
  });
  it("enforces the customer name boundary after trimming", () => {
    expect(
      validateTicket({ ...fields, customer_name: ` ${"a".repeat(120)} ` }),
    ).toBeNull();
    expect(
      validateTicket({ ...fields, customer_name: "a".repeat(121) }),
    ).toContain("120 characters");
  });
  it("enforces the customer email boundary after trimming", () => {
    const email = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(57)}.com`;
    expect(email).toHaveLength(254);
    expect(
      validateTicket({ ...fields, customer_email: ` ${email} ` }),
    ).toBeNull();
    expect(
      validateTicket({
        ...fields,
        customer_email: email.replace(".com", "d.com"),
      }),
    ).toContain("254 characters");
  });
  it("normalizes text without changing categorical fields", () => {
    expect(
      normalizeFields({
        ...fields,
        subject: "  Account issue  ",
        customer_name: " Mina ",
      }),
    ).toEqual(fields);
  });
  it("only includes changed fields and preserves nullable assignee", () => {
    expect(changedFields(fields, fields)).toEqual({});
    expect(
      changedFields(
        { ...fields, assignee_id: 1 },
        { ...fields, status: "Resolved" },
      ),
    ).toEqual({ status: "Resolved", assignee_id: null });
  });
});

describe("display helpers", () => {
  it("treats naive backend timestamps as UTC and preserves offsets", () => {
    expect(parseTimestamp("2026-10-28T10:00:00").toISOString()).toBe(
      "2026-10-28T10:00:00.000Z",
    );
    expect(parseTimestamp("2026-10-28T12:00:00+02:00").toISOString()).toBe(
      "2026-10-28T10:00:00.000Z",
    );
  });
  it("formats relative timestamps and handles invalid dates", () => {
    const now = Date.parse("2026-10-28T12:00:00Z");
    expect(relativeTime("2026-10-28T11:58:00Z", now)).toBe("2 minutes ago");
    expect(relativeTime("2026-10-28T12:00:00Z", now)).toBe("Just now");
    expect(relativeTime("invalid", now)).toBe("Unknown date");
  });
  it("sorts conversation chronologically without mutating the response", () => {
    const items = [
      { id: 2, created_at: "2026-10-28T12:00:00Z" },
      { id: 1, created_at: "2026-10-28T11:00:00Z" },
    ];
    expect(chronological(items).map((item) => item.id)).toEqual([1, 2]);
    expect(items[0].id).toBe(2);
  });
  it("generates safe initials", () => {
    expect(initials("  Mina Patel ")).toBe("MP");
    expect(initials("")).toBe("?");
  });
});
