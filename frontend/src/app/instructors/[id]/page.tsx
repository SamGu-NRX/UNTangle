import Link from "next/link";
import { notFound } from "next/navigation";
import { GradeChart } from "@/components/grade-chart";
import { GpaBadge } from "@/components/gpa-badge";
import { NavShell } from "@/components/nav-shell";
import { getInstructorGradeDetail } from "@/lib/backend-api";
import { formatGpa } from "@/lib/grades";

export const dynamic = "force-dynamic";

const formatTakeAgain = (value: number | null) => {
  if (value === null || value < 0) return "N/A";
  return `${Math.round(value)}%`;
};

export default async function InstructorDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getInstructorGradeDetail(id);

  if (!detail) {
    notFound();
  }

  const { aggregate, courseGroups, instructor, sections, terms } = detail;

  return (
    <NavShell
      step={0}
      back={{ href: "/courses", label: "Courses" }}
      next={{ href: "/schedule", label: "Optimize schedule" }}
    >
      <div className="detail-shell">
        <header className="detail-header">
          <div className="detail-title">
            <h1 className="font-display">{instructor.name}</h1>
            <p>
              {courseGroups.length.toLocaleString()} courses taught across {terms.length} recorded terms.
            </p>
          </div>
          <div className="detail-stats" aria-label="Instructor grade summary">
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

        <section className="detail-grid detail-grid--sidebar">
          <div className="detail-section">
            <div className="detail-section__head">
              <h2>Grade distribution</h2>
              <p>{terms.length ? terms.join(", ") : "No terms available"}</p>
            </div>
            <GradeChart data={aggregate.grades} height={300} />
          </div>

          <aside className="detail-section rmp-panel">
            <div className="rmp-panel__head">
              <h2>RateMyProfessors</h2>
              {instructor.rmpProfileUrl ? (
                <a href={instructor.rmpProfileUrl} target="_blank" rel="noreferrer">
                  Profile
                </a>
              ) : null}
            </div>
            <div className="rmp-score" data-empty={instructor.rmpRating === null}>
              <strong>{instructor.rmpRating !== null ? instructor.rmpRating.toFixed(1) : "N/A"}</strong>
              {instructor.rmpRating !== null ? <span>/ 5</span> : null}
            </div>
            {instructor.rmpRating !== null ? (
              <>
                <div className="rmp-meta-grid">
                  <div>
                    <span>difficulty</span>
                    <strong>{instructor.rmpDifficulty !== null ? instructor.rmpDifficulty.toFixed(1) : "N/A"}</strong>
                  </div>
                  <div>
                    <span>take again</span>
                    <strong>{formatTakeAgain(instructor.rmpWouldTakeAgain)}</strong>
                  </div>
                  <div>
                    <span>ratings</span>
                    <strong>{instructor.rmpNumRatings?.toLocaleString() ?? "N/A"}</strong>
                  </div>
                </div>
                {instructor.rmpTags.length > 0 ? (
                  <div className="rmp-tags">
                    {instructor.rmpTags
                      .slice()
                      .sort((a, b) => b.tagCount - a.tagCount)
                      .slice(0, 4)
                      .map((tag) => (
                        <span key={tag.tagName}>{tag.tagName}</span>
                      ))}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="rmp-empty">No RateMyProfessors match yet.</p>
            )}
          </aside>
        </section>

        <section className="detail-section">
          <div className="detail-section__head">
            <h2>Distribution by course</h2>
          </div>
          <div className="course-group-list">
            {courseGroups.map((group) => (
              <article key={group.course.id} className="course-group">
                <div className="course-group__head">
                  <div>
                    <Link href={`/courses/${group.course.subject}/${group.course.number}`}>
                      <strong>
                        {group.course.subject} {group.course.number}
                      </strong>
                    </Link>
                    <span>{group.course.title}</span>
                  </div>
                  <div className="detail-row-metrics">
                    {group.sectionCount} sections
                    <b>{formatGpa(group.gpa)}</b>
                  </div>
                </div>
                <GradeChart data={group.grades} height={180} />
              </article>
            ))}
          </div>
        </section>
      </div>
    </NavShell>
  );
}
