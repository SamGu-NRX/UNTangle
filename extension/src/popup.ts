import { extensionTokens } from "@untangle/tokens/extension";
import type { PanelState } from "./shared/panel";
const style = document.createElement("style");
style.textContent = `:root { ${extensionTokens} } body { margin:0; width:360px; max-width:100vw; color:var(--ink); background:var(--paper); font:var(--text-body)/1.5 var(--font-ui) } main { padding:var(--s6) } h1 { font-size:var(--text-title); margin:0 0 var(--s4) } p { margin:0 0 var(--s3); overflow-wrap:anywhere } button { display:block; width:100%; min-height:44px; border:1px solid var(--line); border-radius:var(--r-sm); padding:var(--s2) var(--s3); margin-top:var(--s3); font:inherit; color:var(--paper); background:var(--brand); cursor:pointer } button[hidden] {display:none} button:focus-visible {outline:2px solid var(--accent);outline-offset:2px} button:disabled {opacity:.6;cursor:wait} #details {border-top:1px solid var(--line);padding-top:var(--s3)} #details:empty {display:none}`;
document.head.append(style);
const notice = document.querySelector<HTMLParagraphElement>("#notice")!;
const details = document.querySelector<HTMLDivElement>("#details")!;
const signIn = document.querySelector<HTMLButtonElement>("#sign-in")!;
const confirm = document.querySelector<HTMLButtonElement>("#confirm")!;
const retry = document.querySelector<HTMLButtonElement>("#retry")!;
let state: PanelState | null = null;
function render(next: PanelState): void {
  state = next;
  notice.textContent = next.notice;
  signIn.hidden = next.signedIn;
  confirm.hidden = !next.signedIn || !next.preview || next.pending > 0;
  retry.hidden = next.pending === 0;
  details.replaceChildren();
  if (next.preview) {
    const p = next.preview.preview;
    for (const text of [p.title, p.conflict === "conflict" ? "Conflicts with Main" : p.conflict === "clear" ? "No conflict with Main" : "Cannot check meeting times", ...p.details]) {
      const line = document.createElement("p");
      line.textContent = text;
      details.append(line);
    }
    confirm.textContent = `Add ${p.title} to Main`;
  }
}
async function send(message: object): Promise<void> {
  for (const button of [signIn, confirm, retry])
    button.disabled = true;
  try {
    const next: PanelState = await chrome.runtime.sendMessage(message);
    if (!next || typeof next.signedIn !== "boolean")
      throw new Error("Invalid worker response");
    render(next);
  }
  catch {
    notice.textContent = "Couldn't reach UNTangle. Close this panel and retry.";
  }
  finally {
    for (const button of [signIn, confirm, retry])
      button.disabled = false;
  }
}
signIn.addEventListener("click", () => { void send({ type: "panel/sign-in" }); });
confirm.addEventListener("click", () => { if (state?.preview)
  void send({ type: "panel/confirm", previewId: state.preview.previewId }); });
retry.addEventListener("click", () => { void send({ type: "panel/retry" }); });
void send({ type: "panel/status" });
