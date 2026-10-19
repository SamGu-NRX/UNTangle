"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { NodeOutcome } from "@untangle/core/degree/audit";
import type { Citation } from "@untangle/core/degree/types";
import { ExternalGlyph } from "@/components/ui/icons";
import { StatusGlyph } from "@/components/ui/StatusGlyph";
import styles from "./courses.module.css";
import { CourseLink } from "./bits";
import type { CourseModel, CourseRowModel } from "./model/course-model";
import { chooseUnit, countsSelections, fillsText, type AdvisorItem, type Requirement } from "./model/degree";
import { rowFact } from "./model/groups";

export type LeftItem = { kind: "requirement"; requirement: Requirement; areaTitle: string } | { kind: "advisor"; item: AdvisorItem; areaTitle: string };

/** Course options a list shows before "Show all". Starting value: no data on how far students read. */
const OPTIONS_BEFORE_MORE = 8;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** The catalog page at the requirement's heading. */
const catalogHref = (citation: Citation) => (citation.anchor ? `${citation.url}#${citation.anchor}` : citation.url);

/**
 * One requirement from "What's left", in the panel (a sheet on phones): what
 * it still needs, each course with its readiness from the prerequisite
 * model, and why it is needed, citing the catalog heading it comes from.
 */
export function RequirementDetail({ entry, model }: { entry: LeftItem; model: CourseModel }) {
  const citation = entry.kind === "requirement" ? entry.requirement.citation : entry.item.citation;
  const name = entry.kind === "requirement" ? entry.requirement.name : entry.item.name;
  return (
    <div className={styles.detail}>
      <div className={styles.detailHead}>
        <p className={styles.detailTitle}>{name}</p>
        <p className={styles.detailStatus}>
          {entry.kind === "advisor" ? (
            <>
              <span aria-hidden="true">
                <StatusGlyph status="check" />
              </span>
              Check this with an advisor
            </>
          ) : (
            statusText(entry.requirement)
          )}
        </p>
      </div>
      {entry.kind === "advisor" ? <AdvisorPart item={entry.item} model={model} /> : <NeedPart requirement={entry.requirement} model={model} />}
      <section className={styles.dsec} aria-labelledby="req-why">
        <h3 id="req-why">Why</h3>
        <p className={styles.rule}>
          {entry.areaTitle} lists this under <b>{citation.heading}</b> in UNT&apos;s catalog.
        </p>
        <a className={`${styles.extLink} ${styles.catalogLink}`} href={catalogHref(citation)} target="_blank" rel="noopener noreferrer">
          Open in the catalog
          <ExternalGlyph size={14} />
          <span className={styles.srOnly}> (opens in a new tab)</span>
        </a>
      </section>
    </div>
  );
}

function statusText(requirement: Requirement): ReactNode {
  switch (requirement.status) {
    case "needed":
      return requirement.source.kind === "policy" ? requirement.fact : `Still needs ${requirement.fact.replace(/^One /, "one ")}`;
    case "inProgress":
      return (
        <>
          <span aria-hidden="true">
            <StatusGlyph status="taking" />
          </span>
          Met once this term&apos;s courses pass
        </>
      );
    case "claimed":
      return "Met only by courses you marked done";
  }
}

function NeedPart({ requirement, model }: { requirement: Requirement; model: CourseModel }) {
  if (requirement.status === "claimed") {
    return (
      <section className={styles.dsec} aria-labelledby="req-need">
        <h3 id="req-need">What counts</h3>
        <p className={styles.rule}>Your transcript doesn&apos;t show the courses you marked done, so an advisor has to confirm them before this counts.</p>
      </section>
    );
  }
  if (requirement.status === "inProgress") {
    return (
      <section className={styles.dsec} aria-labelledby="req-need">
        <h3 id="req-need">What counts</h3>
        <p className={styles.rule}>Nothing more to add. A course you&apos;re taking now finishes it once it passes.</p>
      </section>
    );
  }
  if (requirement.source.kind === "policy") {
    return (
      <section className={styles.dsec} aria-labelledby="req-need">
        <h3 id="req-need">What the audit found</h3>
        <p className={styles.rule}>{requirement.source.detail}</p>
      </section>
    );
  }
  return (
    <section className={styles.dsec} aria-labelledby="req-need">
      <h3 id="req-need">Still needed</h3>
      <Need outcome={requirement.source.outcome} model={model} depth={0} />
    </section>
  );
}

