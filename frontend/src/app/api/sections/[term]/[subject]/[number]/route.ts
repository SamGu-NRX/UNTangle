import { sectionsProxy } from "@/lib/sections/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ term: string; subject: string; number: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { term, subject, number } = await params;
  return sectionsProxy.respond(term, subject, number);
}
