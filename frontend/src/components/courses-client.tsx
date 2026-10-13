"use client";

import { CoursesView } from "@/components/courses/CoursesView";

/** The Courses view in the app shell's content frame (the shell itself lives in the root layout). */
export function CoursesClient({
  initialCourseId = null,
  initialInstructor = null,
}: {
  initialCourseId?: string | null;
  initialInstructor?: string | null;
}) {
  return (
    <div className="shell-content">
      <CoursesView initialCourseId={initialCourseId} initialInstructor={initialInstructor} />
    </div>
  );
}
