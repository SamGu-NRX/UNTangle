import { extensionTokens } from "@untangle/tokens/extension";
import type { Preview, PreviewClash, PreviewGrades, PreviewMeeting, UnknownReason } from "./shared/extension-api";
import { MARKER_STATES, PILL_CSS, type MarkerState } from "./shared/marker-states";
import type { PanelState } from "./shared/panel";
import { trackPress } from "./shared/press";

// Layout follows the v3 course detail (frontend/src/components/courses/
// DetailPanel.tsx): code and title, then one section per question, one fact
// per row, and the single primary action in the foot.
//
// Motion: only the add confirmation moves (the mark, check included, scales
// from .9 and fades in, 220ms --ease-out), and only when the add was
// confirmed with a pointer. Every other state change swaps content with no transition.
// Reduced motion keeps a 120ms fade; the spinner pulses instead of turning.
const style = document.createElement("style");
style.textContent = `
@font-face { font-family: "DM Sans"; src: url("fonts/dm-sans-latin-opsz-normal.woff2") format("woff2"); font-weight: 100 1000; font-style: normal; font-display: block; }
@font-face { font-family: "Syne"; src: url("fonts/syne-latin-800-normal.woff2") format("woff2"); font-weight: 800; font-style: normal; font-display: block; }
:root { ${extensionTokens} color-scheme: light; }
* { box-sizing: border-box; }
html { background: var(--paper); }
/* Chrome sizes the popup to the body, so the width is fixed. Opened as a
   page a little wider (a phone), the panel fills it. */
body { width: 380px; max-width: 100%; margin: 0 auto; color: var(--ink); background: var(--paper); font: 400 var(--text-body)/var(--lh-body) var(--font-ui); -webkit-font-smoothing: antialiased; }
@media (min-width: 381px) and (max-width: 440px) { body { width: 100%; } }
h1, h2, p { margin: 0; }
.bar { display: flex; align-items: center; height: 48px; padding: 0 var(--s6); border-bottom: 1px solid var(--line); }
.wordmark { font: 800 18px/1 var(--font-mark); letter-spacing: -.01em; color: var(--brand); }
main { padding: var(--s5) var(--s6) var(--s6); }
.foot { position: sticky; bottom: 0; padding: var(--s4) var(--s6) var(--s5); background: var(--paper); border-top: 1px solid var(--line); }
.foot:empty { display: none; }
[tabindex="-1"]:focus { outline: none; }
[tabindex="-1"]:focus-visible { outline: 2px solid transparent; border-radius: var(--r-xs); box-shadow: var(--focus); }

.codeline { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2) 10px; }
.code { font: 600 20px/24px var(--font-ui); font-variant-numeric: tabular-nums; letter-spacing: -.005em; color: var(--brand); }
.title { margin-top: 6px; font: 600 var(--text-title)/var(--lh-title) var(--font-ui); letter-spacing: -.005em; overflow-wrap: anywhere; }
.meta { font-size: var(--text-meta); line-height: var(--lh-meta); color: var(--ink-2); }
.head .meta { margin-top: var(--s1); }
${PILL_CSS}

section { margin-top: var(--s6); }
h2 { font: 600 15px/22px var(--font-ui); }
h2 + .meta { margin-top: var(--s1); }
.sentence { display: flex; align-items: flex-start; gap: var(--s2); margin-top: var(--s2); }
.sentence svg { flex: none; width: 16px; height: 16px; margin-top: 2px; }
.sentence[data-marker=conflict] { color: var(--danger); }
.sentence[data-marker=added] { color: var(--brand); }
.sentence span { color: var(--ink); text-wrap: pretty; }
.rows { margin-top: var(--s2); border-top: 1px solid var(--line); }
.row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; gap: var(--s3); min-height: 44px; padding: 11px 0; border-bottom: 1px solid var(--line); }
.row .name { font-weight: 600; overflow-wrap: anywhere; }
.row .name small { display: block; font-weight: 400; font-size: var(--text-meta); line-height: var(--lh-meta); color: var(--ink-2); }
.row .fact { max-width: 220px; color: var(--ink-2); text-align: right; font-variant-numeric: tabular-nums; }
.row .fact b { display: block; font: 600 20px/24px var(--font-ui); color: var(--ink); }
.row .fact small { display: block; font-size: var(--text-meta); line-height: var(--lh-meta); color: var(--ink-2); }
.tag { display: inline-flex; align-items: center; height: 20px; margin-top: var(--s3); padding: 0 7px; border: 1px dotted var(--line-2); border-radius: 6px; font: 550 var(--text-label)/1 var(--font-ui); color: var(--ink-2); white-space: nowrap; }
.lines p + p { margin-top: var(--s1); }
.note { margin-top: var(--s3); font-size: var(--text-meta); line-height: var(--lh-meta); color: var(--attention); }
.alert { margin-bottom: var(--s3); font-size: var(--text-meta); line-height: var(--lh-meta); color: var(--danger); }

.state h1 { font: 600 var(--text-title)/var(--lh-title) var(--font-ui); letter-spacing: -.005em; }
.state .lead { font-size: 15px; line-height: 22px; }
.state p { text-wrap: pretty; }
.state h1 + .lead { margin-top: var(--s2); }
.state p:not(.lead) { margin-top: var(--s2); color: var(--ink-2); }
.state p.small { margin-top: var(--s3); font-size: var(--text-meta); line-height: var(--lh-meta); }
.mark { display: block; width: 40px; height: 40px; margin-bottom: var(--s4); }
.loading { display: flex; align-items: center; gap: var(--s2); color: var(--ink-2); }

/* min-height and wrapping, so a long course code still fits at 200% text size. */
.btn { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 100%; min-height: 44px; padding: 10px var(--s4); border: 0; border-radius: 10px; font: 600 15px/20px var(--font-ui); text-align: center; text-wrap: balance; cursor: pointer; user-select: none; touch-action: manipulation; transition: background-color 160ms ease, transform var(--t-press) var(--ease-out); }
.btn--primary { color: var(--paper); background: var(--brand); box-shadow: inset 0 1px 0 rgba(255, 255, 255, .14), 0 1px 2px rgba(0, 40, 20, .28); }
.btn--secondary { color: var(--ink); background: var(--paper); box-shadow: inset 0 0 0 1px var(--line-2), var(--shadow-1); }
.btn:focus-visible { outline: 2px solid transparent; box-shadow: var(--focus); }
.btn[data-pressed]:not([aria-busy=true]) { transform: scale(.97); }
@media (hover: hover) and (pointer: fine) { .btn--primary:hover { background: var(--brand-2); } .btn--secondary:hover { background: var(--paper-2); } }
.btn__stack { display: inline-grid; }
.btn__label { grid-area: 1 / 1; display: inline-flex; align-items: center; justify-content: center; gap: var(--s2); }
.btn__label--loading, .btn[data-loading] .btn__label:not(.btn__label--loading) { visibility: hidden; }
.btn[data-loading] .btn__label--loading { visibility: visible; }
/* Busy at once with no motion; the spinner label replaces it after 400ms. */
.btn[aria-busy=true] { cursor: progress; }
.btn[aria-busy=true]:not([data-loading]) .btn__label { opacity: .72; }
.spinner { display: inline-block; flex: none; width: 14px; height: 14px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin .7s linear infinite; }

.state[data-enter] .mark { animation: mark-in var(--t-enter) var(--ease-out) both; }
@keyframes mark-in { from { opacity: 0; transform: scale(.9); } }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes fade { from { opacity: 0; } }
@keyframes pulse { from { opacity: .5; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .state[data-enter] .mark { animation: fade 120ms ease-out both; }
  .spinner { animation: pulse 1.2s ease-in-out infinite alternate; }
  .btn[data-pressed] { transform: none; }
}`;
document.head.append(style);

