export const APP_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000", "https://untangle.example.com"];
export const MOCK_ORIGIN = "http://localhost:4317";
export const MYUNT_ORIGIN = "https://my.unt.edu";
export const REPORT_PATHS = ["/psreports/", "/psc/ps/EMPLOYEE/SA/c/SA_LEARNER_SERVICES.SSR_SSENRL_TRN", "/psc/ps/EMPLOYEE/SA/c/SA_LEARNER_SERVICES.SSR_SSENRL_RPT"];
export const SEARCH_PATHS = ["/psc/ps/EMPLOYEE/SA/c/SA_LEARNER_SERVICES.SSR_CLSRCH", "/psc/ps/EMPLOYEE/SA/c/SSR_STUDENT_FL.SSR_CLSRCH"];
export function pageKind(raw: string, dev: boolean): "transcript" | "sections" | null {
  try {
    const url = new URL(raw);
    if (dev && url.origin === MOCK_ORIGIN) return url.pathname === "/transcript-report" ? "transcript" : url.pathname === "/class-search" ? "sections" : null;
    if (url.origin !== MYUNT_ORIGIN) return null;
    if (REPORT_PATHS.some(p => url.pathname.startsWith(p))) return "transcript";
    if (SEARCH_PATHS.some(p => url.pathname.startsWith(p))) return "sections";
    return null;
  } catch { return null; }
}
export function allowedPdfUrl(raw: string, pageUrl: string, dev: boolean): boolean {
  try {
    const page = new URL(pageUrl), url = new URL(raw, page);
    if (url.origin !== page.origin || url.username || url.password) return false;
    if (dev && page.origin === MOCK_ORIGIN) return url.pathname === "/synthetic-transcript.pdf";
    return page.origin === MYUNT_ORIGIN && REPORT_PATHS.some(p => url.pathname.startsWith(p));
  } catch { return false; }
}