/** What one outcome still needs, by the audit's remaining kind; groups and choices recurse into their parts. */
function Need({ outcome, model, depth }: { outcome: NodeOutcome; model: CourseModel; depth: number }) {
  const remaining = outcome.remaining;
  switch (remaining.kind) {
    case "courses":
      return (
        <>
          {remaining.courses.length > 0 ? <CourseList ids={remaining.courses} model={model} /> : null}
          {remaining.oneOf.map((sets, index) => (
            <div key={index} className={styles.reqChoice}>
              <p className={styles.reqLead}>One of these:</p>
              <OptionList options={sets.map((courses) => ({ courses }))} model={model} />
            </div>
          ))}
        </>
      );
    case "choose": {
      // A slot's options are the catalog's equivalents: any one of them fills it, so they stay together.
      const single = remaining.eligible.filter((slot) => slot.options.length === 1);
      const several = remaining.eligible.filter((slot) => slot.options.length > 1);
      // Counted in selections, options differ in what they finish, so each says it (#168 review).
      const selections = countsSelections(remaining);
      const option = (choice: { courses: string[]; picks: number }): Option => ({
        courses: choice.courses,
        fills: selections ? { picks: choice.picks, of: remaining.picks } : undefined,
      });
      return (
        <>
          <p className={styles.reqLead}>{plural(remaining.picks, `more ${chooseUnit(remaining)}`)} from these:</p>
          {single.length > 0 ? <OptionList options={single.map((slot) => option(slot.options[0]!))} model={model} /> : null}
          {several.map((slot, index) => (
            <div key={index} className={styles.reqChoice}>
              <p className={styles.reqLead}>Or one of these:</p>
              <OptionList options={slot.options.map(option)} model={model} />
            </div>
          ))}
        </>
      );
    }
    case "hours":
      return (
        <>
          <p className={styles.reqLead}>{plural(remaining.hours, "more credit")} from these:</p>
          <OptionList options={remaining.eligible.map((courses) => ({ courses }))} model={model} />
        </>
      );
    case "parts":
    case "branch": {
      const parts = (outcome.children ?? []).filter((child) => child.remaining.kind !== "none");
      return (
        <>
          {remaining.kind === "branch" ? <p className={styles.reqLead}>Finish one of these {parts.length} ways:</p> : null}
          {parts.map((child) => (
            <div key={child.name} className={styles.reqChoice} data-depth={depth + 1}>
              <h4 className={styles.reqPart}>{child.kind === "choice" ? child.citation.heading : child.name}</h4>
              <Need outcome={child} model={model} depth={depth + 1} />
            </div>
          ))}
        </>
      );
    }
    case "advisor":
      return <p className={styles.rule}>{remaining.reason}</p>;
    case "none":
      return null;
  }
}

function AdvisorPart({ item, model }: { item: AdvisorItem; model: CourseModel }) {
  return (
    <>
      <section className={styles.dsec} aria-labelledby="req-ask">
        <h3 id="req-ask">{item.quote ? "What the catalog says" : "What to ask"}</h3>
        {item.quote ? <blockquote className={styles.reqQuote}>{item.text}</blockquote> : <p className={styles.rule}>{item.text}</p>}
      </section>
      {item.candidates.length > 0 ? (
        <section className={styles.dsec} aria-labelledby="req-may">
          <h3 id="req-may">May count here</h3>
          <CourseList ids={item.candidates} model={model} />
        </section>
      ) : null}
      {item.askAbout.length > 0 ? (
        <section className={styles.dsec} aria-labelledby="req-ask-about">
          <h3 id="req-ask-about">Ask whether these count</h3>
          <CourseList ids={item.askAbout} model={model} />
        </section>
      ) : null}
    </>
  );
}

/** Readiness order, so the courses a student can act on lead: can take, to check, later, then the rest. */
const RANK: Partial<Record<CourseRowModel["status"], number>> = { available: 0, planned: 1, taking: 2, check: 3, locked: 4, done: 5, covered: 5 };
/** One way to meet a list: its courses, and for a selection-counted choose, what it finishes. */
type Option = { courses: readonly string[]; fills?: Fill };
/** Of the `of` selections still needed, how many this option fills. */
type Fill = { picks: number; of: number };

const rankOf = (ids: readonly string[], model: CourseModel) => Math.max(...ids.map((id) => RANK[model.rows.get(id)?.status ?? "locked"] ?? 4), ids.some((id) => !model.rows.has(id)) ? 6 : 0);

