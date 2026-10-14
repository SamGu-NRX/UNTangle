"use client";

import { useMemo, useState, type MouseEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Check, Minus, Plus } from "@/components/ui/icons";
import { PathLine, PathStop, type PathLeg } from "@/components/ui/PathLine";
import { StatusGlyph } from "@/components/ui/StatusGlyph";
import type { CourseOptions } from "@/lib/planner-sections";
import styles from "./courses.module.css";
import { CourseLink, RuleText } from "./bits";
import { Grades, slicesByInstructor, useGradeHistory } from "./Grades";
import type { CourseModel, CourseRowModel } from "./model/course-model";
import { instructorKey } from "./model/grades";
import { rowFact } from "./model/groups";
import { ruleCourseIds, splitUnparsed } from "./model/rules";
import type { SchoolProfile } from "./school";
import { SectionList, type PlacedSection } from "./SectionList";

export type DetailActions = {
  plan: (id: string, event?: MouseEvent) => void;
  unplan: (id: string, event?: MouseEvent) => void;
  markCredit: (id: string, event?: MouseEvent) => void;
  clearCredit: (id: string, event?: MouseEvent) => void;
  chooseSection: (id: string, sectionId: string, event: MouseEvent) => void;
};

type Props = {
  row: CourseRowModel;
  model: CourseModel;
  profile: SchoolProfile;
  options: CourseOptions;
  placed: readonly PlacedSection[];
  chosenSectionId: string | undefined;
  initialInstructor: string | null;
  /** On the major's core list. */
  inCore: boolean;
  actions: DetailActions;
};

const article = (grade: string) => (/^[AEFHILMNORSX]/.test(grade) ? "an" : "a");

/** The status in one line, under the title. */
function statusLine(row: CourseRowModel, term: string): string {
  switch (row.status) {
    case "available":
      return "You can take this";
    case "planned":
      return `Planned for ${term}`;
    case "taking":
      return "Taking now";
    case "done":
      return row.meta.kind === "grade" ? `Done in ${row.meta.term} with ${article(row.meta.grade)} ${row.meta.grade}` : "You marked this done";
    default:
      return rowFact(row)?.text ?? "";
  }
}

const isFinished = (row: CourseRowModel | undefined) => row?.status === "done" || row?.status === "covered" || row?.status === "taking";

/**
 * The course detail (DESIGN.md §4.2), the same in the desktop panel and the
 * phone sheet: status and the one action, the prerequisite path checked
 * against the student's record, sections against their week, grade history
 * and the description.
 */
export function CourseDetail({ row, model, profile, options, placed, chosenSectionId, initialInstructor, inCore, actions }: Props) {
  const term = profile.planningTerm;
  const { view, retry } = useGradeHistory(profile, row.id);
  const slices = useMemo(() => slicesByInstructor(view), [view]);
  const sectionInstructors = useMemo(
    () => (options.status === "ready" ? [...new Set(options.result.sections.flatMap((section) => section.instructor.display ?? []))] : []),
    [options],
  );
  const canAdd = row.status === "available" || row.status === "check" || row.status === "planned";

  return (
    <div className={styles.detail}>
      <div className={styles.detailHead}>
        <p className={styles.detailTitle}>{row.title}</p>
        <p className={styles.detailStatus}>
          <span aria-hidden="true">
            <StatusGlyph status={row.status} />
          </span>
          {statusLine(row, term)}
        </p>
      </div>
      <DetailActionsPart row={row} term={term} actions={actions} />
      <section className={styles.dsec} aria-labelledby="detail-path">
        <h3 id="detail-path">Path</h3>
        <PathPart row={row} model={model} dependents={profile.dependents(row.id)} inCore={inCore} />
      </section>
      <section className={styles.dsec} aria-labelledby="detail-sections">
        <h3 id="detail-sections">Sections</h3>
        <SectionList
          courseId={row.id}
          term={term}
          options={options}
          placed={placed}
          chosenId={row.inPlan ? chosenSectionId : undefined}
          canAdd={canAdd}
          onAdd={(sectionId, event) => actions.chooseSection(row.id, sectionId, event)}
          gpaOf={(name) => slices.get(instructorKey(name))?.gpa ?? null}
        />
      </section>
      <section className={styles.dsec} aria-labelledby="detail-grades">
        <h3 id="detail-grades">Grades</h3>
        <Grades
          courseId={row.id}
          view={view}
          retry={retry}
          sectionInstructors={sectionInstructors}
          initialInstructor={initialInstructor}
          linkOuts={profile.linkOuts}
        />
      </section>
      {row.description ? (
        <section className={styles.dsec} aria-labelledby="detail-about">
          <h3 id="detail-about">About</h3>
          <About text={row.description} />
        </section>
      ) : null}
    </div>
  );
}

