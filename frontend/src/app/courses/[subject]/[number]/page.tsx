import Link from "next/link";
import { notFound } from "next/navigation";
import { GradeChart } from "@/components/grade-chart";
import { GpaBadge } from "@/components/gpa-badge";
import { NavShell } from "@/components/nav-shell";
import { getCourseGradeDetail } from "@/lib/backend-api";
import { formatGpa } from "@/lib/grades";

export const dynamic = "force-dynamic";

export default async function CourseDetailsPage({
  params,
}: {
  params: Promise<{ number: string; subject: string }>;
}) {
  const { subject, number } = await params;
  const detail = await getCourseGradeDetail(subject.toUpperCase(), number.toUpperCase());

  if (!detail) {
    notFound();
  }

  const { aggregate, course, instructors, sections, terms } = detail;

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
            <h1 className="font-display">
              {course.subject} {course.number}
            </h1>
            <p>{course.title}</p>
          </div>
          <div className="detail-stats" aria-label="Course grade summary">
            <GpaBadge gpa={aggregate.gpa} label="Average GPA" />
            <div className="detail-stat">
              <span>grade sections</span>
              <strong>{sections.length.toLocaleString()}</strong>
            </div>
            <div className="detail-stat">
              <span>students</span>
              <strong>{aggregate.grades.totalEnroll.toLocaleString()}</strong>
            </div>
          </div>
        </header>

        <section className="detail-section">
          <div className="detail-section__head">
            <h2>Grade distribution</h2>
            <p>{terms.length ? terms.join(", ") : "No terms available"}</p>
          </div>
          <GradeChart data={aggregate.grades} height={300} />
        </section>

        <section className="detail-grid detail-grid--two">
          <div className="detail-section">
            <div className="detail-section__head">
              <h2>Professor outcomes</h2>
            </div>
            <div className="detail-list">
              {instructors.map((instructor) => (
                <Link
                  key={instructor.id}
                  href={`/instructors/${instructor.id}`}
                  className="detail-row"
                >
                  <span className="detail-row__main">
                    <strong>{instructor.name}</strong>
                    <span>
                      {instructor.sectionCount} sections · {instructor.totalEnroll.toLocaleString()} students
                    </span>
                  </span>
                  <span className="detail-row-metrics">
                    {instructor.rmpRating ? `${instructor.rmpRating.toFixed(1)} RMP` : "No RMP"}
                    <b>{formatGpa(instructor.gpa)}</b>
                  </span>
                </Link>
              ))}
            </div>
          </div>

          <div className="detail-section">
            <div className="detail-section__head">
              <h2>Recent records</h2>
            </div>
            <div className="detail-list">
              {sections.slice(0, 12).map((section) => (
                <Link
                  key={section.id}
                  href={`/instructors/${section.instructor.id}`}
                  className="detail-row"
                >
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
      </div>
    </NavShell>
  );
}
