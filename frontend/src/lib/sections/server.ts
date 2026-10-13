import "server-only";
import { after } from "next/server";
import { SectionsProxy } from "./proxy";

declare global {
  var untangleSectionsProxy: SectionsProxy | undefined;
}

/** Keeps a refresh alive past the response. Outside a request, `after` throws; let it run. */
function retain(work: Promise<void>) {
  try {
    after(work);
  } catch {
    void work;
  }
}

// Next can load route modules separately and reloads them in development. One cache per
// process keeps every route sharing the same files and in-flight requests.
export const sectionsProxy = (globalThis.untangleSectionsProxy ??= new SectionsProxy({ retain }));
