/**
 * The emailed sign-in link points at an app page, not at better-auth's
 * verify endpoint. UNT mail is Microsoft 365: Safe Links and other scanners
 * may open a link before the student does, and a GET to the verify endpoint
 * would use up the one-time token. /auth/link shows one button; only that
 * click (a form submit, which scanners don't do) reaches the verify URL.
 */

/** The query parameters better-auth's verify endpoint reads; nothing else is carried. */
const VERIFY_PARAMS = ["token", "callbackURL", "newUserCallbackURL", "errorCallbackURL"] as const;

export const LANDING_PATH = "/auth/link";
export const VERIFY_PATH = "/api/auth/magic-link/verify";

/** better-auth's verify URL -> the landing page URL with the same parameters. */
export function landingUrlFor(verifyUrl: string): string {
  const verify = new URL(verifyUrl);
  const landing = new URL(LANDING_PATH, verify.origin);
  for (const name of VERIFY_PARAMS) {
    const value = verify.searchParams.get(name);
    if (value !== null) landing.searchParams.set(name, value);
  }
  return landing.toString();
}

/** The verify parameters a landing page request carries, for its form's hidden fields. */
export function verifyParams(search: Record<string, string | string[] | undefined>): [string, string][] {
  return VERIFY_PARAMS.flatMap((name) => {
    const value = search[name];
    return typeof value === "string" && value ? [[name, value] as [string, string]] : [];
  });
}
