/**
 * The five verdicts a class-search row can show, each as one glyph plus one
 * word so color never carries the meaning alone. The page marker and the
 * panel's course head draw the same pill. Glyphs are static markup on a
 * 16-unit grid; none of them contains text.
 */
export type MarkerState = "conflict" | "clear" | "unknown" | "added" | "pending";
export const MARKER_STATES: Record<MarkerState, { word: string; name: string; glyph: string }> = {
  // Two rings overlapping, with the overlap filled: two meeting times collide.
  conflict: { word: "Conflict", name: "Conflict with Main", glyph: `<circle cx="6" cy="8" r="4.25" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="8" r="4.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 4.25A4.25 4.25 0 0 1 8 11.75A4.25 4.25 0 0 1 8 4.25Z" fill="currentColor"/>` },
  clear: { word: "Fits", name: "Fits Main", glyph: `<path d="M3.5 8.4l3 3 6-6.8" fill="none" stroke="var(--brand)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` },
  // A dashed ring: nothing to compare, so no claim either way.
  unknown: { word: "Cannot check", name: "Cannot check against Main", glyph: `<circle cx="8" cy="8" r="5.5" fill="none" stroke="var(--ink-3)" stroke-width="1.5" stroke-dasharray="2.4 2.1"/>` },
  // The web app's "planned" glyph: a filled disc with a dot.
  added: { word: "Added", name: "Added to Main", glyph: `<circle cx="8" cy="8" r="6" fill="currentColor"/><circle cx="8" cy="8" r="2.1" fill="var(--paper)"/>` },
  pending: { word: "Not synced", name: "Not synced to Main yet", glyph: `<circle cx="8" cy="8" r="5.75" fill="none" stroke="var(--ink-3)" stroke-width="1.5"/><path d="M8 5v3.2l2.2 1.4" fill="none" stroke="var(--ink-2)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` },
};
export const isMarkerState = (value: string): value is MarkerState => Object.hasOwn(MARKER_STATES, value);
/** The pill both documents draw, keyed by `.pill[data-marker]`. Needs the extension tokens in scope. */
export const PILL_CSS = `.pill { display: inline-flex; align-items: center; gap: 4px; height: 20px; box-sizing: border-box; padding: 0 8px 0 5px; border: 1px solid transparent; border-radius: var(--r-pill); font: 600 12px/16px var(--font-ui); letter-spacing: .005em; white-space: nowrap; color: var(--ink-2); background: var(--paper-2); }
.pill svg { flex: none; width: 12px; height: 12px; }
.pill[data-marker=conflict] { color: var(--danger); background: var(--danger-soft); }
.pill[data-marker=clear] { background: var(--paper); border-color: var(--line-2); }
.pill[data-marker=added] { color: var(--brand); background: var(--brand-soft); }
.pill[data-marker=pending] { background: var(--paper); border-color: var(--line-2); border-style: dashed; }`;
