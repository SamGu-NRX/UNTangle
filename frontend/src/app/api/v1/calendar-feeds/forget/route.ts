import { forgetGuestCookie } from "@/lib/calendar-feeds/seal";

/**
 * Removes this browser's calendar guest cookie, so every guest calendar token
 * sealed to it stops opening. The cookie is HttpOnly, so the page can't clear
 * it itself; the app calls this wherever it discards a guest's work on this
 * browser (lib/calendar-feeds/client.ts, forgetGuestCalendars). Nothing is
 * read or stored, and the answer is the same whether a cookie was there.
 */
export function POST() {
  return new Response(null, { status: 204, headers: { "set-cookie": forgetGuestCookie, "cache-control": "no-store" } });
}
