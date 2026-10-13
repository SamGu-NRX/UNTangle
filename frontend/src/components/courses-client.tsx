"use client";

import { NavShell } from "@/components/nav-shell";
import { CoursesView } from "@/components/courses/CoursesView";

/**
 * The Courses view inside today's NavShell. The v2 AppShell replaces NavShell
 * at integration; CoursesView does not depend on which shell wraps it.
 */
export function CoursesClient({
  initialCourseId = null,
  initialInstructor = null,
}: {
  initialCourseId?: string | null;
  initialInstructor?: string | null;
}) {
  return (
    <NavShell step={0}>
      <CoursesView initialCourseId={initialCourseId} initialInstructor={initialInstructor} />
    </NavShell>
  );
}
