import { syncHandlers } from "@/lib/document-sync/server";
import { withRateLimit } from "@/lib/rate-limit/server";

export const runtime = "nodejs";
export const GET = withRateLimit("plannerRead", syncHandlers.get);
export const PUT = withRateLimit("plannerSave", syncHandlers.put);
