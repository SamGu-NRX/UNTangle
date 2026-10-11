import { Suspense } from "react";
import type { Metadata } from "next";
import { CoursesClient } from "@/components/courses-client";

export const metadata: Metadata = {
  title: "Courses — UNTangle",
  description:
    "Browse the UNT catalog with deep filters: level, credits, schedule, historical GPA, and sample ratings.",
};

// CoursesClient reads the URL on mount (useSearchParams), so it renders under
// a Suspense boundary; the fallback is null because the shell paints instantly.
export default function CoursesPage() {
  return (
    <Suspense fallback={null}>
      <CoursesClient />
    </Suspense>
  );
}