const view = document.querySelector<HTMLElement>("#view")!;
const actions = document.querySelector<HTMLElement>("#actions")!;
type Child = Node | string | null | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs))
    element.setAttribute(name, value);
  // Text from UNTangle goes in as text nodes only, never as markup.
  element.append(...children.filter((child): child is Node | string => child !== null && child !== false));
  return element;
}
/** Static glyph markup from this file or marker-states; never from a response. */
function svg(markup: string, attrs: Record<string, string>): SVGSVGElement {
  const element = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  element.setAttribute("aria-hidden", "true");
  for (const [name, value] of Object.entries(attrs))
    element.setAttribute(name, value);
  element.innerHTML = markup;
  return element;
}
const MARKS = {
  added: `<circle cx="12" cy="12" r="11" fill="var(--brand)"/><path d="M7.5 12.4l3 3 6-6.6" fill="none" stroke="var(--paper)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  waiting: `<circle cx="12" cy="12" r="10.25" fill="none" stroke="var(--ink-3)" stroke-width="1.5" stroke-dasharray="3 2.6"/><path d="M12 7.5v5l3.2 2" fill="none" stroke="var(--ink-2)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  problem: `<circle cx="12" cy="12" r="10.25" fill="var(--danger-soft)" stroke="var(--danger)" stroke-width="1.5"/><path d="M12 7v6" stroke="var(--danger)" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16.6" r="1.2" fill="var(--danger)"/>`,
};
// The marks' circles reach radius 11, so this box puts their edge on the text's left edge.
const mark = (kind: keyof typeof MARKS) => svg(MARKS[kind], { class: "mark", viewBox: "1 1 22 22" });
function pill(state: MarkerState): HTMLElement {
  return h("span", { class: "pill", "data-marker": state }, svg(MARKER_STATES[state].glyph, { viewBox: "0 0 16 16" }), MARKER_STATES[state].word);
}
const termLabel = (term: string) => term.replace(/^([a-z])([a-z]*)-(\d{4})$/, (_, first: string, rest: string, year: string) => `${first.toUpperCase()}${rest} ${year}`);
/** "A", "A and B", "A, B and C". */
function joined(parts: string[]): string {
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}
/** One row: a name and the one fact the student acts on, each with an optional quieter line under it. */
function row(name: string, fact: string, sub: string | null = null, factSub: string | null = null): HTMLElement {
  return h("div", { class: "row" },
    h("span", { class: "name" }, name, sub ? h("small", {}, sub) : null),
    h("span", { class: "fact" }, factSub ? h("b", {}, fact) : fact, factSub ? h("small", {}, factSub) : null));
}

// The panel's own memory of the last section it confirmed, so a result can
// name it. A restarted worker can report a result the panel never saw; the
// copy then says "this section".
let confirmedTitle: string | null = null;
let state: PanelState | null = null;
let unreachable = false;
let slow = false;
let busy: string | null = null;
let enterAdded = false;

function meetingsSection(meetings: PreviewMeeting[]): HTMLElement {
  return h("section", { "aria-labelledby": "meetings-title" },
    h("h2", { id: "meetings-title" }, "Meetings"),
    meetings.length === 0
      ? h("p", { class: "meta" }, "No meetings listed.")
      : h("div", { class: "rows" }, ...meetings.map(m => row(m.days, m.time ?? "No set time", m.room))));
}
const UNKNOWN_COPY: Record<UnknownReason, string> = {
  "no-set-time": "This section has no set meeting time, so there's nothing to compare.",
  "schedule-time-missing": "A section in Main has no set time, so UNTangle can't rule out an overlap.",
  "schedule-unavailable": "Main couldn't be loaded, so nothing was compared.",
};
function verdictSection(p: Preview, changed: boolean): HTMLElement {
  const clashes: PreviewClash[] = p.clashes ?? [];
  let marker: MarkerState = p.conflict;
  let words: string;
  if (p.inSchedule === true) {
    marker = "added";
    words = `${p.title} is already in Main.`;
  }
  else if (p.conflict === "conflict")
    words = clashes.length > 0 ? `Overlaps ${joined(clashes.map(c => c.kind === "busy" ? `your busy time “${c.name}”` : c.name))}.` : "Overlaps something in Main.";
  else if (p.conflict === "clear")
    words = "Fits Main. It overlaps none of your classes or busy times.";
  else
    words = p.unknownReason ? UNKNOWN_COPY[p.unknownReason] : "UNTangle couldn't compare this section's times with Main.";
  return h("section", { "aria-labelledby": "verdict-title" },
    h("h2", { id: "verdict-title" }, "Against Main"),
    h("p", { class: "sentence", "data-marker": marker }, svg(MARKER_STATES[marker].glyph, { viewBox: "0 0 16 16" }), h("span", {}, words)),
    p.conflict === "conflict" && clashes.length > 0 && p.inSchedule !== true
      ? h("div", { class: "rows" }, ...clashes.map(c => row(c.name, c.when, c.kind === "busy" ? "Busy time" : null)))
      : null,
    changed ? h("p", { class: "note" }, "Main changed since you last reviewed this section. This is the updated check.") : null);
}
function gradesSection(grades: PreviewGrades, code: string): HTMLElement {
  let body: Child[];
  if (grades.status === "history") {
    body = [
      h("div", { class: "rows" }, row(grades.instructor, grades.averageGpa === null ? "No GPA" : grades.averageGpa.toFixed(2), `${grades.students.toLocaleString("en-US")} ${grades.students === 1 ? "student" : "students"} in ${code}`, "average GPA")),
      h("span", { class: "tag" }, grades.terms ? `${grades.source} ${grades.terms}` : grades.source),
    ];
  }
  else if (grades.status === "none")
    body = [h("p", { class: "meta" }, `No grade records for ${grades.instructor ?? "this instructor"} in ${code}.`), h("span", { class: "tag" }, grades.source)];
  else
    body = [h("p", { class: "meta" }, `Couldn't load grade history from ${grades.source}. The rest of this check is unaffected.`)];
  return h("section", { "aria-labelledby": "grades-title" }, h("h2", { id: "grades-title" }, "Grade history"), ...body);
}
function detail(next: PanelState, preview: Preview): Node[] {
  const ref = next.preview!.ref;
  const marker: MarkerState = preview.inSchedule === true ? "added" : preview.conflict;
  return [
    h("div", { class: "head" },
      h("div", { class: "codeline" }, h("h1", { class: "code", id: "view-title", tabindex: "-1" }, preview.title), pill(marker)),
      preview.courseTitle ? h("p", { class: "title" }, preview.courseTitle) : null,
      h("p", { class: "meta" }, preview.section ? `Section ${preview.section} in ${termLabel(ref.term)}` : termLabel(ref.term))),
    preview.meetings ? meetingsSection(preview.meetings) : null,
    verdictSection(preview, next.outcome === "changed"),
    preview.grades ? gradesSection(preview.grades, preview.title) : null,
    preview.details.length > 0 ? h("section", { "aria-labelledby": "more-title" }, h("h2", { id: "more-title" }, "More"), h("div", { class: "lines meta" }, ...preview.details.map(line => h("p", {}, line)))) : null,
  ].filter((node): node is HTMLElement => node !== null);
}
function result(kind: keyof typeof MARKS | null, title: string, ...body: Child[]): Node[] {
  return [h("div", { class: "state" }, kind ? mark(kind) : null, h("h1", { id: "view-title", tabindex: "-1" }, title), ...body)];
}
function lead(kind: keyof typeof MARKS, text: string): Node[] {
  return [h("div", { class: "state" }, mark(kind), h("p", { class: "lead", id: "view-title", tabindex: "-1" }, text))];
}
function button(id: string, label: string, busyLabel: string, variant: "primary" | "secondary", run: (event: MouseEvent) => void): HTMLButtonElement {
  // The name stays the visible label while busy; aria-busy says it's working.
  const element = h("button", { id, type: "button", class: `btn btn--${variant}`, "aria-label": label },
    h("span", { class: "btn__stack" }, h("span", { class: "btn__label" }, label), h("span", { class: "btn__label btn__label--loading", "aria-hidden": "true" }, h("span", { class: "spinner" }), busyLabel)));
  element.addEventListener("click", event => {
    if (!busy)
      run(event);
  });
  trackPress(element);
  return element;
}

