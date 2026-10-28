import type {
  Activity,
  Agent,
  Dashboard,
  Entry,
  EntryInput,
  Ticket,
  TicketDetail,
  TicketFields,
  TicketFilters,
  TicketPatch,
} from "../types";

const BASE_URL = (import.meta.env.VITE_API_BASE_URL || "/api").replace(
  /\/$/,
  "",
);

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "AbortError"
    )
      throw error;
    throw new ApiError(
      "Unable to reach ResolveDesk. Check your connection and try again.",
      0,
    );
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    let message = `Request failed (${response.status}). Please try again.`;
    if (body && typeof body === "object" && "detail" in body) {
      const detail = body.detail;
      if (typeof detail === "string") message = detail;
      else if (Array.isArray(detail)) {
        message = detail
          .map(
            (item: { loc?: (string | number)[]; msg?: string }) =>
              `${item.loc?.filter((part) => part !== "body").join(" · ") || "Request"}: ${item.msg || "Invalid value"}`,
          )
          .join("; ");
      }
    }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function ticketQuery(filters: TicketFilters): string {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value.trim()) params.set(key, value.trim());
  });
  return params.toString();
}

export const api = {
  agents: (signal?: AbortSignal) => request<Agent[]>("/agents", { signal }),
  dashboard: (signal?: AbortSignal) =>
    request<Dashboard>("/dashboard", { signal }),
  tickets: (filters: TicketFilters, signal?: AbortSignal) =>
    request<Ticket[]>(`/tickets?${ticketQuery(filters)}`, { signal }),
  ticket: (id: number, signal?: AbortSignal) =>
    request<TicketDetail>(`/tickets/${id}`, { signal }),
  createTicket: (fields: TicketFields) =>
    request<Ticket>("/tickets", {
      method: "POST",
      body: JSON.stringify(fields),
    }),
  updateTicket: (id: number, fields: TicketPatch) =>
    request<TicketDetail>(`/tickets/${id}`, {
      method: "PATCH",
      body: JSON.stringify(fields),
    }),
  deleteTicket: (id: number) =>
    request<void>(`/tickets/${id}`, { method: "DELETE" }),
  entries: (id: number, signal?: AbortSignal) =>
    request<Entry[]>(`/tickets/${id}/entries`, { signal }),
  addEntry: (id: number, entry: EntryInput) =>
    request<Entry>(`/tickets/${id}/entries`, {
      method: "POST",
      body: JSON.stringify(entry),
    }),
  activities: (id: number, signal?: AbortSignal) =>
    request<Activity[]>(`/tickets/${id}/activities`, { signal }),
};
