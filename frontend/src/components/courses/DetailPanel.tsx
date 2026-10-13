"use client";

import { useEffect, useMemo, useState } from "react";
import { GradeChart } from "@/components/grade-chart";
import { Button, IconButton } from "@/components/ui/Button";
import { Radio } from "@/components/ui/Checkbox";
import { Close, ExternalGlyph, MoreGlyph } from "@/components/ui/icons";
import { Menu, type MenuItem } from "@/components/ui/Menu";
import { ProvenanceTag } from "@/components/ui/ProvenanceTag";
import { Select, type SelectOption } from "@/components/ui/Select";
import { SectionsTag, summarizeProvenance } from "@/components/sections-provenance";
import type { CourseGradeView, InstructorSlice } from "@/lib/course-history";
import { classNumbersOf, meetingsConflict, optionLabel, rangeLabel, sampleOption, type CourseOptions } from "@/lib/planner-sections";
import type { Meeting, Section } from "@/lib/sections";
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
  /** This course's options, as loaded so far. */
  sectionOptions: CourseOptions;
  /** The other planned courses' sections, for conflict notes. */
  planSections: readonly Section[];
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

function clock(minutes: number) {
  const hours = Math.floor(minutes / 60);
  return `${hours % 12 === 0 ? 12 : hours % 12}:${String(minutes % 60).padStart(2, "0")}`;
}

function where(meeting: Meeting) {
  if (meeting.kind === "online") return "online";
  if (meeting.kind === "unassigned") return "room not assigned";
  return meeting.kind === "unknown" ? `in ${meeting.room}, a building not on the campus map` : `in ${meeting.room}`;
}

/**
 * One line per distinct meeting pattern, in component order (a lecture and
 * its required lab each get theirs): "Tue Thu 9:35–10:55 AM in Cury 203".
 */
function meetingLines(section: Section): string[] {
  const lines = new Map<string, Meeting["day"][]>();
  for (const meeting of section.meetings) {
    const time =
      meeting.startMinutes === null || meeting.endMinutes === null
        ? meeting.async
          ? "No set time,"
          : "Time to be announced,"
        : `${clock(meeting.startMinutes)}–${clock(meeting.endMinutes)} ${meeting.endMinutes >= 12 * 60 && meeting.endMinutes < 24 * 60 ? "PM" : "AM"}`;
    const key = `${time} ${where(meeting)}`;
    lines.set(key, [...(lines.get(key) ?? []), meeting.day]);
  }
  return [...lines].map(([rest, days]) => {
    const named = [...new Set(days.filter((day) => day !== null))].join(" ");
    const line = named ? `${named} ${rest}` : rest;
    return line.charAt(0).toUpperCase() + line.slice(1);
  });
}

function conflictWith(section: Section, others: readonly Section[]) {
  for (const other of others) {
    for (const meeting of section.meetings) {
      if (other.meetings.some((theirs) => meetingsConflict(meeting, theirs))) return `${meeting.day} conflicts with ${other.courseCode}`;
    }
  }
  return null;
}

/** Instructor, seats and class numbers for a real option; the instructor alone for a sample. */
function optionDetail(section: Section) {
  const instructor = section.instructor.display ?? "Instructor not listed";
  if (section.term === null) return instructor;
  const status =
    section.status === "open"
      ? section.seats.open !== null && section.seats.total !== null
        ? `${section.seats.open} of ${section.seats.total} open`
        : "Open"
      : section.status === "waitlist"
        ? "Wait list"
        : section.status === "unknown"
          ? section.rawStatus
          : section.status === "closed"
            ? "Closed"
            : "Cancelled";
  return `${instructor}, ${status.toLowerCase()}, class ${classNumbersOf(section).join(" + ")}`;
}

