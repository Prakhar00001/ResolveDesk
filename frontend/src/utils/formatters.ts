import type { TicketFields, TicketPatch } from "../types";

// The API may return naive UTC timestamps from SQLite; don't interpret them as local time.
export function parseTimestamp(value: string): Date {
  return new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`);
}

export function exactTime(value: string): string {
  const date = parseTimestamp(value);
  return Number.isNaN(date.getTime())
    ? "Unknown date"
    : date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "long",
      });
}

export function relativeTime(value: string, now = Date.now()): string {
  const time = parseTimestamp(value).getTime();
  if (Number.isNaN(time)) return "Unknown date";
  const seconds = Math.round((time - now) / 1000);
  if (Math.abs(seconds) < 60) return "Just now";
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, size] of [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ] as const) {
    if (Math.abs(seconds) >= size)
      return formatter.format(Math.round(seconds / size), unit);
  }
  return "Just now";
}

export function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase() || "?"
  );
}

export function customerLabel(ticket: {
  customer_name: string;
  customer_email: string;
}): string {
  return ticket.customer_name || ticket.customer_email || "Unknown customer";
}

export function validateTicket(fields: TicketFields): string | null {
  if (!fields.subject.trim()) return "Please enter a subject.";
  if (!fields.description.trim()) return "Please describe the issue.";
  if (!fields.customer_name.trim() && !fields.customer_email.trim())
    return "Enter a customer name or email address.";
  if (fields.customer_name.trim().length > 120)
    return "Customer name must be 120 characters or fewer.";
  if (fields.customer_email.trim().length > 254)
    return "Customer email must be 254 characters or fewer.";
  if (
    fields.customer_email.trim() &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.customer_email.trim())
  )
    return "Please enter a valid customer email address.";
  return null;
}

export function normalizeFields(fields: TicketFields): TicketFields {
  return {
    ...fields,
    subject: fields.subject.trim(),
    description: fields.description.trim(),
    customer_name: fields.customer_name.trim(),
    customer_email: fields.customer_email.trim(),
  };
}

export function changedFields(
  original: TicketFields,
  next: TicketFields,
): TicketPatch {
  const patch: TicketPatch = {};
  for (const key of Object.keys(next) as (keyof TicketFields)[]) {
    if (next[key] !== original[key]) Object.assign(patch, { [key]: next[key] });
  }
  return patch;
}

export function chronological<T extends { id: number; created_at: string }>(
  items: T[],
): T[] {
  return [...items].sort(
    (a, b) =>
      parseTimestamp(a.created_at).getTime() -
        parseTimestamp(b.created_at).getTime() || a.id - b.id,
  );
}
