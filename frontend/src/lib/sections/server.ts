import "server-only";
import { after } from "next/server";
import { VsbTermCache } from "./cache";
import { createSectionSource, supportedTerms } from "./source";
import { sectionsConfig } from "./settings";

declare global {
  var untangleVsbProxyCache: VsbTermCache | undefined;
}

// Next can bundle routes separately or reload their modules in development.
// Keep one cache per process across both routes and server consumers.
const cache = globalThis.untangleVsbProxyCache ??= new VsbTermCache({ config: sectionsConfig, terms: supportedTerms.map(term => term.id),
  retainBackground: work => after(() => work),
});
export const sectionSource = createSectionSource(cache);
