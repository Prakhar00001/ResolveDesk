import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, request, ticketQuery } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("API client", () => {
  it("combines non-empty filters and encodes search", () => {
    const query = new URLSearchParams(
      ticketQuery({
        search: " billing & plan ",
        status: "Open",
        priority: "Urgent",
        assignee_id: "2",
        sort: "priority",
      }),
    );
    expect(Object.fromEntries(query)).toEqual({
      search: "billing & plan",
      status: "Open",
      priority: "Urgent",
      assignee_id: "2",
      sort: "priority",
    });
  });
  it("omits empty filters", () => {
    expect(
      ticketQuery({
        search: "",
        status: "",
        priority: "",
        assignee_id: "",
        sort: "updated",
      }),
    ).toBe("sort=updated");
  });
  it("handles 204 delete responses without attempting JSON parsing", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(api.deleteTicket(7)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith(
      "/api/tickets/7",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
  it("formats backend validation errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              detail: [{ loc: ["body", "subject"], msg: "Field required" }],
            }),
            { status: 422 },
          ),
        ),
    );
    await expect(request("/tickets")).rejects.toThrow(
      "subject: Field required",
    );
  });
  it("surfaces network errors and preserves aborts", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetcher);
    await expect(request("/tickets")).rejects.toBeInstanceOf(ApiError);
    fetcher.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));
    await expect(request("/tickets")).rejects.toHaveProperty(
      "name",
      "AbortError",
    );
  });
});
