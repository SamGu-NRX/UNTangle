import { extensionTokens } from "@untangle/tokens/extension";
import { isMarkerState, MARKER_STATES, PILL_CSS, type MarkerState } from "./shared/marker-states";
import { trackPress } from "./shared/press";
export const ANNOTATION_ATTRIBUTE = "data-unt-row";
// The page can read everything drawn here, so a marker carries one state word
// and its glyph, never a preview detail. Anything else the worker might send
// renders as "Cannot check".
//
// Motion (MOTION.md §3 and §10): the marker fades in when its first verdict
// arrives, and re-enters with a 2px blur when the verdict changes, so a
// change made in the panel shows on the page. Opacity, blur and scale only,
// so the table never reflows. Reduced motion keeps a 120ms fade. Hover
// changes the border instantly: nothing animates on hover in the table.
const STYLE = `:host { all: initial; display: block; ${extensionTokens} }
button { appearance: none; display: inline-flex; align-items: center; min-height: 24px; margin: 0; padding: 2px 0; border: 0; background: none; cursor: pointer; outline: 2px solid transparent; outline-offset: 2px; -webkit-tap-highlight-color: transparent; }
@media (pointer: coarse) { button { min-height: 44px; } }
${PILL_CSS}
.pill { transition: transform var(--t-press) var(--ease-out); }
@media (hover: hover) and (pointer: fine) { button:hover .pill { border-color: currentColor; } }
button[data-pressed] .pill { transform: scale(.97); }
button:focus-visible .pill { box-shadow: var(--focus); }
button[data-waiting] { visibility: hidden; }
@media (prefers-reduced-motion: reduce) { .pill { transition: none; } button[data-pressed] .pill { transform: none; } }`;
function animateIn(pill: HTMLElement, first: boolean): void {
  if (typeof pill.animate !== "function")
    return;
  const reduce = pill.ownerDocument.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const frames = reduce || first
    ? [{ opacity: first ? 0 : 0.4 }, { opacity: 1 }]
    : [{ opacity: 0.4, transform: "scale(.96)", filter: "blur(2px)" }, { opacity: 1, transform: "none", filter: "none" }];
  pill.animate(frames, { duration: reduce ? 120 : 160, easing: "cubic-bezier(.23, 1, .32, 1)" });
}
/**
 * One marker under a class-search row: a single button that proposes the
 * section, which opens the trusted panel. It never adds. `subject` names the
 * section in the accessible name, as "CSCE 1030 section 001".
 */
export function buildMarker(rowId: string, select: () => void, subject = "this section"): {
  host: HTMLTableRowElement;
  update: (marker: string) => void;
} {
  const host = document.createElement("tr");
  host.setAttribute(ANNOTATION_ATTRIBUTE, rowId);
  const cell = document.createElement("td");
  cell.colSpan = 20;
  // The page's own cell styles (borders, zebra fills, padding) would turn
  // the marker row into a full table row; keep it a slim strip, with room
  // above the pill for its 4px focus ring.
  cell.style.cssText = "padding:4px 6px 4px;border:0;background:transparent;height:auto;line-height:0";
  const mount = document.createElement("span");
  cell.append(mount);
  host.append(cell);
  const root = mount.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = STYLE;
  const button = document.createElement("button");
  button.type = "button";
  button.addEventListener("click", () => select());
  trackPress(button);
  const pill = document.createElement("span");
  pill.className = "pill";
  const glyph = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  glyph.setAttribute("viewBox", "0 0 16 16");
  glyph.setAttribute("aria-hidden", "true");
  const word = document.createElement("span");
  pill.append(glyph, word);
  button.append(pill);
  root.append(style, button);
  let shown: MarkerState | null = null;
  const render = (state: MarkerState) => {
    host.setAttribute("data-unt-marker", state);
    button.dataset.marker = state;
    pill.dataset.marker = state;
    glyph.innerHTML = MARKER_STATES[state].glyph;
    word.textContent = MARKER_STATES[state].word;
    button.setAttribute("aria-label", `${MARKER_STATES[state].name}. Review ${subject} in UNTangle`);
  };
  // Until the worker answers, the marker holds its place but shows nothing:
  // "Cannot check" would be a claim made before anything was checked.
  render("unknown");
  button.dataset.waiting = "";
  const update = (marker: string) => {
    const state = isMarkerState(marker) ? marker : "unknown";
    if (state === shown)
      return;
    const first = shown === null;
    shown = state;
    render(state);
    delete button.dataset.waiting;
    animateIn(pill, first);
  };
  return { host, update };
}
