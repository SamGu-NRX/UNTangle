import { withRateLimit } from "@/lib/rate-limit/server";
import { sectionsProxy } from "@/lib/sections/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ term: string; subject: string; number: string }> };

async function getSections(_request: Request, { params }: Context) {
  const { term, subject, number } = await params;
  return sectionsProxy.respond(term, subject, number);
}

export const GET = withRateLimit("sections", getSections);
