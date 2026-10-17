import { gradesHistory } from "@/lib/grades-history";
import { withRateLimit } from "@/lib/rate-limit/server";
import { applySectionFilters, parseSectionFilterParams } from "@/lib/sections/apply-filters";
import { coursePattern, termPattern } from "@/lib/sections/config";
import { sectionsProxy } from "@/lib/sections/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ term: string; subject: string; number: string }> };

/** GET /api/sections/[term]/[subject]/[number]?filters=…&minInstructorGpa=… */
async function getSections(request: Request, { params }: Context) {
  const { term, subject, number } = await params;
  const noStore = { "Cache-Control": "no-store" };
  const parsed = parseSectionFilterParams(new URL(request.url).searchParams);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400, headers: noStore });
  const courseCode = `${subject.toUpperCase()} ${number.toUpperCase()}`;
  if (!termPattern.test(term) || !coursePattern.test(courseCode)) {
    return Response.json(
      { error: "Expected a term like spring-2027, a 3-4 letter subject and a number like 1680" },
      { status: 400, headers: noStore },
    );
  }
  if (parsed.filters.length === 0 && parsed.minInstructorGpaHundredths === null) {
    return sectionsProxy.respond(term, subject, number);
  }
  const course = await sectionsProxy.getCourseSections(term, courseCode);
  let history: Awaited<ReturnType<typeof gradesHistory.getCourseHistory>> | null = null;
  if (parsed.minInstructorGpaHundredths !== null && (course.status === "ok" || course.status === "stale")) {
    // Read the instructor evidence only for courses whose sections were
    // actually served; a term the proxy could not read has no options to grade.
    const [courseSubject, courseNumber] = courseCode.split(" ");
    history = await gradesHistory.getCourseHistory(courseSubject, courseNumber);
  }
  const { course: filtered, summary } = applySectionFilters(course, parsed.filters, parsed.minInstructorGpaHundredths, history);
  return Response.json({ ...filtered, filterSummary: summary }, { headers: noStore });
}

export const GET = withRateLimit("sections", getSections);
