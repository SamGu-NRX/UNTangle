import { withRateLimit } from "@/lib/rate-limit/server";
import { gradesHistory } from "@/lib/grades-history";
import { createGradesHandlers } from "@/lib/grades-history/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handlers = createGradesHandlers(gradesHistory);
async function getGrades(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handlers.instructor(id);
}

export const GET = withRateLimit("grades", getGrades);
