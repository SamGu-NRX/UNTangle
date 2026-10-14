import { withRateLimit } from "@/lib/rate-limit/server";
import { sectionsProxy } from "@/lib/sections/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ term: string; number: string }> };

async function getClassNumber(_request: Request, { params }: Context) {
  const { term, number } = await params;
  return sectionsProxy.respondClassNumber(term, number);
}

// Same budget as the per-course route: both read the same cached vsb files.
export const GET = withRateLimit("sections", getClassNumber);
