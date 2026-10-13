export {};
const status = document.getElementById("status")!;
const origin = document.getElementById("origin")!;
const request = document.getElementById("request")!;
const detail = document.getElementById("detail")!;
const button = document.getElementById("approve") as HTMLButtonElement;
let approvalId: string | undefined;
let approving = false;
async function refresh() {
  if (approving) return;
  try {
    const result = await chrome.runtime.sendMessage({ type: "status" });
    approvalId = result.waiting ? result.approvalId : undefined;
    request.hidden = !result.waiting;
    origin.textContent = result.origin ?? "";
    status.textContent = result.waiting
      ? `A ${result.resource === "sections" ? "class search" : "transcript"} import is waiting.`
      : "No import is waiting. Start Connect in UNTangle.";
    detail.textContent = result.detail ?? "";
    button.disabled = !result.ready || result.reading;
  } catch {
    approvalId = undefined;
    button.disabled = true;
    status.textContent = "Connection unavailable. Reload the extension.";
  }
}
button.addEventListener("click", (event) => {
  if (!event.isTrusted || !approvalId || button.disabled) return;
  approving = true;
  button.disabled = true;
  const approved = approvalId;
  approvalId = undefined;
  status.textContent = "Reading the approved report…";
  void chrome.runtime
    .sendMessage({ type: "approve", approvalId: approved })
    .then((result) => {
      status.textContent = result.accepted
        ? "Sent to the requesting UNTangle tab."
        : "The request changed or the report is unavailable. Start again in UNTangle.";
    })
    .catch(() => {
      status.textContent = "The import disconnected. Start again in UNTangle.";
    });
});
void refresh();
setInterval(() => void refresh(), 1000);
