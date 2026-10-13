import { redirect } from "next/navigation";
import { getInstructorGradeDetail } from "@/lib/backend-api";

export const dynamic = "force-dynamic";

/**
 * Instructor pages are replaced by the instructor picker and link-outs in the
 * course panel. Old links land on the instructor's most-taught course with
 * that instructor chosen, or on Courses when the backend cannot say who it is.
 */
export default async function InstructorRedirectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getInstructorGradeDetail(id);
  const group = detail?.courseGroups.slice().sort((a, b) => b.totalEnroll - a.totalEnroll)[0];
  if (!detail || !group) redirect("/courses");
  const query = new URLSearchParams({ instructor: detail.instructor.name });
  redirect(
    `/courses/${encodeURIComponent(group.course.subject)}/${encodeURIComponent(group.course.number)}?${query.toString()}`,
  );
}
