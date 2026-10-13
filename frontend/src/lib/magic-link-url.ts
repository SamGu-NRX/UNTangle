/**
 * The emailed sign-in link points at an app page, not at better-auth's
 * verify endpoint. UNT mail is Microsoft 365: Safe Links and other scanners
 * may open a link before the student does, and a GET to the verify endpoint
 * would use up the one-time token. /auth/link shows one button; only that
 * click (a form submit, which scanners don't do) reaches the verify URL.
 *
 * The parameters ride in the URL fragment (/auth/link#token=…), which
 * browsers never send to the server, so an unused token stays out of
 * request and log-drain logs. The page reads them on the client.
 */

/** The query parameters better-auth's verify endpoint reads; nothing else is carried. */
const VERIFY_PARAMS = ["token", "callbackURL", "newUserCallbackURL", "errorCallbackURL"] as const;

export const LANDING_PATH = "/auth/link";
export const VERIFY_PATH = "/api/auth/magic-link/verify";

/** better-auth's verify URL -> the landing page URL, with the same parameters in its fragment. */
export function landingUrlFor(verifyUrl: string): string {
  const verify = new URL(verifyUrl);
  const fragment = new URLSearchParams();
  for (const name of VERIFY_PARAMS) {
    const value = verify.searchParams.get(name);
    if (value !== null) fragment.set(name, value);
  }
  return `${new URL(LANDING_PATH, verify.origin).toString()}#${fragment.toString()}`;
}

/** The verify parameters in a landing page's fragment ("#token=…"), for its form's hidden fields. */
export function verifyParamsFromFragment(hash: string): [string, string][] {
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  return VERIFY_PARAMS.flatMap((name) => {
    const value = fragment.get(name);
    return value ? [[name, value] as [string, string]] : [];
  });
}
