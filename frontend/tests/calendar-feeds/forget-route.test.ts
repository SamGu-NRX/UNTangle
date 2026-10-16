/** Ending a browser's guest calendars: the HttpOnly cookie their tokens are sealed to is removed by the server. */
import { describe, expect, mock, test } from "bun:test";
import { POST } from "@/app/api/v1/calendar-feeds/forget/route";
import { forgetGuestCalendars } from "@/lib/calendar-feeds/client";

describe("forgetting a browser's guest calendars", () => {
  test("the route expires the __Host- cookie and stores nothing", () => {
    const response = POST();
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toBe("__Host-untangle-calendar-guest=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("the client asks for it, and a failed request never throws", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    await forgetGuestCalendars(async (input, init) => {
      calls.push([input, init]);
      return new Response(null, { status: 204 });
    });
    expect(calls).toEqual([["/api/v1/calendar-feeds/forget", { method: "POST", keepalive: true, cache: "no-store" }]]);
    await expect(forgetGuestCalendars(mock(async () => Promise.reject(new TypeError("offline"))))).resolves.toBeUndefined();
  });
});
