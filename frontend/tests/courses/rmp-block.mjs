/**
 * RateMyProfessors request blocker — installed as a fetch wrapper preload.
 *
 * Started with the backend in the journey work (task "UNTangle course
 * journey integration fixes"); belongs to the tests/courses directory that
 * hosts the journey's offline guarantees, not to the product.
 *
 * Works under both runtimes the backend can boot with:
 *   - Bun:   bun --preload frontend/tests/courses/rmp-block.mjs run dev
 *   - Node:  NODE_OPTIONS="--import file://$PWD/frontend/tests/courses/rmp-block.mjs"
 *            (the backend runs under Node/tsx because its better-sqlite3
 *            native addon crashes Bun)
 *
 * Every fetch to ratemyprofessors.com is rejected BEFORE any connection is
 * opened, and each attempt is logged and counted. No external RMP traffic
 * leaves the machine. The live count is readable via globalThis
 * .__rmpBlockedCount and logged on every block.
 */
const originalFetch = globalThis.fetch;
let blockedCount = 0;

globalThis.fetch = async function rmpBlockedFetch(input, init) {
  let url = "";
  try {
    if (typeof input === "string") url = input;
    else if (input instanceof URL) url = input.href;
    else if (input && typeof input.url === "string") url = input.url;
    else url = String(input);
  } catch {
    url = String(input);
  }

  if (/ratemyprofessors\.com/i.test(url)) {
    blockedCount += 1;
    globalThis.__rmpBlockedCount = blockedCount;
    const message = `[rmp-block] BLOCKED attempt #${blockedCount}: ${url}`;
    console.error(message);
    throw new Error(message);
  }

  return originalFetch.call(globalThis, input, init);
};

globalThis.__rmpBlockedCount = 0;
console.error("[rmp-block] fetch wrapper installed — ratemyprofessors.com requests are rejected and logged");
