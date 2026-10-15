import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";
import { authGetHandler } from "@/lib/auth-get";
import { withRateLimit } from "@/lib/rate-limit/server";

export const runtime = "nodejs";

const handlers = toNextJsHandler(auth);
export const GET = authGetHandler(handlers.GET, withRateLimit);
// better-auth's own limiter reads before and counts after each request, so a burst can slip past it.
export const POST = withRateLimit("auth", handlers.POST);
