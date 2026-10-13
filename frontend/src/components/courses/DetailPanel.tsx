"use client";

import { useEffect, useMemo, useState } from "react";
import { GradeChart } from "@/components/grade-chart";
import { Button, IconButton } from "@/components/ui/Button";
import { Radio } from "@/components/ui/Checkbox";
import { Close, ExternalGlyph, MoreGlyph } from "@/components/ui/icons";
import { Menu, type MenuItem } from "@/components/ui/Menu";
import { ProvenanceTag } from "@/components/ui/ProvenanceTag";
import { Select, type SelectOption } from "@/components/ui/Select";
import type { CourseGradeView, InstructorSlice } from "@/lib/course-history";
import type { CourseSection, ScheduleEvent } from "@/lib/types";
import styles from "./courses.module.css";
import { CourseLink, RuleText, StatusGlyph } from "./bits";
import { statusLabels, type CourseRowModel } from "./model/course-model";
import { onlyCheckable, ruleCourseIds, splitUnparsed } from "./model/rules";
import type { SchoolProfile } from "./school";

export type PanelActions = {
  plan: (id: string) => void;
  unplan: (id: string) => void;
  markCredit: (id: string) => void;
  clearCredit: (id: string) => void;
  chooseSection: (id: string, sectionId: string) => void;
  close: () => void;
};

type Props = {
  row: CourseRowModel;
  profile: SchoolProfile;
  inCore: boolean;
  selectedSectionId: string | undefined;
  scheduleEvents: readonly ScheduleEvent[];
  initialInstructor: string | null;
  actions: PanelActions;
  showClose: boolean;
};

/** "Pradhumna L. Shrestha" and "Shrestha, Pradhumna" both become "pradhumna shrestha". */
export function instructorKey(name: string, first?: string, last?: string): string {
  const clean = (value: string) => value.toLowerCase().replace(/[^a-z\s]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (first !== undefined && last !== undefined && (first || last)) {
    return `${clean(first)[0] ?? ""} ${clean(last).at(-1) ?? ""}`.trim();
  }
  const parts = name.includes(",") ? clean(name.split(",").reverse().join(" ")) : clean(name);
  return `${parts[0] ?? ""} ${parts.at(-1) ?? ""}`.trim();
}

const historyCache = new Map<string, CourseGradeView>();

function useGradeHistory(profile: SchoolProfile, id: string) {
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
        // Aborted because the panel moved to another course.
      });
    return () => controller.abort();
  }, [profile, id, attempt, cached]);
  const fresh = loaded && loaded.id === id && loaded.attempt === attempt ? loaded.view : null;
  return { view: cached ?? fresh, retry: () => setAttempt((value) => value + 1) };
}

