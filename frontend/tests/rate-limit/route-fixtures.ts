import { afterEach, beforeEach, setSystemTime } from "bun:test";
import { windowMs } from "@/lib/rate-limit/config";

/** For each test in the calling file, trust x-real-ip so fixtures can give themselves separate IP buckets. */
export function trustRealIp() {
  beforeEach(() => {
    // Bun runs file-level tests in one process. Restoring this process-wide
    // setting in afterEach lets another file turn the header off during an
    // awaited request, collapsing otherwise distinct fixtures into "unknown".
    process.env.RATE_LIMIT_TRUSTED_PROXY = "reverse-proxy";
  });
  afterEach(() => setSystemTime());
}

/** Stops the clock mid-window for the rest of the test, so a burst cannot straddle two windows. */
export function pinClockMidWindow() {
  setSystemTime(Math.floor(Date.now() / windowMs) * windowMs + windowMs / 2);
}
