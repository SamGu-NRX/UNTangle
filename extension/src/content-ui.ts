import { extensionTokens } from "@untangle/tokens/extension";
export const ANNOTATION_ATTRIBUTE = "data-unt-row";
export function buildMarker(rowId: string, select: () => void): {
  host: HTMLTableRowElement;
  update: (marker: string) => void;
} {
  const host = document.createElement("tr");
  host.setAttribute(ANNOTATION_ATTRIBUTE, rowId);
  const cell = document.createElement("td");
  cell.colSpan = 20;
  const mount = document.createElement("span");
  cell.append(mount);
  host.append(cell);
  const root = mount.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `:host { all: initial; ${extensionTokens} } button { font: var(--text-body) var(--font-ui); min-height:44px; padding:var(--s2) var(--s3); color:var(--ink); background:var(--paper); border:1px solid var(--line); border-radius:var(--r-sm); cursor:pointer } button:focus-visible { outline:2px solid var(--accent); outline-offset:2px } button[data-marker=conflict] { color:var(--danger) }`;
  const button = document.createElement("button");
  button.type = "button";
  button.addEventListener("click", () => select());
  root.append(style, button);
  const update = (marker: string) => {
    const safe = ["conflict", "clear"].includes(marker) ? marker : "unknown";
    host.setAttribute("data-unt-marker", safe);
    button.dataset.marker = safe;
    button.textContent = safe === "conflict" ? "Conflict" : safe === "clear" ? "No conflict" : "Cannot check";
    button.setAttribute("aria-label", `${button.textContent}. Review section in UNTangle`);
  };
  update("unknown");
  return { host, update };
}