function minutesOf(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function clock(time: string) {
  const total = minutesOf(time);
  const hours = Math.floor(total / 60);
  return `${hours % 12 === 0 ? 12 : hours % 12}:${String(total % 60).padStart(2, "0")}`;
}

function meetingLine(section: CourseSection) {
  if (section.meetings.length === 0) return "Time to be announced";
  const first = section.meetings[0];
  const days = [...new Set(section.meetings.map((meeting) => meeting.day))].join(" ");
  const suffix = minutesOf(first.end) >= 12 * 60 ? "PM" : "AM";
  return `${days} · ${clock(first.start)}–${clock(first.end)} ${suffix} · ${first.location}`;
}

function conflictWith(section: CourseSection, events: readonly ScheduleEvent[], self: string) {
  for (const meeting of section.meetings) {
    const clash = events.find(
      (event) =>
        event.courseCode !== self &&
        event.day === meeting.day &&
        minutesOf(event.start) < minutesOf(meeting.end) &&
        minutesOf(meeting.start) < minutesOf(event.end),
    );
    if (clash) return `${clash.day} conflicts with ${clash.courseCode}`;
  }
  return null;
}

const plural = (count: number, word: string) => `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;

type InstructorOption = SelectOption & { slice?: InstructorSlice };

export function DetailContent({
  row,
  profile,
  inCore,
  selectedSectionId,
  scheduleEvents,
  initialInstructor,
  actions,
  showClose,
}: Props) {
  const { view, retry } = useGradeHistory(profile, row.id);
  const sections = profile.sections(row.id);
  // The parent keys this component by course, so these reset when the subject changes.
  const [instructor, setInstructor] = useState<string>(initialInstructor ? instructorKey(initialInstructor) : "all");
  const [showAllSections, setShowAllSections] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const options = useMemo(() => {
    const graded = view?.status === "ok" ? view.instructors : [];
    const seen = new Map<string, InstructorOption>();
    for (const slice of graded) {
      const key = instructorKey(slice.instructor.name, slice.instructor.firstName, slice.instructor.lastName);
      if (!seen.has(key)) seen.set(key, { value: key, label: slice.instructor.name, meta: plural(slice.sectionCount, "section"), slice });
    }
    for (const section of sections) {
      const key = instructorKey(section.professor);
      if (!seen.has(key)) seen.set(key, { value: key, label: section.professor, meta: "No grade records" });
    }
    return [{ value: "all", label: "All instructors" }, ...seen.values()] as InstructorOption[];
  }, [view, sections]);

  const chosen = options.find((option) => option.value === instructor);
  const selectedSection = sections.find((section) => section.id === selectedSectionId) ?? sections[0];
  const linkName = instructor !== "all" && chosen ? chosen.label : selectedSection?.professor;
  const links = linkName ? profile.linkOuts({ name: linkName }, row.id) : [];

  const { readable, unparsed } = splitUnparsed(row.rule);
  const dependents = profile.dependents(row.id);
  const blocking = ruleCourseIds(onlyCheckable(row.unmet));
  const label = statusLabels[row.status];

  const statusItems: MenuItem[] = [];
  if (row.status !== "done") statusItems.push({ id: "credit", label: "I have credit for this", onSelect: () => actions.markCredit(row.id) });
  if (row.status === "done" && row.override) statusItems.push({ id: "uncredit", label: "Remove my credit mark", onSelect: () => actions.clearCredit(row.id) });
  if (row.status === "locked") statusItems.push({ id: "anyway", label: `Plan for ${profile.planningTerm} anyway`, onSelect: () => actions.plan(row.id) });

  let primary: React.ReactNode = null;
  // Separate keys: reusing one element would swap the text color before the background finishes its transition.
  if (row.status === "available" || row.status === "check") {
    primary = (
      <Button key="add" onClick={() => actions.plan(row.id)}>
        Add to {profile.planningTerm}
      </Button>
    );
  } else if (row.status === "planned") {
    primary = (
      <Button key="remove" variant="ghost" onClick={() => actions.unplan(row.id)}>
        Remove from plan
      </Button>
    );
  } else if (row.status === "locked") {
    primary = (
      <Button key="locked" disabled>
        {blocking.length > 0 ? `Locked · needs ${blocking.slice(0, 2).join(", ")}` : "Locked"}
      </Button>
    );
  }

  const sectionsShown = showAllSections ? sections : sections.slice(0, 3);
  const canPick = row.status === "available" || row.status === "check" || row.status === "planned";
  const longDescription = row.description.length > 220;

  return (
    <>
      <div className={styles.pHead}>
        <div className={styles.codeline}>
          <span className={styles.bigcode}>{row.id}</span>
          <span className={styles.pStatus}>
            <StatusGlyph status={row.status} />
            {label}
            {row.override ? " · set by you" : ""}
          </span>
          {statusItems.length > 0 ? (
            <Menu
              label={`Status options for ${row.id}`}
              items={statusItems}
              trigger={(props) => (
                <button {...props} type="button" className="ui-btn ui-btn--quiet ui-btn--icon ui-btn--sm" aria-label={`Status options for ${row.id}`} data-ui="">
                  <MoreGlyph />
                </button>
              )}
            />
          ) : null}
        </div>
        <h2 className={styles.pTitle} id="course-panel-title">
          {row.title}
        </h2>
        <p className={`${styles.meta} ${styles.pMeta}`}>
          {row.credits} credits
          {inCore ? " · Core" : ""}
          {readable ? (
            <>
              {" · Needs "}
              <RuleText rule={readable} />
            </>
          ) : row.rule ? null : (
            " · No prerequisites"
          )}
          {dependents.length > 0 ? (
            <>
              {" · Unlocks "}
              {dependents.slice(0, 4).map((id, index) => (
                <span key={id}>
                  {index > 0 ? ", " : ""}
                  <CourseLink id={id} />
                </span>
              ))}
              {dependents.length > 4 ? `, +${dependents.length - 4} more` : ""}
            </>
          ) : null}
        </p>
        {row.coveredBy ? (
          <p className={styles.pNote}>
            Covered: you passed <CourseLink id={row.coveredBy} />, which requires this course. It counts toward
            prerequisites but adds no credit.
          </p>
        ) : null}
        {unparsed.length > 0 ? (
          <p className={styles.pNote}>
            Check with an advisor: UNTangle could not read{" "}
            {unparsed.map((text, index) => (
              <span key={index}>
                {index > 0 ? " and " : ""}
                <q>{text}</q>
              </span>
            ))}
          </p>
        ) : null}
        {showClose ? (
          <IconButton className={styles.pClose} size="sm" label={`Close ${row.id} details`} onClick={actions.close}>
            <Close />
          </IconButton>
        ) : null}
      </div>

      <div className={styles.pActions}>
        {primary}
        {links.map((link) => (
          <a
            key={link.key}
            className="ui-btn ui-btn--ghost"
            data-ui=""
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            title={link.hint}
            data-linkout={link.key}
          >
            {link.label}
            <ExternalGlyph size={12} />
            <span className={styles.srOnly}> for {linkName} (opens in a new tab)</span>
          </a>
        ))}
      </div>

      {row.description ? (
        <section className={styles.pSec} aria-label="Description">
          <p className={styles.desc} data-clamped={longDescription && !expanded}>
            {row.description}
          </p>
          {longDescription ? (
            <Button variant="link" size="sm" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
              {expanded ? "Less" : "More"}
            </Button>
          ) : null}
        </section>
      ) : null}

      <section className={styles.pSec} aria-labelledby="grades-title">
        <div className={styles.secHead}>
          <h3 className={styles.h3} id="grades-title">
            Grade distribution
          </h3>
          <span className={styles.spacer} />
          {options.length > 1 ? (
            <div className={styles.instructorPicker}>
              <Select label="Instructor" hideLabel size="sm" options={options} value={instructor} onValueChange={setInstructor} />
            </div>
          ) : null}
        </div>
        <GradeBody view={view} retry={retry} chosen={chosen} instructorKey={instructor} courseId={row.id} />
      </section>

      <section className={styles.pSec} aria-labelledby="sections-title">
        <div className={styles.secHead}>
          <h3 className={styles.h3} id="sections-title">
            Sections, {profile.planningTerm}
          </h3>
          <ProvenanceTag source="Sections are synthetic samples, not a real UNT term. Check the official schedule before you register.">
            Sample
          </ProvenanceTag>
          <span className={styles.spacer} />
          <span className={styles.meta}>
            {canPick ? (row.status === "planned" ? "Pick the one you want" : "Picking one adds the course") : sections.length ? "Not available to plan" : ""}
          </span>
        </div>
        {sections.length === 0 ? (
          <p className={styles.meta} style={{ marginTop: 10 }}>
            No sample sections for this course.
          </p>
        ) : (
          <div className={styles.secRows} role="radiogroup" aria-label={`Sections of ${row.id}`}>
            {sectionsShown.map((section) => {
              const conflict = conflictWith(section, scheduleEvents, row.id);
              const checked = row.status === "planned" && section.id === selectedSectionId;
              const number = section.id.split("-").at(-1);
              return (
                <label key={section.id} className={styles.secRow} data-checked={checked} data-disabled={!canPick}>
                  <Radio
                    name={`section-${row.id}`}
                    checked={checked}
                    disabled={!canPick}
                    onChange={() => actions.chooseSection(row.id, section.id)}
                  />
                  <span className={styles.code}>§{number}</span>
                  <span className={styles.secLines}>
                    <span>{meetingLine(section)}</span>
                    {conflict ? (
                      <small data-conflict="true">{conflict}</small>
                    ) : (
                      <small>
                        {section.professor} · ★ {section.rating.toFixed(1)}
                      </small>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        )}
        {sections.length > 3 ? (
          <Button variant="link" size="sm" className={styles.moreSections} onClick={() => setShowAllSections((value) => !value)}>
            {showAllSections ? "Show fewer sections" : `Show all ${sections.length} sections`}
          </Button>
        ) : null}
      </section>
    </>
  );
}

function GradeBody({
  view,
  retry,
  chosen,
  instructorKey: key,
  courseId,
}: {
  view: CourseGradeView | null;
  retry: () => void;
  chosen: InstructorOption | undefined;
  instructorKey: string;
  courseId: string;
}) {
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
        <p>Couldn&apos;t load grade history from {view.source}. The course details above are from the catalog.</p>
        <Button variant="ghost" size="sm" className={styles.retry} onClick={retry}>
          Retry
        </Button>
      </div>
    );
  }
  if (view.status === "no-history") {
    return (
      <div className={styles.stateLine} role="status">
        <p>No grade records for {courseId} yet.</p>
        <Credit view={view} />
      </div>
    );
  }
  const slice = key === "all" ? view.overall : chosen?.slice;
  if (!slice) {
    return (
      <div className={styles.stateLine} role="status">
        <p>No grade records for {chosen?.label ?? "this instructor"} in {courseId}.</p>
        <Credit view={view} />
      </div>
    );
  }
  const name = key === "all" ? "all instructors" : (chosen?.label ?? "this instructor");
  return (
    <>
      <div className={styles.figs}>
        <div className={styles.fig} data-fig>
          <b>{slice.gpa === null ? "—" : slice.gpa.toFixed(2)}</b>
          <span>Avg GPA</span>
        </div>
        <div className={styles.fig} data-fig>
          <b>{slice.total.toLocaleString()}</b>
          <span>Students</span>
        </div>
        <div className={styles.fig} data-fig>
          <b>{slice.sectionCount.toLocaleString()}</b>
          <span>Sections</span>
        </div>
      </div>
      <GradeChart grades={slice.grades} dataKey={key} label={`${courseId}, ${name}`} />
      <Credit view={view} />
    </>
  );
}

function Credit({ view }: { view: Exclude<CourseGradeView, { status: "unavailable" }> }) {
  const terms =
    view.status !== "ok" || view.terms.length === 0
      ? null
      : view.terms.length === 1
        ? view.terms[0]
        : `${view.terms[0]}–${view.terms.at(-1)}`;
  return (
    <div className={`${styles.credit} ${styles.meta}`}>
      <span>Grade history from {view.source}</span>
      {view.sourceUrl ? (
        <a className={styles.link} href={view.sourceUrl} target="_blank" rel="noopener noreferrer" data-linkout="source">
          Data source
          <ExternalGlyph size={11} />
          <span className={styles.srOnly}> (opens in a new tab)</span>
        </a>
      ) : null}
      {terms ? <ProvenanceTag source="Terms covered by the grade records shown.">{terms}</ProvenanceTag> : null}
    </div>
  );
}
