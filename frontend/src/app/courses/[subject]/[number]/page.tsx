import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CoursesClient } from "@/components/courses-client";
import { courses } from "@/lib/seed-data";

type Params = Promise<{ subject: string; number: string }>;

function courseIdFrom(subject: string, number: string) {
  return `${decodeURIComponent(subject).trim().toUpperCase()} ${decodeURIComponent(number).trim().toUpperCase()}`;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { subject, number } = await params;
  const id = courseIdFrom(subject, number);
  const course = courses.find((entry) => entry.code === id);
  return { title: course ? `${id} · UNTangle` : "Course not found · UNTangle" };
}

/**
 * Deep link: the Courses view with the detail panel open on one course. It
 * renders from the bundled catalog only, so a down grade backend never turns
 * it into a 404; the panel shows the grade history's own state. Only a code
 * that is not in the catalog is a 404.
 */
export default async function CourseDeepLinkPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { subject, number } = await params;
  const id = courseIdFrom(subject, number);
  if (!courses.some((entry) => entry.code === id)) notFound();
  const { instructor } = await searchParams;
  return <CoursesClient initialCourseId={id} initialInstructor={typeof instructor === "string" ? instructor : null} />;
}
