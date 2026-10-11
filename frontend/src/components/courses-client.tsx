"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { NavShell } from "@/components/nav-shell";
import { MajorSelectionModal } from "@/components/major-selection-modal";
import { Toggle } from "@/components/ui/Toggle";
import { SearchBar } from "@/components/ui/SearchBar";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatusMark } from "@/components/ui/StatusMark";
import { StaggerGroup } from "@/components/ui/StaggerGroup";
import { usePlanner, useToast } from "@/components/planner-provider";
import { courseDetailsHref } from "@/lib/course-catalog";
import { courses } from "@/lib/seed-data";
import { gpaFor, sampleRatingFor } from "@/lib/course-filters";
import {
  CREDIT_OPTIONS,
  DAY_LABELS,
  GPA_BANDS,
  LEVEL_LABELS,
  PLANNER_STATUS_LABELS,
  SAMPLE_RATING_BANDS,
  SORT_LABELS,
  TIME_WINDOW_LABELS,
  activeFilterCount,
  applyCourseFilters,
  computeFacetCounts,
  courseFiltersToParams,
  COURSE_FILTER_DEFAULTS,
  parseCourseFilters,
  type CourseFilterState,
  type CourseSort,
  type FacetCounts,
  type PlannerStatusFilter,
} from "@/lib/course-filters";
import {
  getCoreCoursesForMajor,
  getMajorById,
  getMissingPrerequisites,
  summarizeMajorProgress,
} from "@/lib/planner";
import type { Course, CourseStatus, TranscriptCourseRecord } from "@/lib/types";

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
  const searchParams = useSearchParams();

  // The URL is the initial source of truth for filters (shareable deep links
  // like /courses?level=3000&gpa=3.5); afterwards the state owns the URL via
  // history.replaceState, which keeps the view live without navigation.
  const [filters, setFilters] = useState<CourseFilterState>(() =>
    parseCourseFilters(new URLSearchParams(searchParams.toString())),
  );
  const [query, setQuery] = useState(filters.query);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    setFilters((prev) => (prev.query === deferredQuery ? prev : { ...prev, query: deferredQuery }));
  }, [deferredQuery]);

  useEffect(() => {
    const params = courseFiltersToParams(filters);
    const search = params.toString();
    const current = new URLSearchParams(window.location.search);
    if (current.toString() !== search) {
      const url = search ? `${window.location.pathname}?${search}` : window.location.pathname;
      window.history.replaceState(window.history.state, "", url);
    }
  }, [filters]);

  const [majorOpen, setMajorOpen] = useState(false);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const firstLoadRef = useRef(true);

  const plannerContext = useMemo(
    () => ({ courseStatuses: plannerState.courseStatuses, isLocked }),
    [plannerState.courseStatuses, isLocked],
  );

  const filtered = useMemo(
    () => applyCourseFilters(courses, filters, plannerContext),
    [filters, plannerContext],
  );

  const facetCounts: FacetCounts = useMemo(
    () => computeFacetCounts(courses, filters, plannerContext),
    [filters, plannerContext],
  );

  const activeCount = activeFilterCount(filters);

  function updateFilter(patch: Partial<CourseFilterState>) {
    setFilters((prev) => ({ ...prev, ...patch }));
  }

  function toggleFacetValue(facet: FilterGroupFacet, value: string) {
    if (
      facet === "gpaBand" ||
      facet === "sampleRatingBand" ||
      facet === "plannerStatus"
    ) {
      return; // single-select facets toggle through updateFilter, not here
    }
    setFilters((prev) => {
      const values = prev[facet];
      const next = values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
      return { ...prev, [facet]: next };
    });
  }

  function clearAllFilters() {
    setFilters({ ...COURSE_FILTER_DEFAULTS });
    setQuery("");
  }

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

        <div className="courses-tools surface-card">
          <div className="courses-tools__filters">
            <SearchBar
              placeholder="Search courses, departments, codes…"
              value={query}
              onChange={(e) => updateFilter({ query: e.target.value })}
              aria-label="Search courses"
            />
            <Select
              value={filters.sort}
              onChange={(e) => updateFilter({ sort: e.target.value as CourseSort })}
              aria-label="Sort courses"
            >
              {Object.entries(SORT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div className="courses-facets" role="group" aria-label="Course filters">
            <FilterGroup
              label="Department"
              facet="departments"
              options={Object.fromEntries(departments.map((d) => [d, d]))}
              selected={filters.departments}
              counts={facetCounts.departments}
              onToggle={toggleFacetValue}
              clear={() => updateFilter({ departments: [] })}
            />
            <FilterGroup
              label="Level"
              facet="levels"
              options={LEVEL_LABELS}
              selected={filters.levels}
              counts={facetCounts.levels}
              onToggle={toggleFacetValue}
              clear={() => updateFilter({ levels: [] })}
            />
            <FilterGroup
              label="Credits"
              facet="credits"
              options={CREDIT_OPTIONS}
              selected={filters.credits}
              counts={facetCounts.credits}
              onToggle={toggleFacetValue}
              clear={() => updateFilter({ credits: [] })}
            />
            <FilterGroup
              label="Meets on (sample sections)"
              facet="days"
              options={DAY_LABELS}
              selected={filters.days}
              counts={facetCounts.days}
              onToggle={toggleFacetValue}
              clear={() => updateFilter({ days: [] })}
            />
            <FilterGroup
              label="Starts (sample sections)"
              facet="timeWindows"
              options={TIME_WINDOW_LABELS}
              selected={filters.timeWindows}
              counts={facetCounts.timeWindows}
              onToggle={toggleFacetValue}
              clear={() => updateFilter({ timeWindows: [] })}
            />
            <FilterGroup
              label="Historical GPA (2017–19)"
              facet="gpaBand"
              options={GPA_BANDS}
              selected={filters.gpaBand ? [filters.gpaBand] : []}
              counts={facetCounts.gpaBand}
              onToggle={(facet, value) => {
                if (facet !== "gpaBand") return;
                updateFilter({
                  gpaBand: filters.gpaBand === value ? null : (value as CourseFilterState["gpaBand"]),
                });
              }}
              clear={() => updateFilter({ gpaBand: null })}
            />
            <FilterGroup
              label="Sample rating (bundled sections)"
              facet="sampleRatingBand"
              options={SAMPLE_RATING_BANDS}
              selected={filters.sampleRatingBand ? [filters.sampleRatingBand] : []}
              counts={facetCounts.sampleRatingBand}
              onToggle={(facet, value) => {
                if (facet !== "sampleRatingBand") return;
                updateFilter({
                  sampleRatingBand:
                    filters.sampleRatingBand === value
                      ? null
                      : (value as CourseFilterState["sampleRatingBand"]),
                });
              }}
              clear={() => updateFilter({ sampleRatingBand: null })}
            />
            <FilterGroup
              label="Planner status"
              facet="plannerStatus"
              options={PLANNER_STATUS_LABELS}
              selected={filters.plannerStatus ? [filters.plannerStatus] : []}
              counts={facetCounts.plannerStatus}
              onToggle={(facet, value) => {
                if (facet !== "plannerStatus") return;
                updateFilter({
                  plannerStatus:
                    filters.plannerStatus === value ? null : (value as PlannerStatusFilter),
                });
              }}
              clear={() => updateFilter({ plannerStatus: null })}
            />
          </div>
          {activeCount > 0 && (
            <button type="button" className="btn-ghost courses-clear" onClick={clearAllFilters}>
              Clear all filters
            </button>
          )}
          <p className="courses-tools__count" role="status">
            {filtered.length} of {courses.length} courses · {activeCount} filter
            {activeCount === 1 ? "" : "s"} active · counts stay live as other filters narrow the
            list
          </p>
          <div className="courses-tools__import">
            <div>
              <strong>Use your myUNT transcript PDF</strong>
              <span>Import once, then review the courses UNTangle found.</span>
            </div>
            <Link href="/courses/import" className="btn-secondary">
              Import PDF
            </Link>
          </div>
        </div>

        <p
          role="status"
          aria-label="Sample data notice"
          style={{ margin: "0.25rem 0 0", fontSize: "0.8rem", color: "var(--copy)" }}
        >
          Bundled sections and their sample ratings come from the offline catalog — not a real
          term&apos;s offerings.
        </p>

        {grouped.coreList.length > 0 ? (
          <section>
            <p className="editorial-label" style={{ marginBottom: 8 }}>
              {major?.name} core courses
            </p>
            <div style={{ display: "grid", gap: 8 }}>
              <StaggerGroup>
                {grouped.coreList.map((course) =>
                  renderRow(
                    course,
                    plannerState.courseStatuses,
                    plannerState.transcriptRecords,
                    isLocked,
                    setCourseStatus,
                    toast,
                    hydrated,
                  ),
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
                  renderRow(
                    course,
                    plannerState.courseStatuses,
                    plannerState.transcriptRecords,
                    isLocked,
                    setCourseStatus,
                    toast,
                    hydrated,
                  ),
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

function FilterGroup({
  label,
  facet,
  options,
  selected,
  counts,
  onToggle,
  clear,
}: {
  label: string;
  facet: FilterGroupFacet;
  options: Record<string, string>;
  selected: string[];
  counts: Record<string, number>;
  onToggle: (facet: FilterGroupFacet, value: string) => void;
  clear: () => void;
}) {
  const anySelected = selected.length > 0;
  return (
    <fieldset className="course-facets__group">
      <legend>
        {label}
        {anySelected && (
          <button type="button" className="course-facets__clear" onClick={clear}>
            clear
          </button>
        )}
      </legend>
      <div className="course-facets__options">
        {Object.entries(options).map(([value, optionLabel]) => {
          const count = counts[value] ?? 0;
          const checked = selected.includes(value);
          return (
            <FacetCheck
              key={value}
              label={optionLabel}
              count={count}
              checked={checked}
              disabled={!checked && count === 0}
              onChange={() => onToggle(facet, value)}
            />
          );
        })}
      </div>
    </fieldset>
  );
}

type FilterGroupFacet =
  | "departments"
  | "levels"
  | "credits"
  | "days"
  | "timeWindows"
  | "gpaBand"
  | "sampleRatingBand"
  | "plannerStatus";

function FacetCheck({
  label,
  count,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  count: number;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  return (
    <label className="course-facets__option">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
      <span>{label}</span>
      <span className="course-facets__count">{count}</span>
    </label>
  );
}

function renderRow(
  course: Course,
  courseStatuses: Record<string, CourseStatus>,
  transcriptRecords: TranscriptCourseRecord[],
  isLocked: (code: string) => boolean,
  setCourseStatus: (code: string, status: CourseStatus) => void,
  toast: (msg: string) => void,
  hydrated: boolean,
) {
  const status = courseStatuses[course.code] ?? "notTaken";
  const locked = isLocked(course.code);
  const completed = status === "completed";
  const missing = getMissingPrerequisites(course.code, courseStatuses, transcriptRecords);

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
          {course.code} · {course.creditHours} cr ·{" "}
          {gpaFor(course.code) !== null
            ? `GPA ${gpaFor(course.code)?.toFixed(2)} (2017–19 grades)`
            : "no grade history"}
          {sampleRatingFor(course.code) !== null
            ? ` · sample rating ${sampleRatingFor(course.code)?.toFixed(1)}/5`
            : ""}
        </div>
        {locked && !completed ? (
          <div className="course-row__lock">
            🔒 Requires: {missing.join(", ")}
          </div>
        ) : null}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Link href={courseDetailsHref(course.code)} className="btn-ghost">
          Details
        </Link>
        <div style={{ display: "flex", gap: 4 }}>
          {(["notTaken", "inProgress", "completed"] as const).map((value) => {
            const active = status === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setCourseStatus(course.code, value);
                  if (value === "completed") toast(`${course.code} marked done`);
                }}
                disabled={!hydrated || (locked && !completed && value !== "notTaken")}
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
          disabled={!hydrated || (locked && !completed)}
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
