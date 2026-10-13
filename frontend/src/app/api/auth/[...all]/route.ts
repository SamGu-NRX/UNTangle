import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limit/server";

export const runtime = "nodejs";

const handlers = toNextJsHandler(auth);
// Magic-link verification is GET and needs the same atomic guard as POST.
export const GET = withRateLimit("auth", handlers.GET);
// better-auth's own limiter reads before and counts after each request, so a burst can slip past it.
export const POST = withRateLimit("auth", handlers.POST);
