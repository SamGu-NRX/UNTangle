import Link from "next/link";
import { NavShell } from "@/components/nav-shell";

/**
 * Recovery UI for unknown or removed course codes under
 * `/courses/[subject]/[number]` — replaces Next's default 404 for this
 * segment so a broken deep link still offers a way back into the journey.
 */
export default function CourseNotFound() {
  return (
    <NavShell step={0} back={{ href: "/courses", label: "Courses" }} stickyFooter={false}>
      <div className="detail-shell">
        <section className="detail-section" aria-label="Course not found">
          <div className="detail-section__head">
            <h2>Course not found</h2>
          </div>
          <p style={{ margin: "0 0 0.75rem" }}>
            No course with that code exists in the UNTangle catalog. The course may have been
            removed, or the link may be mistyped — nothing was invented in its place.
          </p>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <Link href="/courses" className="btn-primary" style={{ textDecoration: "none" }}>
              Browse the catalog
            </Link>
            <Link href="/courses/import" className="btn-secondary" style={{ textDecoration: "none" }}>
              Import a transcript instead
            </Link>
          </div>
        </section>
      </div>
    </NavShell>
  );
}
