# UNTangle Connect v1

For the developer loading the extension and Sam verifying the real portal.

After approval in the extension popup, Connect reads a transcript report the student has opened, then sends it to `/connect` for browser parsing and course review. It never opens portal pages, reads credentials or cookies, or stores the PDF. The browser supplies its existing session when fetching a same-origin report URL. Changing the signed-in account remounts Connect and discards consent, pending work, review rows, and row approvals. Saving reuses the existing planner persistence panel, including conflict version selection, signed-out retry, and export recovery.

## Build and load

From the repository root, wrap heavy commands with `extension/scripts/heavy.sh`. Exit 75 means admission was refused; wait and retry.

```sh
extension/scripts/heavy.sh bun install --frozen-lockfile
extension/scripts/heavy.sh bun install --cwd extension --frozen-lockfile
cd extension
./scripts/heavy.sh bun run build:dev
```

In desktop Chromium, open `chrome://extensions`, enable Developer mode, choose Load unpacked, and select `extension/dist-dev`. Open `http://localhost:3000/connect`. For production, run `./scripts/heavy.sh bun build.ts --origin=https://<verified-UNTangle-host>` from `extension`. Replace the bracketed host with the verified release origin. The build fails for a missing origin, localhost, or placeholder domains. `extension/dist` trusts only that explicit HTTPS origin and myUNT. Development trusts only localhost:3000 and 127.0.0.1:3000, plus the mock portal. There is no production origin default.

## Protocol and permissions

A page request only queues work. Open the extension popup, check the displayed requesting origin, and press **Send to UNTangle**. The report-page button opens this trusted popup and cannot approve a read itself. Only messages from the extension's own popup URL can consume the one-request approval token. Synthetic page clicks and stale approval tokens do not authorize a read. Approval is tied to the pending port and is consumed before fetching. There is no automatic report download on readiness or an app message.

The page uses `window.postMessage` to its exact origin. An isolated content script passes typed version-1 messages over a runtime port to the extension worker. This avoids a hard-coded extension ID in UNTangle and keeps Chrome APIs outside the page. Both page and content script check source and origin. The worker additionally checks the extension sender, top-level frame, exact app origin, and `/connect` path. Nonces bind hello, request, progress, result, error, and cancellation to the requesting port. One import can be active at a time; extra tabs get `BUSY`. Disconnect and cancellation clear the pending request, and report replies arriving afterward are discarded. A fresh-nonce hello every 15 seconds keeps the MV3 worker active during the wait. The bridge disconnects when a client-side route leaves `/connect`. Request expiry is 90 seconds, a v1 recovery budget rather than a measured portal latency.

PDFs travel as base64 because Chrome runtime messaging uses JSON serialization. Payloads are bounded to the existing 12 MiB importer limit. Results may also carry readable transcript text or visible class-search rows. The frontend redacts text with the existing identity-redaction function before calling the existing local parser and reconciliation functions. Connect sends nothing to AI services. Scanned PDFs link to the existing importer.

Chrome ignores the path portion of `host_permissions`. Therefore the manifest grants only `my.unt.edu`, explicit app origins, and a dev-only localhost mock origin. Content-script match paths and runtime URL checks enforce the transcript/class-search page scope. There are no `cookies`, `storage`, `webRequest`, `scripting`, or global `tabs` permissions. The worker can query URLs for the granted hosts only. Fetches must stay on the report's origin and configured report path; redirects fail closed. Multiple report pages require closing extras, rather than guessing which one to read.

## Mock and proof

Browser tests use `.pw.ts`, which Bun's default test discovery skips. `verify.sh` runs the full frontend Bun suite before launching the separate Playwright proof.

The server binds to localhost:4317 and serves fabricated reports only. It includes a transcript entry form, PDF report, readable HTML report, an asynchronous existing-node report link, and visible/hidden class-search rows and cells. It never proxies the real portal. The proof runner starts its own mock and Next.js server, launches persistent Chromium with `--load-extension`, waits across MV3's 30-second idle threshold, and closes the browser and servers when done. It blocks browser requests to real myUNT.

```sh
extension/scripts/heavy.sh extension/scripts/verify.sh
cd extension
./scripts/heavy.sh bun run check
./scripts/heavy.sh bun run build:dev
./scripts/heavy.sh bun run proof
```

## Real myUNT acceptance

Sam must check the actual transcript component path, report wrapper DOM, and download URL with his own logged-in browser. V1 supports configured PeopleSoft component paths and `/psreports/` on `my.unt.edu`; these paths are hypotheses until that check. A report on another host, a native PDF viewer without an injectable HTML wrapper, or an unknown rendered report falls back to upload. The rendered-text selector and table-header section extractor are deliberately narrow. Real PeopleSoft nested frames, header labels, download URLs, and report access errors remain unverified. Async readiness is covered by the mock popup's waiting reprobe, including existing-node attribute and text changes. Keep production origin and portal paths explicit when adding verified variants.

On phones without desktop extension support, upload is the supported path. This branch does not include store publication or registration automation.
