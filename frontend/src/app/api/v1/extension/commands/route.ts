import { withRateLimit } from "@/lib/rate-limit/server";
import { extensionHttp } from "@/server/extension/routes";

export const runtime = "nodejs";

export const POST = withRateLimit("extensionCommand", (request: Request) => extensionHttp.commands(request));
export const OPTIONS = extensionHttp.options;