function OptionList({ options, model }: { options: readonly Option[]; model: CourseModel }) {
  const sorted = options
    .filter((option) => option.courses.length > 0)
    .map((option, index) => ({ option, index, rank: rankOf(option.courses, model) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.option);
  const [all, setAll] = useState(false);
  const shown = all ? sorted : sorted.slice(0, OPTIONS_BEFORE_MORE);
  const list = useRef<HTMLUListElement>(null);
  const focusRevealed = useRef(false);
  // "Show all" leaves with the press, so focus goes to the first option it revealed.
  useLayoutEffect(() => {
    if (!focusRevealed.current) return;
    focusRevealed.current = false;
    const first = list.current?.children[OPTIONS_BEFORE_MORE] as HTMLElement | undefined;
    (first?.querySelector<HTMLElement>("a") ?? first)?.focus();
  }, [all]);
  return (
    <>
      <ul className={styles.reqCourses} ref={list}>
        {shown.map((option) =>
          option.courses.length === 1 ? (
            <CourseItem key={option.courses[0]} id={option.courses[0]!} fills={option.fills} model={model} />
          ) : (
            <CourseSet key={option.courses.join("+")} ids={option.courses} fills={option.fills} model={model} />
          ),
        )}
      </ul>
      {sorted.length > shown.length ? (
        <button
          type="button"
          className={styles.textButton}
          onClick={() => {
            focusRevealed.current = true;
            setAll(true);
          }}
        >
          Show all {sorted.length}
        </button>
      ) : null}
    </>
  );
}

function CourseList({ ids, model }: { ids: readonly string[]; model: CourseModel }) {
  return <OptionList options={ids.map((id) => ({ courses: [id] }))} model={model} />;
}

/**
 * Courses the catalog asks for together (a lecture and its lab). The set
 * reads as ready as its least ready course, with that course's fact.
 */
function CourseSet({ ids, fills, model }: { ids: readonly string[]; fills?: Fill; model: CourseModel }) {
  const rows = ids.map((id) => model.rows.get(id));
  const known = rows.filter((row): row is CourseRowModel => row !== undefined);
  const least = known.length === ids.length ? known.reduce((worst, row) => ((RANK[row.status] ?? 4) > (RANK[worst.status] ?? 4) ? row : worst)) : undefined;
  const fact = least ? rowFact(least)?.text : known.length < ids.length ? "Not all in UNTangle's catalog yet" : undefined;
  return (
    <li className={styles.reqSet} data-status={least?.status} tabIndex={-1}>
      <span className={styles.lead} aria-hidden="true">
        {least ? <StatusGlyph status={least.status} /> : null}
      </span>
      <span>
        {ids.map((id, index) => (
          <span key={id}>
            {index > 0 ? (index === ids.length - 1 ? " and " : ", ") : null}
            <CourseLink id={id} />
          </span>
        ))}
      </span>
      {fact ? <span className={styles.reqFact}>{fact}</span> : null}
      {fills ? <Fills fill={fills} /> : null}
    </li>
  );
}

/** What an option finishes, on its own line under the codes; one that finishes the requirement reads in ink. */
function Fills({ fill }: { fill: Fill }) {
  return (
    <span className={styles.reqFills} data-finishes={fill.picks >= fill.of || undefined}>
      {fillsText(fill.picks, fill.of)}
    </span>
  );
}

/** A course in a requirement: its readiness glyph, its code (a link when UNTangle has it), title and one fact. */
function CourseItem({ id, fills, model }: { id: string; fills?: Fill; model: CourseModel }) {
  const row = model.rows.get(id);
  const fact = row ? (rowFact(row)?.text ?? (row.status === "planned" ? "Planned" : row.status === "taking" ? "Taking now" : null)) : "Not in UNTangle's catalog yet";
  return (
    <li className={styles.reqCourse} data-status={row?.status} tabIndex={-1}>
      <span className={styles.lead} aria-hidden="true">
        {row ? <StatusGlyph status={row.status} /> : null}
      </span>
      <span className={styles.code}>
        <CourseLink id={id} />
      </span>
      <span className={styles.reqTitle}>{row?.title ?? ""}</span>
      {fact ? <span className={styles.reqFact}>{fact}</span> : null}
      {fills ? <Fills fill={fills} /> : null}
    </li>
  );
}
