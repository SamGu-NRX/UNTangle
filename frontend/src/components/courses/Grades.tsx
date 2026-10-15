"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Chip, ChipGroup } from "@/components/ui/Chip";
import { ExternalGlyph } from "@/components/ui/icons";
import { ProvenanceTag } from "@/components/ui/ProvenanceTag";
import type { CourseGradeView, GradeSlice, InstructorSlice } from "@/lib/course-history";
import styles from "./courses.module.css";
import { gradeBars, instructorKey } from "./model/grades";
import type { SchoolProfile } from "./school";

const historyCache = new Map<string, CourseGradeView>();

/** The course's grade history, cached per course for the visit; `retry` asks again after a failure. */
export function useGradeHistory(profile: SchoolProfile, id: string) {
  const [loaded, setLoaded] = useState<{ id: string; attempt: number; view: CourseGradeView } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const cached = attempt === 0 ? historyCache.get(id) : undefined;
  useEffect(() => {
    if (cached) return;
    const controller = new AbortController();
    const [subject, number] = profile.splitId(id);
    profile.gradeHistory
      .loadCourse(subject, number, controller.signal)
      .then((view) => {
        if (view.status !== "unavailable") historyCache.set(id, view);
        setLoaded({ id, attempt, view });
      })
      .catch(() => {
        // Aborted because the detail moved to another course.
      });
    return () => controller.abort();
  }, [profile, id, attempt, cached]);
  const fresh = loaded && loaded.id === id && loaded.attempt === attempt ? loaded.view : null;
  return { view: cached ?? fresh, retry: () => setAttempt((value) => value + 1) };
}

/** Each instructor's slice by name key, for the section rows' GPA. */
export function slicesByInstructor(view: CourseGradeView | null): Map<string, InstructorSlice> {
  const slices = new Map<string, InstructorSlice>();
  if (view?.status !== "ok") return slices;
  for (const slice of view.instructors) {
    const key = instructorKey(slice.instructor.name, slice.instructor.firstName, slice.instructor.lastName);
    if (!slices.has(key)) slices.set(key, slice);
  }
  return slices;
}

type Props = {
  courseId: string;
  view: CourseGradeView | null;
  retry: () => void;
  /** Names on this term's sections, offered as chips even without records. */
  sectionInstructors: readonly string[];
  initialInstructor: string | null;
  linkOuts: SchoolProfile["linkOuts"];
};

const ALL = "all";