type Screen = { name: string; body: Node[]; foot: Node[] };
function screen(): Screen {
  const named = confirmedTitle ?? "this section";
  if (unreachable)
    return { name: "error", body: lead("problem", "Couldn't reach UNTangle in this browser. Retry, or close this panel and open it again."), foot: [button("reload", "Retry", "Loading", "secondary", () => void send({ type: "panel/status" }, "reload"))] };
  if (!state)
    return { name: "loading", body: slow ? [h("p", { class: "loading", id: "view-title" }, h("span", { class: "spinner", "aria-hidden": "true" }), "Checking Main")] : [], foot: [] };
  const next = state;
  const signIn = () => button("sign-in", "Sign in", "Signing in", "primary", () => void send({ type: "panel/sign-in" }, "sign-in"));
  const signOut = () => button("sign-out", "Sign out", "Signing out", "secondary", () => void send({ type: "panel/sign-out" }, "sign-out"));
  const failure = next.outcome === "error" ? h("p", { class: "alert", role: "alert" }, next.notice) : null;
  // A device sign-in holds the worker while the student approves in the
  // UNTangle tab; the panel shows the code to match meanwhile.
  if (next.userCode !== null)
    return { name: "signing-in", body: result(null, "Approve this browser in UNTangle",
      h("p", { class: "lead" }, "A UNTangle tab opened so you can sign in and approve this browser."),
      h("p", { class: "small" }, "Check that this code matches the one shown in that tab before you approve."),
      h("p", { class: "code", id: "user-code" }, next.userCode)), foot: [] };
  if (!next.signedIn && next.pending > 0) {
    return { name: "needs-sign-in", body: result(null, confirmedTitle ? `Sign in to finish adding ${confirmedTitle}` : "Sign in to finish your add",
      h("p", { class: "lead" }, "The add is saved in this browser. Once you sign in, UNTangle sends it to Main.")), foot: [failure, signIn()].filter(n => n !== null) };
  }
  if (!next.signedIn) {
    return { name: "signed-out", body: result(null, "Sign in to check class search",
      h("p", { class: "lead" }, "UNTangle opens a window where you sign in and approve this browser. Then every section in myUNT class search shows whether it fits Main."),
      h("p", { class: "small" }, "This browser can read Main and add the sections you confirm here. It can't change anything else in your account.")), foot: [failure, signIn()].filter(n => n !== null) };
  }
  if (next.pending > 0) {
    return { name: "waiting", body: result("waiting", confirmedTitle ? `${confirmedTitle} is waiting to sync` : "Waiting to sync",
      h("p", { class: "lead" }, "The add is saved in this browser, and UNTangle hasn't confirmed it yet. Chrome sends it again when it restarts.")),
    foot: [failure, button("retry", "Sync now", "Syncing", "primary", () => void send({ type: "panel/retry" }, "retry"))].filter(n => n !== null) };
  }
  if (next.outcome === "added" && !next.preview)
    return { name: "added", body: result("added", confirmedTitle ? `Added ${confirmedTitle} to Main` : "Added to Main", h("p", { class: "lead" }, "Choose another section on class search to check it against Main.")), foot: [signOut()] };
  if (next.outcome === "rejected" && !next.preview)
    return { name: "rejected", body: result("problem", `Couldn't add ${named}`, h("p", { class: "lead" }, "UNTangle didn't accept this add, and Main is unchanged. Choose another section on class search.")), foot: [] };
  if (next.preview) {
    const p = next.preview.preview;
    const previewId = next.preview.previewId;
    const add = p.inSchedule === true ? null : button("confirm", `Add ${p.title} to Main`, "Adding", "primary", event => {
      confirmedTitle = p.title;
      // A keyboard press (detail 0) never animates; it repeats too often.
      enterAdded = event.detail > 0;
      void send({ type: "panel/confirm", previewId }, "confirm");
    });
    return { name: next.outcome === "changed" ? "changed" : "preview", body: detail(next, p), foot: [failure, add].filter(n => n !== null) };
  }
  if (next.outcome === "error")
    return { name: "error", body: lead("problem", next.notice), foot: [button("reload", "Retry", "Loading", "secondary", () => void send({ type: "panel/status" }, "reload"))] };
  return { name: "empty", body: result(null, "Choose a section on class search", h("p", { class: "lead" }, "Select the marker under any section in myUNT class search. Its check against Main opens here.")), foot: [signOut()] };
}