const plural = (count: number, word: string) => `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;

type InstructorOption = SelectOption & { slice?: InstructorSlice };

export function DetailContent({
  row,
  profile,
  inCore,
  selectedSectionId,
  sectionOptions,
  planSections,
  initialInstructor,
  actions,
  showClose,
}: Props) {
  const { view, retry } = useGradeHistory(profile, row.id);
  const result = sectionOptions.status === "ready" ? sectionOptions.result : null;
  const sections = useMemo(() => result?.sections ?? [], [result]);
  const others = planSections.filter((section) => section.courseCode !== row.id);
  // An old plan's synthetic pick, when this course now has real options.
  const savedSample =
    row.status === "planned" && selectedSectionId && !sections.some((section) => section.id === selectedSectionId)
      ? sampleOption(selectedSectionId)
      : undefined;
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
      const name = section.instructor.display;
      if (!name) continue;
      const key = instructorKey(name);
      if (!seen.has(key)) seen.set(key, { value: key, label: name, meta: "No grade records" });
    }
    return [{ value: "all", label: "All instructors" }, ...seen.values()] as InstructorOption[];
  }, [view, sections]);

  const chosen = options.find((option) => option.value === instructor);
  const selectedSection = sections.find((section) => section.id === selectedSectionId) ?? sections[0];
  const linkName = instructor !== "all" && chosen ? chosen.label : (selectedSection?.instructor.display ?? undefined);
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
        {blocking.length > 0 ? `Locked, needs ${blocking.slice(0, 2).join(" and ")}` : "Locked"}
      </Button>
    );
  }

  // The short list always includes the plan's section, so the checked option is never hidden.
  const planned = sections.find((section) => section.id === selectedSectionId);
  const firstThree = sections.slice(0, 3);
  const sectionsShown = showAllSections
    ? sections
    : planned && !firstThree.includes(planned)
      ? [...sections.slice(0, 2), planned]
      : firstThree;
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
            {row.override ? " (set by you)" : ""}
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
          {row.credits} credits{inCore ? ", core" : ""}.
          {readable ? (
            <>
              {" Needs "}
              <RuleText rule={readable} />.
            </>
          ) : row.rule ? null : (
            " No prerequisites."
          )}
          {dependents.length > 0 ? (
            <>
              {" Unlocks "}
              {dependents.slice(0, 4).map((id, index) => (
                <span key={id}>
                  {index > 0 ? ", " : ""}
                  <CourseLink id={id} />
                </span>
              ))}
              {dependents.length > 4 ? `, and ${dependents.length - 4} more` : ""}.
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
            <button type="button" className={styles.link} style={{ fontSize: 12.5 }} onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
              {expanded ? "Less" : "More"}
            </button>
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
          <SectionsTag provenance={result ? summarizeProvenance([result]) : null} compact={result?.provenance.kind === "sample"} />
          <span className={styles.spacer} />
          <span className={styles.meta}>
            {canPick ? (row.status === "planned" ? "Pick the one you want" : "Picking one adds the course") : sections.length ? "Not available to plan" : ""}
          </span>
        </div>
        {savedSample ? (
          <p className={styles.pNote}>
            Your plan has sample section §{optionLabel(savedSample)} for this course. Pick a real {profile.planningTerm} section below.
          </p>
        ) : null}
        {!result ? (
          <div aria-busy="true" aria-label={`Loading ${profile.planningTerm} sections`} style={{ marginTop: 10 }}>
            <div className={styles.shimmer} />
            <div className={styles.shimmer} />
          </div>
        ) : sections.length === 0 ? (
          <p className={styles.meta} style={{ marginTop: 10 }}>
            {result.availability === "no_classes" ? `Not offered in ${profile.planningTerm}.` : "No sections for this course."}
          </p>
        ) : (
          <div className={styles.secRows} role="radiogroup" aria-label={`Sections of ${row.id}`}>
            {sectionsShown.map((section) => {
              const conflict = conflictWith(section, others);
              const checked = row.status === "planned" && section.id === selectedSectionId;
              const dates = section.session.label === "Regular Academic Session" ? null : rangeLabel(section.session.dates);
              return (
                <label key={section.id} className={styles.secRow} data-checked={checked} data-disabled={!canPick}>
                  <Radio
                    name={`section-${row.id}`}
                    checked={checked}
                    disabled={!canPick}
                    onChange={() => actions.chooseSection(row.id, section.id)}
                  />
                  <span className={styles.code}>§{optionLabel(section)}</span>
                  <span className={styles.secLines}>
                    {meetingLines(section).map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                    {dates && section.term !== null ? <small>{`${section.session.label}, ${dates}`}</small> : null}
                    {conflict ? <small data-conflict="true">{conflict}</small> : <small>{optionDetail(section)}</small>}
                  </span>
                </label>
              );
            })}
          </div>
        )}
        {sections.length > 3 ? (
          <button type="button" className={`${styles.link} ${styles.moreSections}`} onClick={() => setShowAllSections((value) => !value)}>
            {showAllSections ? "Show fewer sections" : `Show all ${sections.length} sections`}
          </button>
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
