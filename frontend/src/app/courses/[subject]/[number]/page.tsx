import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CoursesClient } from "@/components/courses-client";
import { courseIdFromRoute } from "@/lib/course-route";

type Params = Promise<{ subject: string; number: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { subject, number } = await params;
  const id = courseIdFromRoute(subject, number);
  return { title: id ?? "Course not found" };
}

/**
 * Deep link: the Courses view with the detail panel open on one course. It
 * renders from the bundled catalog only, so a down grade backend never turns
 * it into a 404; the panel shows the grade history's own state. A code that
 * is malformed or not in the catalog is a 404.
 */
export default async function CourseDeepLinkPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { subject, number } = await params;
  const id = courseIdFromRoute(subject, number);
  if (!id) notFound();
  const { instructor } = await searchParams;
  return <CoursesClient initialCourseId={id} initialInstructor={typeof instructor === "string" ? instructor : null} />;
}