function render(): void {
  const focusedId = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement.id : null;
  const next = screen();
  view.dataset.view = next.name;
  view.setAttribute("aria-busy", String(next.name === "loading"));
  view.replaceChildren(...next.body);
  actions.replaceChildren(...next.foot);
  if (next.name === "added" && enterAdded)
    view.querySelector(".state")?.setAttribute("data-enter", "");
  enterAdded = false;
  // Keep focus on the same control when it survives the swap; otherwise move
  // it to the new heading so a keyboard user isn't dropped onto the body.
  if (focusedId !== null)
    (document.getElementById(focusedId) ?? document.getElementById("view-title"))?.focus();
}
let spinnerTimer: ReturnType<typeof setTimeout> | undefined;
/**
 * Marks the pressed button busy at once, without motion, and swaps in the
 * spinner label only if the work takes over 400ms (copy.md), so a fast answer
 * never flashes a spinner.
 */
function setBusy(id: string | null): void {
  busy = id;
  clearTimeout(spinnerTimer);
  for (const element of actions.querySelectorAll<HTMLButtonElement>("button")) {
    element.setAttribute("aria-busy", String(element.id === id));
    element.removeAttribute("data-loading");
  }
  if (id !== null)
    spinnerTimer = setTimeout(() => document.getElementById(id)?.setAttribute("data-loading", ""), 400);
}
async function send(message: object, from?: string): Promise<void> {
  setBusy(from ?? null);
  // A device sign-in holds the worker until the student approves in the
  // UNTangle tab, so this request's own reply lands only after approval.
  // A parallel status poll draws the matching code while the worker is busy;
  // it stops on its own once a reply reports the worker is no longer working.
  if ((message as { type?: string }).type === "panel/sign-in")
    setTimeout(() => void send({ type: "panel/status" }), 300);
  try {
    const next: unknown = await chrome.runtime.sendMessage(message);
    if (!next || typeof next !== "object" || typeof (next as PanelState).signedIn !== "boolean")
      throw new Error("Invalid worker response");
    // SAFETY: the worker is this extension's own background, and signedIn was checked above.
    const reply = next as PanelState;
    unreachable = false;
    if (reply.working) {
      // Another request holds the worker; keep asking. A sign-in in flight
      // draws its matching code while it waits.
      if (reply.userCode !== null) {
        state = reply;
        render();
      }
      setTimeout(() => void send({ type: "panel/status" }), 300);
      return;
    }
    state = reply;
  }
  catch {
    unreachable = true;
  }
  finally {
    setBusy(null);
    render();
  }
}
// Loading copy shows only after 400ms (copy.md), so a fast answer never flashes.
setTimeout(() => {
  slow = true;
  if (!state && !unreachable)
    render();
}, 400);
// The panel's port tells the worker a trusted panel is open; when the panel
// closes, the port disconnects and a running sign-in poll stops with it.
chrome.runtime.connect({ name: "panel" });
void send({ type: "panel/status" });
