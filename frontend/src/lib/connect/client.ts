import {
  acceptsResponse,
  request,
  HELLO_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  type Payload,
  type Reason,
} from "./protocol";
export class ConnectError extends Error {
  constructor(public reason: Reason) {
    super(reason);
  }
}
export function exchange(
  resource: "hello" | "transcript" | "sections",
  onProgress: (stage: "waiting" | "reading") => void,
  signal: AbortSignal,
): Promise<Payload | "ready"> {
  return new Promise((resolve, reject) => {
    const nonce = crypto.randomUUID();
    const origin = window.location.origin;
    function cleanup() {
      clearTimeout(timer);
      clearInterval(heartbeat);
      window.removeEventListener("message", receive);
      signal.removeEventListener("abort", cancel);
    }
    function cancel() {
      cleanup();
      window.postMessage(request(nonce, { type: "cancel" }), origin);
      reject(new DOMException("Import cancelled", "AbortError"));
    }
    function receive(event: MessageEvent) {
      const message = acceptsResponse(event, window, origin, nonce);
      if (!message) return;
      if (message.type === "progress") {
        onProgress(message.stage);
        return;
      }
      if (message.type === "error") {
        cleanup();
        reject(new ConnectError(message.reason));
        return;
      }
      if (
        resource === "hello" &&
        message.type === "capabilities" &&
        message.resources.includes("transcript")
      ) {
        cleanup();
        resolve("ready");
      }
      if (
        resource !== "hello" &&
        message.type === "result" &&
        (resource === "sections") === (message.payload.kind === "sections")
      ) {
        cleanup();
        resolve(message.payload);
      }
    }
    // A message every 15 seconds keeps MV3 awake through the 90-second user-driven wait.
    const heartbeat =
      resource === "hello"
        ? undefined
        : setInterval(() => {
            window.postMessage(
              request(crypto.randomUUID(), { type: "hello" }),
              origin,
            );
          }, 15_000);
    const timer = setTimeout(
      () => {
        cleanup();
        window.postMessage(request(nonce, { type: "cancel" }), origin);
        reject(
          new ConnectError(resource === "hello" ? "NO_EXTENSION" : "TIMEOUT"),
        );
      },
      resource === "hello" ? HELLO_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
    );
    window.addEventListener("message", receive);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) {
      cancel();
      return;
    }
    window.postMessage(
      request(
        nonce,
        resource === "hello"
          ? { type: "hello" }
          : { type: "request", resource },
      ),
      origin,
    );
  });
}
export const errorText: Record<Reason, string> = {
  NO_EXTENSION:
    "The extension wasn't found. Install it on desktop, or upload your transcript below.",
  NO_REPORT:
    "The transcript page closed. Open the report again, or upload the PDF.",
  AMBIGUOUS_REPORT:
    "More than one report page is open. Close the extra reports and try again.",
  BUSY: "Another UNTangle tab is importing. Finish or cancel that import, then try again.",
  DOWNLOAD_FAILED:
    "The report couldn't be downloaded. Save it from myUNT, then upload it below.",
  UNSUPPORTED_REPORT:
    "This report page isn't supported yet. Save the PDF and upload it below.",
  INVALID_PDF:
    "myUNT didn't return a PDF. Open View Report again, or upload your saved PDF.",
  TOO_LARGE: "The report is too large for Connect. Upload a PDF under 12 MB.",
  TIMEOUT:
    "The report didn't arrive within 90 seconds. Try again when it's open, or upload the PDF.",
  DISCONNECTED:
    "The extension disconnected. Reload this page, or upload your PDF.",
};
