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
    if (saved === undefined) delete process.env.RATE_LIMIT_TRUSTED_PROXY;
    else process.env.RATE_LIMIT_TRUSTED_PROXY = saved;
    setSystemTime();
  });
}

/** Stops the clock mid-window for the rest of the test, so a burst cannot straddle two windows. */
export function pinClockMidWindow() {
  setSystemTime(Math.floor(Date.now() / windowMs) * windowMs + windowMs / 2);
}
