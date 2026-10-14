/**
 * Build-time configuration. The UNTangle app origin is injected by
 * scripts/build.ts via `define`; the default matches the repo's journey
 * convention (frontend/tests/map-e2e/journey.mjs uses 127.0.0.1:3217).
 *
 * This is the only place an origin is named. The extension never reads .env
 * files and never handles credentials: the service worker only sends requests
 * to this origin and lets the browser attach the student's existing session.
 */
declare const __UNTANGLE_ORIGIN__: string | undefined;

export const UNTANGLE_ORIGIN: string =
  typeof __UNTANGLE_ORIGIN__ === "undefined" ? "http://127.0.0.1:3217" : __UNTANGLE_ORIGIN__;

/** Same validation as frontend/src/lib/sections/config.ts termPattern. */
export const TERM_PATTERN = /^(spring|summer|fall)-\d{4}$/;

/** Same validation as frontend/src/lib/sections/config.ts classNumberPattern. */
export const CLASS_NUMBER_PATTERN = /^\d{4,5}$/;

/** Where the saved schedule lives, matching frontend SCHEDULE_NAME (components/shell/plan-status.ts). */
export const SCHEDULE_NAME = "Main";