export function Grades({ courseId, view, retry, sectionInstructors, initialInstructor, linkOuts }: Props) {
  const [picked, setPicked] = useState(initialInstructor ? instructorKey(initialInstructor) : ALL);
  // A keyboard pick redraws the bars at once (MOTION.md §1: keyboard actions never animate).
  const [instant, setInstant] = useState(false);
  const slices = useMemo(() => slicesByInstructor(view), [view]);
  const chips = useMemo(() => {
    const names = new Map<string, string>();
    for (const [key, slice] of slices) names.set(key, slice.instructor.name);
    for (const name of sectionInstructors) if (!names.has(instructorKey(name))) names.set(instructorKey(name), name);
    return [...names];
  }, [slices, sectionInstructors]);

  if (!view) {
    return (
      <div aria-busy="true" aria-label="Loading grade history">
        <div className={styles.shimmer} />
        <div className={styles.shimmer} />
      </div>
    );
  }
  if (view.status === "unavailable") {
    return (
      <div className={styles.stateLine} role="status">
        <p>Couldn&apos;t load grade history from {view.source}.</p>
        <Button variant="secondary" size="sm" onClick={retry}>
          Retry
        </Button>
      </div>
    );
  }
  if (view.status === "no-history") {
    return <p className={styles.meta}>No grade records for {courseId} yet.</p>;
  }

  const pickedName = chips.find(([key]) => key === picked)?.[1] ?? null;
  const pickedSlice = picked === ALL ? null : (slices.get(picked) ?? null);
  const slice: GradeSlice = pickedSlice ?? view.overall;
  const links = pickedName ? linkOuts({ name: pickedName }, courseId) : [];
  const years = view.terms.length ? [view.terms[0], view.terms.at(-1)!].map((term) => term.match(/\d{4}/)?.[0] ?? term) : [];
  const span = years.length === 0 ? "" : years[0] === years[1] ? ` ${years[0]}` : ` ${years[0]}–${years[1]}`;

  return (
    <>
      {chips.length > 0 ? (
        <ChipGroup label="Instructor" className={styles.instructorChips}>
          {[[ALL, "All instructors"] as const, ...chips].map(([key, name]) => (
            <Chip
              key={key}
              size="sm"
              selected={picked === key}
              onClick={(event) => {
                setInstant(event.detail === 0);
                setPicked(key);
              }}
            >
              {name}
            </Chip>
          ))}
        </ChipGroup>
      ) : null}
      {pickedName && !pickedSlice ? <p className={styles.fallback}>No grade records for {pickedName} yet. Showing all instructors.</p> : null}
      <div className={styles.figures}>
        <div>
          <b>{slice.gpa === null ? "None" : slice.gpa.toFixed(2)}</b>
          <span>Average GPA</span>
        </div>
        <div>
          <b>{slice.total.toLocaleString()}</b>
          <span>Students</span>
        </div>
      </div>
      <GradeBars slice={slice} instant={instant} label={`${courseId}, ${pickedSlice ? pickedName : "all instructors"}`} />
      <div className={styles.source}>
        <ProvenanceTag source={`Grade history from ${view.source}, ${view.terms[0] ?? ""} to ${view.terms.at(-1) ?? ""}.`}>
          {`UNT grade records${span}`}
        </ProvenanceTag>
        {view.sourceUrl ? (
          <a className={styles.extLink} href={view.sourceUrl} target="_blank" rel="noopener noreferrer" data-linkout="source">
            Data source
            <ExternalGlyph size={11} />
            <span className={styles.srOnly}> (opens in a new tab)</span>
          </a>
        ) : null}
        {links.length > 0 ? (
          links.map((link) => (
            <a key={link.key} className={styles.extLink} href={link.href} target="_blank" rel="noopener noreferrer" title={link.hint} data-linkout={link.key}>
              {link.label}
              <ExternalGlyph size={11} />
              <span className={styles.srOnly}> for {pickedName} (opens in a new tab)</span>
            </a>
          ))
        ) : (
          <span>Pick an instructor for RateMyProf and syllabi.</span>
        )}
      </div>
    </>
  );
}

/** Horizontal bars, one green, each with its share; a table for screen readers. */
function GradeBars({ slice, instant, label }: { slice: GradeSlice; instant: boolean; label: string }) {
  const { bars, otherCount } = gradeBars(slice.grades);
  return (
    <>
      <div className={styles.bars} data-instant={instant || undefined} aria-hidden="true">
        {bars.map((bar) => (
          <div key={bar.grade} className={styles.bar}>
            <b>{bar.grade}</b>
            <span className={styles.track}>
              <span className={styles.fill} data-grade-bar style={{ transform: `scaleX(${bar.width})` }} />
            </span>
            <span className={styles.pct}>{bar.percent}%</span>
          </div>
        ))}
      </div>
      <table className={styles.srOnly}>
        <caption>Grade distribution, {label}</caption>
        <tbody>
          {bars.map((bar) => (
            <tr key={bar.grade}>
              <th scope="row">{bar.grade}</th>
              <td>
                {bar.percent}% ({bar.count.toLocaleString()} students)
              </td>
            </tr>
          ))}
          {otherCount > 0 ? (
            <tr>
              <th scope="row">Other grades</th>
              <td>{otherCount.toLocaleString()} students</td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </>
  );
}
