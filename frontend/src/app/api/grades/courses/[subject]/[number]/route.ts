import { gradesHistory } from "@/lib/grades-history";
import { createGradesHandlers } from "@/lib/grades-history/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = createGradesHandlers(gradesHistory);
export async function GET(_request: Request, context: { params: Promise<{ subject: string; number: string }> }) {
  const { subject, number } = await context.params;
  return handlers.course(subject, number);
}
