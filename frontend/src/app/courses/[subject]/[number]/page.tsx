import Link from "next/link";
import { notFound } from "next/navigation";
import { CoursePlanActions } from "@/components/course-plan-actions";
import { GradeChart } from "@/components/grade-chart";
import { GpaBadge } from "@/components/gpa-badge";
import { NavShell } from "@/components/nav-shell";
import { getCourseGradeDetail } from "@/lib/backend-api";
import { buildCourseDetailModel } from "@/lib/course-detail";
import { resolveCourseLocator } from "@/lib/course-catalog";
import { formatGpa } from "@/lib/grades";

export const dynamic = "force-dynamic";

const unavailableNoticeStyle = {
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "0.9rem 1rem",
  color: "var(--muted)",
  background: "var(--bg)",
} as const;

export default async function CourseDetailsPage({
  params,
}: {
  params: Promise<{ number: string; subject: string }>;
}) {
  const { subject, number } = await params;
  const locator = resolveCourseLocator(subject, number);

  // Unknown or removed course codes never render a fabricated course.
  if (locator.kind === "unknown-code") {
    notFound();
  }

  const course = locator.course;
  const gradeDetail = await getCourseGradeDetail(subject.toUpperCase(), number.toUpperCase());
  const model = buildCourseDetailModel({ catalogCourse: course, gradeDetail });
  const { catalog, grades, ratings } = model;

  return (
    <NavShell
      step={0}
      back={{ href: "/courses", label: "Courses" }}
      next={{ href: "/schedule", label: "Optimize schedule" }}
      stickyFooter={false}
    >
      <div className="detail-shell">
        <header className="detail-header">
          <div className="detail-title">
            <h1 className="font-display">{catalog.code}</h1>
            <p>{catalog.title}</p>
            <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: "0.35rem 0 0" }}>
              {catalog.department} · {catalog.creditHours} credit hour{catalog.creditHours === 1 ? "" : "s"}
              {course.planned ? " · Planned in the upcoming catalog" : ""}
            </p>
          </div>
          {grades.availability === "available" ? (
            <div className="detail-stats" aria-label="Course grade summary">
              <GpaBadge gpa={grades.gpa} label="Average GPA" />
              <div className="detail-stat">
                <span>grade sections</span>
                <strong>{grades.sectionCount.toLocaleString()}</strong>
              </div>
              <div className="detail-stat">
                <span>students</span>
                <strong>{grades.totalEnroll?.toLocaleString() ?? "—"}</strong>
              </div>
            </div>
          ) : (
            <div className="detail-stats" aria-label="Grade data unavailable">
              <div className="detail-stat">
                <span>grade data</span>
                <strong>unavailable</strong>
              </div>
            </div>
          )}
        </header>

        <section className="detail-section" aria-label="Catalog details">
          <div className="detail-section__head">
            <h2>Catalog details</h2>
            <p>Bundled UNTangle catalog</p>
          </div>
          <p style={{ margin: "0 0 0.75rem", whiteSpace: "pre-line" }}>{catalog.description}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", alignItems: "center" }}>
            <span style={{ color: "var(--muted)", fontSize: "0.9rem" }}>Prerequisites:</span>
            {catalog.prerequisites.length === 0 && (
              <span style={{ color: "var(--muted)", fontSize: "0.9rem" }}>None listed</span>
            )}
            {catalog.prerequisites.map((prerequisite) =>
              prerequisite.resolved ? (
                <Link
                  key={prerequisite.code}
                  href={`/courses/${prerequisite.code.split(/\s+/).join("/")}`}
                  className="chip"
                  style={{ textDecoration: "none" }}
                >
                  {prerequisite.code}
                </Link>
              ) : (
                <span
                  key={prerequisite.code}
                  className="chip"
                  title="Listed as a prerequisite, but not in the UNTangle catalog"
                  style={{ color: "var(--muted)", border: "1px dashed var(--line)" }}
                >
                  {prerequisite.code} (not in catalog)
                </span>
              ),
            )}
          </div>
          <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0.75rem 0 0" }}>
            Prerequisite guidance is inferred from the bundled catalog, not an official degree audit.
          </p>
        </section>

        {grades.availability === "available" ? (
          <section className="detail-section" aria-label="Grade records">
            <div className="detail-section__head">
              <h2>Grade records</h2>
              <p>{grades.terms.length ? grades.terms.join(", ") : "No terms available"}</p>
            </div>
            <GradeChart data={gradeDetail!.aggregate.grades} height={300} />
          </section>
        ) : (
          <section className="detail-section" aria-label="Grade records unavailable">
            <div className="detail-section__head">
              <h2>Grade records</h2>
            </div>
            <div role="status" style={unavailableNoticeStyle}>
              <strong>Grade data is unavailable.</strong> The grade service did not respond, so
              distributions and term records cannot be shown. Catalog details above are unaffected.
            </div>
          </section>
        )}

        {ratings.availability === "available" ? (
          <section className="detail-grid detail-grid--two">
            <div className="detail-section" aria-label="Instructor outcomes">
              <div className="detail-section__head">
                <h2>Instructor outcomes</h2>
                <p>Grade service records</p>
              </div>
              <div className="detail-list">
                {ratings.instructors.map((instructor) => (
                  <Link key={instructor.id} href={`/instructors/${instructor.id}`} className="detail-row">
                    <span className="detail-row__main">
                      <strong>{instructor.name}</strong>
                      <span>
                        {instructor.sectionCount} sections · {instructor.totalEnroll.toLocaleString()} students
                      </span>
                    </span>
                    <span className="detail-row-metrics">
                      {instructor.rmpRating
                        ? `${instructor.rmpRating.toFixed(1)} RMP (external)`
                        : "No external rating"}
                      <b>{formatGpa(instructor.gpa)}</b>
                    </span>
                  </Link>
                ))}
              </div>
              <p style={{ color: "var(--muted)", fontSize: "0.85rem", margin: "0.75rem 0 0" }}>
                RMP ratings are external RateMyProfessors data fetched through the grade service —
                not part of the UNTangle catalog.
              </p>
            </div>

            <div className="detail-section" aria-label="Recent grade records">
              <div className="detail-section__head">
                <h2>Recent records</h2>
                <p>Grade service records</p>
              </div>
              <div className="detail-list">
                {gradeDetail!.sections.slice(0, 12).map((section) => (
                  <Link key={section.id} href={`/instructors/${section.instructor.id}`} className="detail-row">
                    <span className="detail-row__main">
                      <strong>
                        {section.term} · Section {section.sectionNumber}
                      </strong>
                      <span>{section.instructor.name}</span>
                    </span>
                    <span className="detail-row-metrics">
                      {section.grades.totalEnroll.toLocaleString()} students
                      <b>{formatGpa(section.gpa)}</b>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        ) : (
          <section className="detail-section" aria-label="Instructor ratings unavailable">
            <div className="detail-section__head">
              <h2>Instructor outcomes</h2>
            </div>
            <div role="status" style={unavailableNoticeStyle}>
              <strong>Instructor ratings are unavailable.</strong> External instructor ratings come
              from the grade service, which did not respond. Nothing is inferred in their place.
            </div>
          </section>
        )}

        <CoursePlanActions courseCode={catalog.code} />
      </div>
    </NavShell>
  );
}
