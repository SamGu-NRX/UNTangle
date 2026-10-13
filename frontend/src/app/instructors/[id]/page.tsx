import { redirect } from "next/navigation";
import { getInstructorGradeDetail } from "@/lib/backend-api";
import { courseIdFromRoute } from "@/lib/course-route";

export const dynamic = "force-dynamic";

/**
 * Instructor pages are replaced by the instructor picker and link-outs in the
 * course panel. Old links land on the instructor's most-taught course that
 * the catalog carries, with that instructor chosen, or on Courses when the
 * backend cannot say who it is or none of their courses is in the catalog.
 */
export default async function InstructorRedirectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getInstructorGradeDetail(id);
  const target = detail?.courseGroups
    .slice()
    .sort((a, b) => b.totalEnroll - a.totalEnroll)
    .map((group) => courseIdFromRoute(group.course.subject, group.course.number))
    .find((courseId): courseId is string => courseId !== null);
  if (!detail || !target) redirect("/courses");
  const [subject, number] = target.split(" ");
  const query = new URLSearchParams({ instructor: detail.instructor.name });
  redirect(`/courses/${subject}/${number}?${query.toString()}`);
}
