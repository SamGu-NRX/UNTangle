export const supportedTerms = [{ id: "spring-2027", label: "2027 Spring" }] as const;
export const vsbUrls = {
  origin: "https://vsb.untgrades.app",
  subjectPath: "/data/{term}/{subject}.json",
  termPath: "/data/{term}.json",
};

export type SectionsConfig = {
  mode: "direct" | "proxy";
  fileLayout: "subject-first" | "term-only";
  urls: typeof vsbUrls;
  maxDirectBytes: number;
};
export class SectionsConfigError extends Error {
  constructor(reason: string) { super(`Sections configuration: ${reason}`); this.name = "SectionsConfigError"; }
}
// Mobile protection policy: bound direct JSON at 2 MiB, well below the 16 MB
// current term file. Subject-file sizes have not yet been verified with Dylan.
const directByteLimit = 2 * 1024 * 1024;
export function createSectionsConfig(input: {
  mode?: string;
  fileLayout?: SectionsConfig["fileLayout"];
  urls?: typeof vsbUrls;
  maxDirectBytes?: number;
} = {}): SectionsConfig {
  // Dylan's subject files and CORS permission are pending; use the proxy until
  // the deployment explicitly admits direct delivery through SECTIONS_MODE.
  const mode = input.mode ?? "proxy";
  if (mode !== "proxy" && mode !== "direct") throw new SectionsConfigError("SECTIONS_MODE must be direct or proxy");
  const fileLayout = input.fileLayout ?? "subject-first";
  const urls = input.urls ?? vsbUrls;
  const maxDirectBytes = input.maxDirectBytes ?? directByteLimit;
  const origin = new URL(urls.origin);
  if (!["https:", "http:"].includes(origin.protocol) || origin.origin !== urls.origin || origin.username || origin.password) throw new SectionsConfigError("vsb origin must be an HTTP(S) origin without credentials or a path");
  if (!urls.termPath.split(/[?#]/)[0].includes("{term}") || !urls.subjectPath.split(/[?#]/)[0].includes("{term}") || !urls.subjectPath.split(/[?#]/)[0].includes("{subject}")) throw new SectionsConfigError("URL layout requires {term} and a subject-file {subject} path placeholder");
  for (const template of [urls.termPath, urls.subjectPath]) {
    if (!template.startsWith("/") || template.startsWith("//") || new URL(template, urls.origin).origin !== origin.origin) throw new SectionsConfigError("file paths must stay on the configured vsb origin");
  }
  const probePath = (template: string) => new URL(template.replace("{term}", "spring-2027").replace("{subject}", "MATH"), urls.origin).pathname;
  if (!probePath(urls.subjectPath).includes("MATH") || probePath(urls.subjectPath) === probePath(urls.termPath)) throw new SectionsConfigError("subject path must retain its subject and differ from the whole-term path after URL normalization");
  if (mode === "direct" && fileLayout !== "subject-first") throw new SectionsConfigError("direct whole-term downloads are refused on all devices; use subject-first with proxy fallback");
  if (!Number.isSafeInteger(maxDirectBytes) || maxDirectBytes <= 0 || maxDirectBytes > directByteLimit) throw new SectionsConfigError("maxDirectBytes must be positive and at most 2 MiB; oversized direct files must use the proxy");
  return { mode, fileLayout, urls: { ...urls }, maxDirectBytes };
}
export function parseSectionsConfig(value: unknown): SectionsConfig {
  if (typeof value !== "object" || value === null || !("mode" in value) || !("fileLayout" in value) || !("urls" in value) || !("maxDirectBytes" in value) ||
    typeof value.mode !== "string" || (value.fileLayout !== "subject-first" && value.fileLayout !== "term-only") || typeof value.maxDirectBytes !== "number" ||
    typeof value.urls !== "object" || value.urls === null || !("origin" in value.urls) || !("subjectPath" in value.urls) || !("termPath" in value.urls) ||
    typeof value.urls.origin !== "string" || typeof value.urls.subjectPath !== "string" || typeof value.urls.termPath !== "string") {
    throw new SectionsConfigError("invalid /api/sections/config response");
  }
  return createSectionsConfig({ mode: value.mode, fileLayout: value.fileLayout, maxDirectBytes: value.maxDirectBytes,
    urls: { origin: value.urls.origin, subjectPath: value.urls.subjectPath, termPath: value.urls.termPath } });
}
export function vsbFileUrl(config: SectionsConfig, term: string, subject?: string): string {
  if (!/^(spring|summer|fall)-\d{4}$/.test(term) || (subject !== undefined && !/^[A-Z]+$/.test(subject))) throw new SectionsConfigError("invalid term or subject in file URL");
  const path = (subject ? config.urls.subjectPath : config.urls.termPath)
    .replace("{term}", encodeURIComponent(term)).replace("{subject}", encodeURIComponent(subject ?? ""));
  return new URL(path, config.urls.origin).href;
}
