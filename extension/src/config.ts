declare const __UNTANGLE_ORIGIN__: string | undefined;
export const UNTANGLE_ORIGIN = typeof __UNTANGLE_ORIGIN__ === "undefined" ? "http://127.0.0.1:3217" : __UNTANGLE_ORIGIN__;
export const TERM_PATTERN = /^(spring|summer|fall)-\d{4}$/;
export const CLASS_NUMBER_PATTERN = /^\d{4,5}$/;
export const SCHEDULE_NAME = "Main";
// Production frame origins need a live capture before release. Reserved
// placeholders deliberately grant no access to UNT login or identity pages.
export const CLASS_SEARCH_MATCHES = [
  "http://localhost:4317/class-search*",
  "https://class-search.myunt.example.invalid/*",
  "https://class-search-frame.myunt.example.invalid/*",
] as const;
export function isClassSearchUrl(raw: string | undefined): boolean {
  if (!raw)
    return false;
  try {
    const url = new URL(raw);
    return CLASS_SEARCH_MATCHES.some(pattern => {
      const expected = new URL(pattern.replace(/\*$/, ""));
      return url.origin === expected.origin && url.pathname.startsWith(expected.pathname) && !url.username && !url.password;
    });
  }
  catch {
    return false;
  }
}
