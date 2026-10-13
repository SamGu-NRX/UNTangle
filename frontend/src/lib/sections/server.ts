import "server-only";
import { after } from "next/server";
import { join } from "node:path";
import { VsbTermCache } from "./cache";
import { createSectionSource, supportedTerms } from "./source";

declare global {
  var untangleVsbTermCache: VsbTermCache | undefined;
}

// Next can bundle routes separately or reload their modules in development.
// Keep one cache per process across both routes and server consumers.
const cache = globalThis.untangleVsbTermCache ??= new VsbTermCache({ directory: join(process.cwd(), ".sections-cache"), terms: supportedTerms.map(term => term.id),
  retainBackground: work => after(() => work),
});
export const sectionSource = createSectionSource(cache);
