import { afterEach, beforeEach, setSystemTime } from "bun:test";
import { windowMs } from "@/lib/rate-limit/config";

/** For each test in the calling file, trust x-real-ip so fixtures can give themselves separate IP buckets. */
export function trustRealIp() {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.RATE_LIMIT_TRUSTED_PROXY;
    process.env.RATE_LIMIT_TRUSTED_PROXY = "reverse-proxy";
  });
  afterEach(() => {
    if (saved !== undefined) process.env.RATE_LIMIT_TRUSTED_PROXY = saved;
    // The env is deliberately left set when nothing saved it: test files run
    // concurrently in one process, so a deletion here would yank the proxy
    // trust out from under another file's limiter loop mid-flight and collapse
    // both callers onto the untrusted fallback identity.
    setSystemTime();
  });
}

/** Stops the clock mid-window for the rest of the test, so a burst cannot straddle two windows. */
export function pinClockMidWindow() {
  setSystemTime(Math.floor(Date.now() / windowMs) * windowMs + windowMs / 2);
}
