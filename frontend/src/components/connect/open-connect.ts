/**
 * Window event that opens the Connect sheet over the current view. It is
 * cancelable: the shell's ConnectHost claims it with preventDefault(), and a
 * sender that finds it unclaimed (no shell mounted) falls back to
 * navigating to /courses/import.
 */
export const OPEN_CONNECT_EVENT = "untangle:open-connect";

/** The route the sheet lives at: open while the URL is here, so a reload keeps it open. */
export const CONNECT_PATH = "/connect";

/**
 * Opens the Connect sheet over whatever view is showing. Returns whether
 * the sheet claimed the request; if not, it navigates to /courses/import,
 * which opens the sheet over Courses.
 */
export function openConnect(): boolean {
  const claimed = !window.dispatchEvent(new Event(OPEN_CONNECT_EVENT, { cancelable: true }));
  if (!claimed) window.location.assign("/courses/import");
  return claimed;
}
