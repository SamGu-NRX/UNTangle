"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { NavShell } from "@/components/nav-shell";
import { CourseImportPanel } from "@/components/course-import-panel";
import { MajorSelectionModal } from "@/components/major-selection-modal";
import { Toggle } from "@/components/ui/Toggle";
import { SearchBar } from "@/components/ui/SearchBar";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatusMark } from "@/components/ui/StatusMark";
import { StaggerGroup } from "@/components/ui/StaggerGroup";
import { usePlanner, useToast } from "@/components/planner-provider";
import { courses } from "@/lib/seed-data";
import {
  getCoreCoursesForMajor,
  getMajorById,
  getMissingPrerequisites,
  summarizeMajorProgress,
} from "@/lib/planner";
import type { Course, CourseStatus } from "@/lib/types";

const departments = Array.from(new Set(courses.map((c) => c.department))).sort();

function statusToTone(s: CourseStatus): "completed" | "in-progress" | "neutral" {
  if (s === "completed") return "completed";
  if (s === "inProgress") return "in-progress";
  return "neutral";
}
function statusLabel(s: CourseStatus) {
  if (s === "completed") return "Done";
  if (s === "inProgress") return "Taking";
  return "Not taken";
}

export function CoursesClient() {
  const { hydrated, plannerState, setCourseStatus, setSelectedMajor, isLocked } = usePlanner();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("All");
  const deferredQuery = useDeferredValue(query);

  const [majorOpen, setMajorOpen] = useState(false);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const firstLoadRef = useRef(true);

  useEffect(() => {
    if (!hydrated || !firstLoadRef.current) {
      return;
    }

    firstLoadRef.current = false;
    if (plannerState.selectedMajor === null) {
      setMajorOpen(true);
    }
  }, [hydrated, plannerState.selectedMajor]);

  const major = getMajorById(plannerState.selectedMajor);
  const coreCourses = useMemo(
    () => getCoreCoursesForMajor(plannerState.selectedMajor),
    [plannerState.selectedMajor],
  );
  const coreCodes = useMemo(() => new Set(coreCourses.map((c) => c.code)), [coreCourses]);
  const progress = summarizeMajorProgress(plannerState);

  const filtered = useMemo(() => {
    const q = deferredQuery.toLowerCase().trim();
    return courses.filter((course) => {
      if (department !== "All" && course.department !== department) return false;
      if (!q) return true;
      return `${course.code} ${course.title} ${course.department}`.toLowerCase().includes(q);
    });
  }, [deferredQuery, department]);

  const grouped = useMemo(() => {
    const coreList = filtered.filter((c) => coreCodes.has(c.code));
    const others = filtered.filter((c) => !coreCodes.has(c.code));
    const byDept = others.reduce<Record<string, Course[]>>((acc, c) => {
      (acc[c.department] ??= []).push(c);
      return acc;
    }, {});
    return { coreList, byDept };
  }, [filtered, coreCodes]);

  function openMajorModal(e: React.MouseEvent<HTMLButtonElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    setOrigin({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    setMajorOpen(true);
  }

  return (
    <NavShell
      step={0}
      next={{ href: "/schedule", label: "Optimize schedule" }}
    >
      <div style={{ display: "grid", gap: 18 }}>
        <header>
          <p className="editorial-label">Step 1 — Previous courses</p>
          <h1
            className="font-display"
            style={{
              marginTop: 4,
              fontSize: "clamp(1.8rem, 3.5vw, 2.6rem)",
              fontWeight: 800,
              color: "var(--brand-900)",
              letterSpacing: "-0.03em",
              lineHeight: 1.05,
            }}
          >
            Mark the courses you have already handled.
          </h1>
          <p style={{ marginTop: 6, fontSize: "0.92rem", color: "var(--copy)", maxWidth: 720 }}>
            Search, set each one to Done, Taking, or Not taken. Locked courses unlock as you complete prerequisites.
          </p>
        </header>

        {major ? (
          <div
            className="surface-card"
            style={{
              padding: "0.95rem 1.1rem",
              display: "flex",
              alignItems: "center",
              gap: 14,
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: "1 1 220px", minWidth: 0 }}>
              <p className="editorial-label">Major</p>
              <p style={{ marginTop: 2, fontWeight: 700, color: "var(--ink)" }}>
                {major.name}
                <span style={{ marginLeft: 8, color: "var(--copy)", fontWeight: 500 }}>
                  · {major.department}
                </span>
              </p>
            </div>
            <div style={{ flex: "1 1 280px", minWidth: 0 }}>
              <ProgressBar
                pct={progress.pct}
                label={`${progress.completed} of ${progress.total} core complete`}
              />
            </div>
            <button type="button" className="btn-ghost" onClick={openMajorModal}>
              Change
            </button>
          </div>
        ) : (
          <div
            className="surface-card"
            style={{
              padding: "1rem 1.15rem",
              display: "flex",
              gap: 14,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <p style={{ flex: 1, color: "var(--copy)", fontSize: "0.9rem" }}>
              Pick your major to see your core courses and unlock relevant prerequisites.
            </p>
            <Button onClick={openMajorModal}>Choose major</Button>
          </div>
        )}

        <CourseImportPanel
          courseStatuses={plannerState.courseStatuses}
          setCourseStatus={setCourseStatus}
          toast={toast}
        />

        <div className="surface-card" style={{ padding: "0.85rem 1rem" }}>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)" }}>
            <SearchBar
              placeholder="Search courses, departments, codes…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search courses"
            />
            <Select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              aria-label="Filter by department"
            >
              <option value="All">All departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {grouped.coreList.length > 0 ? (
          <section>
            <p className="editorial-label" style={{ marginBottom: 8 }}>
              {major?.name} core courses
            </p>
            <div style={{ display: "grid", gap: 8 }}>
              <StaggerGroup>
                {grouped.coreList.map((course) =>
                  renderRow(course, plannerState.courseStatuses, isLocked, setCourseStatus, toast),
                )}
              </StaggerGroup>
            </div>
          </section>
        ) : null}

        {Object.entries(grouped.byDept).map(([dept, list]) => (
          <section key={dept}>
            <p className="editorial-label" style={{ marginBottom: 8 }}>
              {dept}
            </p>
            <div style={{ display: "grid", gap: 8 }}>
              <StaggerGroup>
                {list.map((course) =>
                  renderRow(course, plannerState.courseStatuses, isLocked, setCourseStatus, toast),
                )}
              </StaggerGroup>
            </div>
          </section>
        ))}

        {filtered.length === 0 ? (
          <div className="surface-card" style={{ padding: "1.5rem", textAlign: "center", color: "var(--copy)" }}>
            No courses match that search.
          </div>
        ) : null}
      </div>

      <MajorSelectionModal
        open={majorOpen}
        current={plannerState.selectedMajor}
        origin={origin}
        closable={plannerState.selectedMajor !== null}
        onClose={() => setMajorOpen(false)}
        onConfirm={(id) => {
          setSelectedMajor(id);
          setMajorOpen(false);
          toast(`Major set: ${getMajorById(id)?.name}`);
        }}
      />
    </NavShell>
  );
}

function renderRow(
  course: Course,
  courseStatuses: Record<string, CourseStatus>,
  isLocked: (code: string) => boolean,
  setCourseStatus: (code: string, status: CourseStatus) => void,
  toast: (msg: string) => void,
) {
  const status = courseStatuses[course.code] ?? "notTaken";
  const locked = isLocked(course.code);
  const completed = status === "completed";
  const missing = getMissingPrerequisites(course.code, courseStatuses);

  return (
    <article
      key={course.code}
      className="course-row"
      data-locked={locked && !completed ? "true" : "false"}
      data-completed={completed ? "true" : "false"}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="course-row__title">{course.title}</span>
          <StatusMark label={statusLabel(status)} tone={statusToTone(status)} />
        </div>
        <div className="course-row__meta">
          {course.code} · {course.creditHours} cr
        </div>
        {locked && !completed ? (
          <div className="course-row__lock">
            🔒 Requires: {missing.join(", ")}
          </div>
        ) : null}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", gap: 4 }}>
          {(["notTaken", "inProgress", "completed"] as const).map((value) => {
            const active = status === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setCourseStatus(course.code, value);
                  if (value === "completed") toast(`${course.code} marked done`);
                }}
                disabled={locked && !completed && value !== "notTaken"}
                style={{
                  padding: "0.32rem 0.6rem",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  borderRadius: 999,
                  border: `1px solid ${active ? "var(--brand-700)" : "var(--line)"}`,
                  background: active ? "var(--brand-900)" : "var(--surface)",
                  color: active ? "#fff" : "var(--copy)",
                  cursor: "pointer",
                  transition:
                    "background-color var(--d-hover) var(--ease), color var(--d-hover) var(--ease), border-color var(--d-hover) var(--ease)",
                }}
              >
                {value === "notTaken" ? "Not taken" : value === "inProgress" ? "Taking" : "Done"}
              </button>
            );
          })}
        </div>
        <Toggle
          on={completed}
          ariaLabel={`Mark ${course.code} as done`}
          disabled={locked && !completed}
          onChange={(next) => {
            const newStatus = next ? "completed" : "notTaken";
            setCourseStatus(course.code, newStatus);
            if (next) toast(`${course.code} marked done`);
          }}
        />
      </div>
    </article>
  );
}
