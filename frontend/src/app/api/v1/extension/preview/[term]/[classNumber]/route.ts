import { withRateLimit } from "@/lib/rate-limit/server";
import { extensionHttp } from "@/server/extension/routes";

export const runtime = "nodejs";

async function preview(request: Request, context: { params: Promise<{ term: string; classNumber: string }> }) {
  return extensionHttp.preview(request, await context.params);
}

export const GET = withRateLimit("extensionPreview", preview);
export const OPTIONS = extensionHttp.options;
