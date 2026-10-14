/**
 * Window event that asks for the import page. It is cancelable: the shell's
 * ConnectHost claims it with preventDefault() and navigates in the app; a
 * sender that finds it unclaimed (no shell mounted) loads the page itself.
 */
export const OPEN_CONNECT_EVENT = "untangle:open-connect";

/** The import page (DESIGN.md §4.1). */
export const CONNECT_PATH = "/connect";

/** Goes to the import page, through the shell's router when it is mounted. */
export function openConnect(): boolean {
  const claimed = !window.dispatchEvent(new Event(OPEN_CONNECT_EVENT, { cancelable: true }));
  if (!claimed) window.location.assign(CONNECT_PATH);
  return claimed;
}
