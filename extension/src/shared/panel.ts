import type { Preview, SectionRef } from "./extension-api";
export interface PanelPreview {
  previewId: string;
  ref: SectionRef;
  preview: Preview;
}
/**
 * What the last action came to, so the panel picks its layout from a value
 * instead of matching notice text:
 * - none: nothing to report; the panel shows the preview, or asks for a section.
 * - waiting: the add is stored and was sent, but no receipt has arrived.
 * - added: the receipt arrived.
 * - changed: Main moved on since the preview; the preview shown is the fresh one.
 * - rejected: UNTangle refused the add for a reason other than a stale revision.
 * - error: the last request failed; notice says what to do.
 */
export type PanelOutcome = "none" | "waiting" | "added" | "changed" | "rejected" | "error";
export interface PanelState {
  signedIn: boolean;
  /**
   * While a device sign-in is in flight, the code the student matches on the
   * UNTangle approval page; null the rest of the time.
   */
  userCode: string | null;
  preview: PanelPreview | null;
  /** Student-facing copy. It never carries an internal error's message. */
  notice: string;
  outcome: PanelOutcome;
  pending: number;
  /**
   * True when another request (a second panel, or a sign-in still open) holds
   * the worker. The state is then mid-change, so the panel keeps its loading
   * screen and asks again rather than drawing it.
   */
  working: boolean;
}