function DetailActionsPart({ row, term, actions }: { row: CourseRowModel; term: string; actions: DetailActions }) {
  const primary =
    row.status === "available" ? (
      <>
        <Button data-detail-primary="" key="add" icon={<Plus size={18} />} onClick={(event) => actions.plan(row.id, event)}>
          Add to {term}
        </Button>
        <p className={styles.meta}>Week picks a section that fits, or choose one below.</p>
      </>
    ) : row.status === "planned" ? (
      <Button data-detail-primary="" key="remove" variant="secondary" icon={<Minus size={18} />} onClick={(event) => actions.unplan(row.id, event)}>
        Remove from {term}
      </Button>
    ) : row.status === "check" ? (
      <Button data-detail-primary="" key="approval" variant="secondary" icon={<Check size={18} />} onClick={(event) => actions.plan(row.id, event)}>
        I have approval
      </Button>
    ) : null;
  // Credit by exam or transfer that the transcript does not show; and, for a locked course, the student's own call.
  const quiet =
    row.status === "done" && row.override ? (
      <Button variant="quiet" size="sm" data-detail-credit="" onClick={(event) => actions.clearCredit(row.id, event)}>
        Remove my credit mark
      </Button>
    ) : row.status === "locked" ? (
      <span className={styles.quietActions}>
        <Button variant="quiet" size="sm" data-detail-credit="" onClick={(event) => actions.markCredit(row.id, event)}>
          I have credit for this
        </Button>
        <Button variant="quiet" size="sm" onClick={(event) => actions.plan(row.id, event)}>
          Add anyway
        </Button>
      </span>
    ) : row.status === "available" || row.status === "check" ? (
      <Button variant="quiet" size="sm" data-detail-credit="" onClick={(event) => actions.markCredit(row.id, event)}>
        I have credit for this
      </Button>
    ) : null;
  if (!primary && !quiet) return null;
  return (
    <div className={styles.detailActions}>
      {primary}
      {quiet}
    </div>
  );
}

function PathPart({ row, model, dependents, inCore }: { row: CourseRowModel; model: CourseModel; dependents: readonly string[]; inCore: boolean }) {
  // The path draws at most four stops, so it fits a 360px screen: up to two prerequisites
  // (the catalog rule below names them all), this course, and as many unlocks as fit, at most two.
  const needs = ruleCourseIds(row.rule).slice(0, 2);
  const drawn = Math.min(2, 3 - needs.length);
  const unlocks = dependents.slice(0, drawn);
  // The rest are listed under the path, up to four, then counted.
  const listed = dependents.slice(drawn, drawn + 4);
  const uncounted = dependents.length - drawn - listed.length;
  const { readable, unparsed } = splitUnparsed(row.rule);
  const engine = row.assessment?.status;
  const meets = engine === "eligible" || engine === "done" || engine === "taking";
  const proof = needs.flatMap((id) => {
    const need = model.rows.get(id);
    return need?.meta.kind === "grade" ? [`${id} (${need.meta.grade})`] : [];
  });

  const stops = [
    ...needs.map((id) => {
      const need = model.rows.get(id);
      const met = isFinished(need);
      const meta = need?.status === "taking" ? "Taking now" : need?.status === "covered" ? "Covered" : need?.meta.kind === "grade" ? `Grade ${need.meta.grade}` : "Not yet";
      return { id, link: true, tone: met ? ("default" as const) : ("ring" as const), met, meta };
    }),
    { id: row.id, link: false, tone: "here" as const, met: isFinished(row), meta: "This course" },
    ...unlocks.map((id) => ({ id, link: true, tone: "ring" as const, met: false, meta: "Unlocks" })),
  ];

  return (
    <>
      {needs.length + unlocks.length > 0 ? (
        <PathLine orientation="horizontal" label={`Prerequisites and what ${row.id} unlocks`} className={styles.path}>
          {stops.map((stop, index) => {
            const leg: PathLeg | undefined = index < stops.length - 1 ? (stop.met ? "done" : "todo") : undefined;
            return (
              <PathStop key={stop.id} tone={stop.tone} leg={leg} marker={stop.met && stop.tone === "default" ? <Check size={14} strokeWidth={2.4} /> : null}>
                <span className={styles.pathCode}>{stop.link ? <CourseLink id={stop.id} /> : stop.id}</span>
                <span className={styles.pathMeta}>{stop.meta}</span>
              </PathStop>
            );
          })}
        </PathLine>
      ) : null}
      <p className={styles.rule}>
        {!row.rule ? (
          "No prerequisites."
        ) : (
          <>
            {readable ? (
              <>
                Catalog rule:{" "}
                <b>
                  <RuleText rule={readable} />
                </b>
                .{" "}
              </>
            ) : null}
            {row.coveredBy ? (
              <>
                You passed <CourseLink id={row.coveredBy} />, which requires this course, so it counts toward prerequisites but adds no credit.
              </>
            ) : meets ? (
              <>
                <span className={styles.ok}>You meet it</span>
                {proof.length > 0 ? ` with ${proof.join(" and ")}` : ""}.
              </>
            ) : unparsed.length > 0 ? (
              <>
                UNTangle can&apos;t read <q>{unparsed[0]}</q>, so check it with an advisor.
              </>
            ) : (
              "You don't meet it yet."
            )}
          </>
        )}
      </p>
      {listed.length > 0 ? (
        <p className={styles.rule}>
          Also unlocks{" "}
          {listed.map((id, index) => (
            <span key={id}>
              {index === 0 ? "" : index === listed.length - 1 && uncounted === 0 ? " and " : ", "}
              <CourseLink id={id} />
            </span>
          ))}
          {uncounted > 0 ? ` and ${uncounted} more` : ""}.
        </p>
      ) : null}
      {inCore ? <p className={styles.rule}>On your major&apos;s core list.</p> : null}
    </>
  );
}

function About({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  // Long enough to pass three lines at the panel's width.
  const long = text.length > 220;
  return (
    <>
      <p className={styles.description} data-clamped={(long && !open) || undefined}>
        {text}
      </p>
      {long ? (
        <button type="button" className={styles.textButton} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? "Less" : "More"}
        </button>
      ) : null}
    </>
  );
}
