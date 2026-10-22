import { syncHandlers } from "@/lib/document-sync/server";
import { withRateLimit } from "@/lib/rate-limit/server";
import { sectionsProxy } from "@/lib/sections/server";

export const runtime = "nodejs";
export const GET = withRateLimit("documentFlood", syncHandlers.availability(
  (term, courseCode) => sectionsProxy.getCourseSections(term, courseCode),
));
