import { sectionSource } from "@/lib/sections/server";
import { createSectionsHandlers } from "@/lib/sections/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = createSectionsHandlers(sectionSource);
export async function GET(_request: Request, context: { params: Promise<{ term: string; subject: string; number: string }> }) {
  const { term, subject, number } = await context.params;
  return handlers.course(term, subject, number);
}
