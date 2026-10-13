export const DEV_APP_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];
export const MOCK_ORIGIN = "http://localhost:4317";
export const MYUNT_ORIGIN = "https://my.unt.edu";
export const REPORT_PATHS = [
  "/psreports/",
  "/psc/ps/EMPLOYEE/SA/c/SA_LEARNER_SERVICES.SSR_SSENRL_TRN",
  "/psc/ps/EMPLOYEE/SA/c/SA_LEARNER_SERVICES.SSR_SSENRL_RPT",
];
export const SEARCH_PATHS = [
  "/psc/ps/EMPLOYEE/SA/c/SA_LEARNER_SERVICES.SSR_CLSRCH",
  "/psc/ps/EMPLOYEE/SA/c/SSR_STUDENT_FL.SSR_CLSRCH",
];
export function productionOrigin(raw: string | undefined): string {
  if (!raw)
    throw new Error(
      "Production build requires --origin=https://<your UNTangle host>. No default origin is trusted.",
    );
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Production origin must be an explicit HTTPS origin.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !url.hostname.includes(".") ||
    /^(?:\d+\.){3}\d+$/.test(url.hostname) ||
    /(?:^|\.)(?:localhost|example\.com|example\.org|example\.net)$|\.(?:test|invalid|example|local)$/.test(
      url.hostname,
    )
  ) {
    throw new Error(
      "Production origin must be an explicit HTTPS host, without credentials, ports, paths, localhost, or placeholder domains.",
    );
  }
  return url.origin;
}
export function pageKind(
  raw: string,
  dev: boolean,
): "transcript" | "sections" | null {
  try {
    const url = new URL(raw);
    if (dev && url.origin === MOCK_ORIGIN)
      return ["/transcript-entry", "/transcript-report"].includes(url.pathname)
        ? "transcript"
        : url.pathname === "/class-search"
          ? "sections"
          : null;
    if (url.origin !== MYUNT_ORIGIN) return null;
    if (REPORT_PATHS.some((p) => url.pathname.startsWith(p)))
      return "transcript";
    if (SEARCH_PATHS.some((p) => url.pathname.startsWith(p))) return "sections";
    return null;
  } catch {
    return null;
  }
}
export function allowedPdfUrl(
  raw: string,
  pageUrl: string,
  dev: boolean,
): boolean {
  try {
    const page = new URL(pageUrl),
      url = new URL(raw, page);
    if (url.origin !== page.origin || url.username || url.password)
      return false;
    if (dev && page.origin === MOCK_ORIGIN)
      return url.pathname === "/synthetic-transcript.pdf";
    return (
      page.origin === MYUNT_ORIGIN &&
      REPORT_PATHS.some((p) => url.pathname.startsWith(p))
    );
  } catch {
    return false;
  }
}
