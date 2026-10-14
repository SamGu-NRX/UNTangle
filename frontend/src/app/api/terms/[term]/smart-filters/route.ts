import { gradesHistory } from "@/lib/grades-history";
import { withRateLimit } from "@/lib/rate-limit/server";
import { sectionsProxy } from "@/lib/sections/server";
import { createTermFilterHandler } from "@/lib/smart-filters/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Grade data flows only through the shared grades-history service and its
// limiter; section data only through the app's own sections proxy.
const handler = createTermFilterHandler({
  termSections: (term) => sectionsProxy.getTermSections(term),
  courseHistory: (subject, number) => gradesHistory.getCourseHistory(subject, number),
});

async function getSmartFilters(request: Request, context: { params: Promise<{ term: string }> }): Promise<Response> {
  const { term } = await context.params;
  return handler(request, term);
}

export const GET = withRateLimit("smartFilters", getSmartFilters);
