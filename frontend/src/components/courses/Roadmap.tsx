"use client";

import { memo, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { termLabel, type OpenRequirement, type PlannedCourse, type Roadmap as RoadmapPlan, type Term, type UnplacedCourse } from "@untangle/core/degree/roadmap";
import { ChevronDown } from "@/components/ui/icons";
import { keyboardFocused } from "@/components/ui/input-source";
import { Segmented } from "@/components/ui/Segmented";
import { StatusGlyph } from "@/components/ui/StatusGlyph";
import styles from "./courses.module.css";
import { REQUIREMENT_PREFIX } from "./WhatsLeft";
import { CREDIT_LIMITS, plannedFact, roadmapSummary, unplacedFact, type CreditLimit } from "./model/roadmap";
import { flip, measure, MOVE, reducedMotion } from "./reveal";

/** What the view hands the group: nothing yet (closed), a roadmap, or why there isn't one. */
export type RoadmapState = { kind: "closed" } | { kind: "ready"; roadmap: RoadmapPlan } | { kind: "error"; message: string };

type Props = {
  state: RoadmapState;
  open: boolean;
  onToggle: () => void;
  limit: CreditLimit;
  onLimitChange: (limit: CreditLimit) => void;
  /** True while the roadmap shown is for an older limit or record than the one chosen. */
  stale: boolean;
  titleOf: (code: string) => string | null;
  /** Whether a course or requirement key opens a detail. */
  canOpen: (code: string) => boolean;
  canOpenRequirement: (key: string) => boolean;
  onOpen: (code: string, opener: HTMLElement) => void;
  onOpenRequirement: (key: string) => void;
  selectedId: string | null;
};

const termKey = (term: Term) => `${term.season}-${term.year}`;
/** The catalog counts hours; the app says credits (docs/design/copy.md), and the row's fact carries the total. */
const requirementName = (name: string) => name.replace(/,\s*\d+(?:-\d+)?\s+hours(?:\s*\(choose \d+\))?$/, "").replace(/\bhours\b/g, "credits");
const creditsText = (credits: number) => `${credits} credit${credits === 1 ? "" : "s"}`;

/**
 * The roadmap (surfaces.md: "Spans the whole degree: a group in Courses"):
 * every term from the planning term on, each with its credits and a line
 * that fills toward the limit, then what it can't place. A row opens the
 * course's detail, which says why the course sits in that term.
 *
 * Changing the limit from a pointer moves each course to its new term by
 * FLIP (MOTION.md §3 "Compare views", §7: transform only, --t-move); from
 * the keyboard it changes at once, and under reduced motion only new terms
 * fade in (§10). Opening and closing the group is instant, like the others.
 */
export function Roadmap({ state, open, onToggle, limit, onLimitChange, stale, titleOf, canOpen, canOpenRequirement, onOpen, onOpenRequirement, selectedId }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pending = useRef<{ first: ReturnType<typeof measure>; limit: number; move: boolean } | null>(null);
  const running = useRef<Animation[]>([]);
  const roadmap = state.kind === "ready" ? state.roadmap : null;
  const summary = roadmap ? roadmapSummary(roadmap) : null;

  const changeLimit = (next: CreditLimit) => {
    running.current.forEach((animation) => animation.cancel());
    running.current = [];
    const root = rootRef.current;
    // A keyboard change never animates (MOTION.md §1); measuring is skipped too.
    pending.current = root && !keyboardFocused() ? { first: measure(root), limit: next, move: !reducedMotion() } : null;
    onLimitChange(next);
  };

  // The courses move once the roadmap for the new limit has rendered, before it paints.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const queued = pending.current;
    if (!root || !queued || roadmap?.creditLimit !== queued.limit) return;
    pending.current = null;
    if (queued.move) root.dataset.moving = "";
    running.current = flip(root, queued.first, { duration: MOVE.add, fadeIn: MOVE.fadeIn, move: queued.move });
    const settle = () => delete root.dataset.moving;
    if (running.current.length === 0) settle();
    else void Promise.allSettled(running.current.map((animation) => animation.finished)).then(settle);
  }, [roadmap]);

  return (
    <section className={styles.group} aria-labelledby="roadmap-head" data-open={open}>
      <h2 className={styles.groupHeading}>
        <button id="roadmap-head" type="button" className={styles.groupHead} aria-expanded={open} aria-controls={open ? "roadmap-body" : undefined} onClick={onToggle}>
          <span className={styles.leftHeadText}>
            <span>Roadmap</span>
            {!open ? (
              <span className={styles.count}>
                <span className={styles.srOnly}>, </span>
                Every term to the end of your degree
              </span>
            ) : null}
          </span>
          <ChevronDown size={16} className={styles.chev} />
        </button>
      </h2>
      {open ? (
        <div id="roadmap-body" className={styles.roadmap} ref={rootRef}>
          <div className={styles.roadmapBar}>
            <p className={styles.roadmapLead} aria-live="polite">
              {roadmap && roadmap.terms.length > 0 ? `At ${roadmap.creditLimit} credits a term: ${summary}.` : state.kind === "error" ? "" : summary ? `${summary}.` : ""}
            </p>
            <div className={styles.roadmapLimit}>
              <span className={styles.roadmapLimitLabel} aria-hidden="true">
                Credits a term
              </span>
              <Segmented label="Credits a term" size="sm" options={CREDIT_LIMITS.map((value) => ({ value: String(value) as `${CreditLimit}`, label: String(value) }))} value={String(limit) as `${CreditLimit}`} onValueChange={(value) => changeLimit(Number(value) as CreditLimit)} />
            </div>
          </div>
          {/* Shown only past 400ms of waiting, so a fast replan never flashes it (copy.md, "Loading"). */}
          {stale ? (
            <p className={styles.roadmapWait} role="status" data-ui="">
              Replanning at {limit} credits
            </p>
          ) : null}
          {state.kind === "error" ? (
            <p className={styles.roadmapError} role="alert">
              The roadmap couldn&apos;t be built from this catalog data: {state.message} What&apos;s left above still lists every requirement.
            </p>
          ) : roadmap ? (
            <RoadmapBody roadmap={roadmap} stale={stale} titleOf={titleOf} canOpen={canOpen} canOpenRequirement={canOpenRequirement} onOpen={onOpen} onOpenRequirement={onOpenRequirement} selectedId={selectedId} />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

type BodyProps = Pick<Props, "titleOf" | "canOpen" | "canOpenRequirement" | "onOpen" | "onOpenRequirement" | "selectedId"> & { roadmap: RoadmapPlan; stale: boolean };

function RoadmapBody({ roadmap, stale, titleOf, canOpen, canOpenRequirement, onOpen, onOpenRequirement, selectedId }: BodyProps) {
  const nothingLeft = roadmap.terms.length === 0 && roadmap.unplaced.length === 0 && roadmap.open.length === 0;
  if (nothingLeft) return <p className={styles.roadmapEmpty}>Nothing left to place. Every course your degree lists is done or underway.</p>;
  const leftOver = roadmap.unplaced.length + roadmap.open.length;
  return (
    <>
      <ol className={styles.terms} aria-busy={stale || undefined}>
        {roadmap.terms.map((entry) => {
          const id = `roadmap-${termKey(entry.term)}`;
          const over = entry.credits > roadmap.creditLimit;
          return (
            <li key={id} className={styles.term} aria-labelledby={id} data-flip={`term:${termKey(entry.term)}`}>
              <h3 className={styles.termHead} id={id}>
                <span>{termLabel(entry.term)}</span>
                <span className={styles.termCredits} data-tone={over ? "attention" : undefined}>
                  <span className={styles.srOnly}>, </span>
                  {over ? `${creditsText(entry.credits)}, above ${roadmap.creditLimit}` : creditsText(entry.credits)}
                </span>
              </h3>
              {/* How full the term is against the limit: the credits above say it in words. */}
              <span className={styles.termLoad} aria-hidden="true" data-over={over || undefined}>
                <i style={{ "--load": Math.min(1, entry.credits / roadmap.creditLimit) } as CSSProperties} />
              </span>
              {entry.courses.length > 0 ? (
                <ul className={styles.rows}>
                  {entry.courses.map((course) => (
                    <PlannedRow key={course.code} course={course} title={titleOf(course.code)} openable={canOpen(course.code)} selected={selectedId === course.code} onOpen={onOpen} />
                  ))}
                </ul>
              ) : (
                <p className={styles.termEmpty}>Nothing the roadmap names fits this term yet. Electives fill it.</p>
              )}
            </li>
          );
        })}
      </ol>
      {leftOver > 0 ? (
        <section className={styles.term} aria-labelledby="roadmap-left">
          <h3 className={styles.termHead} id="roadmap-left">
            <span>Not in a term yet</span>
          </h3>
          <ul className={styles.rows}>
            {roadmap.unplaced.map((course) => (
              <UnplacedRow key={course.code} course={course} title={titleOf(course.code)} openable={canOpen(course.code)} selected={selectedId === course.code} onOpen={onOpen} />
            ))}
            {roadmap.open.map((item) => (
              <OpenRow key={item.key} item={item} openable={canOpenRequirement(item.viewKey)} selected={selectedId === `${REQUIREMENT_PREFIX}${item.viewKey}`} onOpen={onOpenRequirement} />
            ))}
          </ul>
        </section>
      ) : null}
      <p className={styles.roadmapNote}>One way to finish, if you pass each course in its term. A term&apos;s spare credits go to electives you choose, and count toward standing.</p>
    </>
  );
}

type RowProps<T> = { title: string | null; openable: boolean; selected: boolean; onOpen: (code: string, opener: HTMLElement) => void } & T;

/** The row's content inside a button that opens the detail, or as plain text when there's no detail to open. */
function RowShell({ code, openable, selected, onOpen, children }: { code: string; openable: boolean; selected: boolean; onOpen: (code: string, opener: HTMLElement) => void; children: ReactNode }) {
  return openable ? (
    <button type="button" className={styles.rowOpen} data-row-open={code} aria-current={selected || undefined} onClick={(event) => onOpen(code, event.currentTarget)}>
      {children}
    </button>
  ) : (
    <div className={styles.rowOpen} data-static="">
      {children}
    </div>
  );
}

const PlannedRow = memo(function PlannedRow({ course, title, openable, selected, onOpen }: RowProps<{ course: PlannedCourse }>) {
  const fact = plannedFact(course);
  return (
    <li className={styles.row} data-kind="roadmap" data-flip={`plan:${course.code}`} data-selected={selected || undefined}>
      <RowShell code={course.code} openable={openable} selected={selected} onOpen={onOpen}>
        <span className={styles.lead} aria-hidden="true">
          {course.why.kind === "pinned" ? <StatusGlyph status="planned" /> : null}
        </span>
        <span className={styles.code}>{course.code}</span>
        <span className={styles.title}>{title ?? ""}</span>
        {fact ? (
          <span className={styles.fact} data-tone={course.ruleMet ? undefined : "attention"}>
            <span className={styles.srOnly}>, </span>
            {fact}
          </span>
        ) : null}
      </RowShell>
    </li>
  );
});

const UnplacedRow = memo(function UnplacedRow({ course, title, openable, selected, onOpen }: RowProps<{ course: UnplacedCourse }>) {
  return (
    <li className={styles.row} data-kind="roadmap" data-flip={`plan:${course.code}`} data-selected={selected || undefined}>
      <RowShell code={course.code} openable={openable} selected={selected} onOpen={onOpen}>
        <span className={styles.lead} aria-hidden="true">
          <StatusGlyph status="check" />
        </span>
        <span className={styles.code}>{course.code}</span>
        <span className={styles.title}>{title ?? ""}</span>
        <span className={styles.fact}>
          <span className={styles.srOnly}>, </span>
          {unplacedFact(course)}
        </span>
      </RowShell>
    </li>
  );
});

const OpenRow = memo(function OpenRow({ item, openable, selected, onOpen }: { item: OpenRequirement; openable: boolean; selected: boolean; onOpen: (key: string) => void }) {
  const content = (
    <>
      <span className={styles.lead} aria-hidden="true">
        <StatusGlyph status="check" />
      </span>
      <span className={styles.reqName}>{requirementName(item.name)}</span>
      <span className={styles.fact}>
        <span className={styles.srOnly}>, </span>
        {item.credits !== null ? `${creditsText(item.credits)} to choose` : "Ask an advisor"}
      </span>
    </>
  );
  return (
    <li className={styles.row} data-kind="requirement" data-selected={selected || undefined}>
      {openable ? (
        <button type="button" className={styles.reqOpen} data-row-open={`${REQUIREMENT_PREFIX}${item.viewKey}`} aria-current={selected || undefined} onClick={() => onOpen(item.viewKey)}>
          {content}
        </button>
      ) : (
        <div className={styles.reqOpen} data-static="">
          {content}
        </div>
      )}
    </li>
  );
});
