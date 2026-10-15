// Builds page/index.html — a self-contained local demo of the experiment
// results with a keyboard-driven walkthrough. Run from the repo root:
//
//   node experiments/degree-plan/page/build.mjs
//
// Inlines experiments/degree-plan/results/plans-export.json into a single
// HTML file (no network, no dependencies) and writes it next to this script.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const data = readFileSync(
  path.join(here, "..", "results", "plans-export.json"),
  "utf8",
).trim();
if (!data.includes(`"experiment"`)) throw new Error("plans-export.json does not look right");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>UNTangle degree-plan experiment — bounded vs exhaustive, 298 scenarios</title>
<style>
  :root {
    --bg: #101418; --panel: #181e25; --panel2: #1f2731; --line: #2c3742;
    --text: #e8edf2; --muted: #93a1b0; --accent: #6db3f2;
    --ok: #5fbf7a; --bad: #e07a6b; --warn: #e0b45c;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  header { padding: 18px 22px 10px; border-bottom: 1px solid var(--line); }
  header h1 { margin: 0 0 4px; font-size: 16px; font-weight: 600; }
  header .meta { color: var(--muted); font-size: 12px; }
  .layout { display: flex; min-height: calc(100vh - 86px); }
  .cases { width: 46%; min-width: 420px; border-right: 1px solid var(--line); overflow-y: auto; max-height: calc(100vh - 86px); }
  .detail { flex: 1; padding: 18px 22px; overflow-y: auto; max-height: calc(100vh - 86px); }
  .row { display: flex; gap: 10px; padding: 7px 22px; border-bottom: 1px solid var(--panel2); cursor: pointer; align-items: baseline; }
  .row:hover { background: var(--panel); }
  .row.sel { background: var(--panel2); box-shadow: inset 3px 0 0 var(--accent); }
  .row .id { flex: 1; }
  .row .kind { color: var(--muted); font-size: 11px; }
  .badge { font-size: 11px; padding: 1px 7px; border-radius: 9px; }
  .ok  { color: var(--ok); }
  .bad { color: var(--bad); }
  .neu { color: var(--warn); }
  .badge.feasible { background: rgba(95,191,122,.12); color: var(--ok); }
  .badge.infeasible { background: rgba(224,122,107,.12); color: var(--bad); }
  .badge.assumes { background: rgba(224,180,92,.12); color: var(--warn); }
  h2 { font-size: 13px; font-weight: 600; margin: 0 0 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; }
  .stepper { display: flex; gap: 8px; align-items: center; margin: 12px 0 14px; flex-wrap: wrap; }
  .termchip { padding: 3px 10px; border: 1px solid var(--line); border-radius: 12px; font-size: 12px; color: var(--muted); }
  .termchip.on { border-color: var(--accent); color: var(--text); background: var(--panel2); }
  .termdetail { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; margin-bottom: 12px; }
  .termdetail .courses { margin: 6px 0 0; padding-left: 0; list-style: none; }
  .termdetail li { padding: 2px 0; }
  .creditline { color: var(--muted); font-size: 12px; }
  .witness { background: rgba(224,122,107,.07); border: 1px solid rgba(224,122,107,.35); border-radius: 8px; padding: 14px 16px; white-space: pre-wrap; }
  .summary { color: var(--muted); font-size: 12px; margin: 6px 0 14px; }
  kbd { background: var(--panel2); border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 5px; padding: 1px 6px; font-size: 11px; }
  .keys { margin-top: 18px; color: var(--muted); font-size: 12px; line-height: 2; }
  .none { color: var(--muted); font-style: italic; }
</style>
</head>
<body>
<header>
  <h1>UNTangle degree-plan experiment — bounded vs exhaustive planner</h1>
  <div class="meta" id="meta"></div>
</header>
<div class="layout">
  <nav class="cases" id="cases" aria-label="Scenario cases (j/k or arrow keys to move, / to filter)"></nav>
  <main class="detail" id="detail" aria-live="polite"></main>
</div>
<script id="experiment-data" type="application/json">__DATA__</script>
<script>
"use strict";
const DATA = JSON.parse(document.getElementById("experiment-data").textContent);
const CASES = DATA.cases;

const state = { sel: 0, term: 1, filter: "" };
const listEl = document.getElementById("cases");
const detailEl = document.getElementById("detail");

const anchorLabel = (a) => (a.kind === "F" ? "Fall " + a.year : a.kind === "S" ? "Spring " + a.year : a.kind === "Su" ? "Summer " + a.year : JSON.stringify(a));
const offeringsLabel = (o) => o.defaultPattern + " terms, summer " + (o.summerOffered ? "offered" : "excluded") + " (assumption — catalog has no offering metadata)";

document.getElementById("meta").textContent =
  DATA.experiment + " · anchor " + anchorLabel(DATA.anchor) +
  " · catalog sha256 " + DATA.catalogSha256.slice(0, 12) + "… · " +
  CASES.length + " cases · " + offeringsLabel(DATA.offeringAssumptions);

const majorName = { cs: "Computer Science", ce: "Computer Engineering", math: "Mathematics" };

function visible() {
  const f = state.filter.toLowerCase();
  if (!f) return CASES.map((c, i) => [c, i]);
  return CASES.map((c, i) => [c, i]).filter(([c]) =>
    c.id.toLowerCase().includes(f) || (c.feasible ? "feasible" : "infeasible").includes(f));
}

function renderList() {
  const rows = visible();
  listEl.innerHTML = "";
  rows.forEach(([c, i]) => {
    const div = document.createElement("div");
    div.className = "row" + (i === state.sel ? " sel" : "");
    div.setAttribute("role", "button");
    div.innerHTML =
      '<span class="id">' + c.id + "</span>" +
      '<span class="kind">' + (majorName[c.major] || c.major) + " · " + c.equivalence + "</span>" +
      (c.feasible
        ? '<span class="badge feasible">min ' + c.minTerms + "t</span>"
        : '<span class="badge infeasible">no plan</span>') +
      (c.equivalence === "assume" ? '<span class="badge assumes">assumes eq. credit</span>' : "");
    div.addEventListener("click", () => { state.sel = i; state.term = 1; render(); });
    listEl.appendChild(div);
  });
  if (rows.length === 0) listEl.innerHTML = '<div class="row"><span class="none">no cases match the filter</span></div>';
  const sel = listEl.querySelector(".sel");
  if (sel) sel.scrollIntoView({ block: "nearest" });
}

const TERM_NAMES = ["Fall 2026", "Spring 2027", "Fall 2027", "Spring 2028", "Fall 2028", "Spring 2029", "Fall 2029", "Spring 2030"];

function renderDetail() {
  const c = CASES[state.sel];
  const bits = [];
  bits.push('<div class="summary">' + c.id + " · " + (majorName[c.major] || c.major) +
    " · " + c.scenarioKind + " · cap " + c.termCap + "h · horizon " + c.horizon +
    " terms · " + c.equivalence + " mode</div>");
  bits.push('<div class="summary">plan count: ' + (c.planCount === null ? "search incomplete" : c.planCount) +
    " · agrees with exhaustive on verdict: " + (c.verdictAgrees ? "yes" : "NO") +
    " · optimum agrees: " + (c.optimumAgrees === null ? "n/a" : c.optimumAgrees ? "yes" : "NO") + "</div>");

  if (!c.feasible) {
    bits.push('<h2>No feasible plan — witness</h2>');
    bits.push('<div class="witness">' + (c.witness ? JSON.stringify(c.witness, null, 2) : "none recorded") + "</div>");
  } else {
    const n = c.terms.length - 1;
    state.term = Math.min(state.term, n);
    bits.push("<h2>Optimal plan — " + c.minTerms + " term" + (c.minTerms === 1 ? "" : "s") + " (stepping term " + state.term + " of " + n + ")</h2>");
    bits.push('<div class="stepper">' + c.terms.slice(1).map((courses, i) => {
      const t = i + 1;
      return '<span class="termchip' + (t === state.term ? " on" : "") + '">' + t + "</span>";
    }).join("") + "</div>");
    const courses = c.terms[state.term] || [];
    const coursesHtml = courses.length
      ? "<li>" + courses.join("</li><li>") + "</li>"
      : '<li class="none">(nothing — term unused in this plan)</li>';
    bits.push('<div class="termdetail"><div class="creditline">' + TERM_NAMES[state.term - 1] +
      " · term " + state.term + " · " + courses.length + " course" + (courses.length === 1 ? "" : "s") + "</div><ul class=courses>" + coursesHtml + "</ul></div>");
  }
  bits.push('<div class="keys">↑/↓ or j/k select case · ←/→ or h/l step terms · Home/End jump · <kbd>/</kbd> filter · <kbd>Esc</kbd> clear · <kbd>?</kbd> keys</div>');
  detailEl.innerHTML = bits.join("");
}

function render() { renderList(); renderDetail(); }

function move(delta) {
  const rows = visible();
  if (rows.length === 0) return;
  const pos = rows.findIndex(([, i]) => i === state.sel);
  const next = rows[Math.max(0, Math.min(rows.length - 1, (pos === -1 ? 0 : pos) + delta))];
  if (next) { state.sel = next[1]; state.term = 1; render(); }
}

document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const filterActive = document.activeElement === filterEl;
  if (filterActive && e.key !== "Escape") return;
  switch (e.key) {
    case "j": case "ArrowDown": e.preventDefault(); move(1); break;
    case "k": case "ArrowUp": e.preventDefault(); move(-1); break;
    case "h": case "ArrowLeft": e.preventDefault(); state.term = Math.max(1, state.term - 1); renderDetail(); break;
    case "l": case "ArrowRight": e.preventDefault(); state.term = Math.min(CASES[state.sel].terms.length - 1, state.term + 1); renderDetail(); break;
    case "Home": e.preventDefault(); state.term = 1; renderDetail(); break;
    case "End": e.preventDefault(); state.term = Math.max(1, CASES[state.sel].terms.length - 1); renderDetail(); break;
    case "/": e.preventDefault(); filterEl.focus(); break;
    case "Escape": state.filter = ""; filterEl.value = ""; render(); break;
  }
});

// Filter input — created here so / focuses it; kept out of the committed
// markup to make the data/behavior split obvious.
const filterEl = document.createElement("input");
filterEl.placeholder = "filter ( / )";
filterEl.style.cssText = "position:fixed;top:12px;right:16px;z-index:2;background:var(--panel);color:var(--text);border:1px solid var(--line);border-radius:6px;padding:4px 8px;font:inherit;font-size:12px;";
filterEl.addEventListener("input", () => { state.filter = filterEl.value; state.sel = 0; state.term = 1; render(); });
filterEl.addEventListener("keydown", (e) => { if (e.key === "Escape") filterEl.blur(); });
document.body.appendChild(filterEl);

render();
</script>
</body>
</html>
`;

const out = path.join(here, "index.html");
writeFileSync(out, html.replace("__DATA__", data));
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KiB incl. data)`);
