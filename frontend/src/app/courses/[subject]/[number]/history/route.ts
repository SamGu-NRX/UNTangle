import { getCourseGradeDetail } from "@/lib/backend-api";
import { historyFromBackendDetail } from "@/lib/course-history-backend";

export const dynamic = "force-dynamic";

/** `HistoryResult<CourseHistory>` from today's backend; always 200 so the panel can show the state. */
export async function GET(_request: Request, { params }: { params: Promise<{ subject: string; number: string }> }) {
  const { subject, number } = await params;
  const detail = await getCourseGradeDetail(subject.toUpperCase(), number.toUpperCase());
  return Response.json(historyFromBackendDetail(detail), { headers: { "cache-control": "no-store" } });
}
