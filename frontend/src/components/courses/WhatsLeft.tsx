"use client";

import { memo, type ReactNode } from "react";
import { ChevronDown } from "@/components/ui/icons";
import { StatusGlyph } from "@/components/ui/StatusGlyph";
import styles from "./courses.module.css";
import type { AdvisorItem, AuditedDegree, Requirement } from "./model/degree";
import { advisorLabel, areaSummary, leftHeadline, leftNotes } from "./model/left-copy";

export type LeftGroupKey = "major" | "core" | "advisor";

/**
 * Which groups start open. Planning next term is the frequent job, so on a
 * phone the areas start closed, each header summing up what is left, and the
 * term card sits a screen higher. The advisor's list is reference, closed on
 * every width.
 */
export function leftOpenAtStart(phone: boolean): Readonly<Record<LeftGroupKey, boolean>> {
  return { major: !phone, core: !phone, advisor: false };
}

/** A requirement row opens its detail; the key is prefixed so it never collides with a course code. */
export const REQUIREMENT_PREFIX = "req:";

/**
 * The first answer on Courses for a major the degree audit covers: how many
 * credits are left, and what that figure leans on. The term card follows it;
 * what is left by area comes after the term (WhatsLeft).
 */
export function CreditsLeft({ degree }: { degree: AuditedDegree }) {
  return (
    <section className={styles.left} aria-labelledby="left-title">
      <h2 className={styles.leftTitle} id="left-title">
        {leftHeadline(degree)}
      </h2>
      {leftNotes(degree).map((note) => (
        <p key={note} className={styles.leftNote}>
          {note}
        </p>
      ))}
    </section>
  );
}

type Props = {
  degree: AuditedDegree;
  open: Readonly<Record<LeftGroupKey, boolean>>;
  onToggle: (key: LeftGroupKey) => void;
  selectedKey: string | null;
  onOpen: (key: string) => void;
};

/**
 * What is left by area (the major, the University Core), then what only an
 * advisor can settle, as rows that open their detail with the catalog's
 * reason. Groups open and close at once, like the course groups below
 * (MOTION.md §7); a closed area says how much is left in its header.
 */
export function WhatsLeft({ degree, open, onToggle, selectedKey, onOpen }: Props) {
  return (
    <>
      {degree.areas.map((area) =>
        area.requirements.length === 0 ? null : (
          <LeftGroup key={area.area} id={area.area} title={area.title} summary={areaSummary(area.requirements)} open={open[area.area]} onToggle={onToggle}>
            {area.requirements.map((requirement) => (
              <RequirementRow key={requirement.key} requirement={requirement} selected={selectedKey === requirement.key} onOpen={onOpen} />
            ))}
          </LeftGroup>
        ),
      )}
      {degree.advisor.length > 0 ? (
        <LeftGroup id="advisor" title={advisorLabel(degree.advisor.length)} summary={null} open={open.advisor} onToggle={onToggle}>
          {degree.advisor.map((item) => (
            <AdvisorRow key={item.key} item={item} selected={selectedKey === item.key} onOpen={onOpen} />
          ))}
        </LeftGroup>
      ) : null}
    </>
  );
}

function LeftGroup({ id, title, summary, open, onToggle, children }: { id: LeftGroupKey; title: string; summary: string | null; open: boolean; onToggle: (key: LeftGroupKey) => void; children: ReactNode }) {
  const headId = `left-${id}`;
  return (
    <section className={styles.group} aria-labelledby={headId} data-open={open}>
      <h2 className={styles.groupHeading}>
        <button id={headId} type="button" className={styles.groupHead} aria-expanded={open} onClick={() => onToggle(id)}>
          <span className={styles.leftHeadText}>
            <span>{title}</span>
            {/* A closed area says what is left; an open one shows it. */}
            {open || summary === null ? null : (
              <span className={styles.count}>
                <span className={styles.srOnly}>, </span>
                {summary}
              </span>
            )}
          </span>
          <ChevronDown size={16} className={styles.chev} />
        </button>
      </h2>
      {open ? <ul className={styles.rows}>{children}</ul> : null}
    </section>
  );
}

const RequirementRow = memo(function RequirementRow({ requirement, selected, onOpen }: { requirement: Requirement; selected: boolean; onOpen: (key: string) => void }) {
  const glyph = requirement.status === "inProgress" ? <StatusGlyph status="taking" /> : null;
  return (
    <li className={styles.row} data-kind="requirement" data-requirement={requirement.status} data-selected={selected || undefined}>
      <button type="button" className={styles.reqOpen} data-row-open={`${REQUIREMENT_PREFIX}${requirement.key}`} aria-current={selected || undefined} onClick={() => onOpen(requirement.key)}>
        <span className={styles.lead} aria-hidden="true">
          {glyph}
        </span>
        <span className={styles.reqName}>{requirement.name}</span>
        <span className={styles.fact}>
          <span className={styles.srOnly}>, </span>
          {requirement.fact}
        </span>
      </button>
    </li>
  );
});

const AdvisorRow = memo(function AdvisorRow({ item, selected, onOpen }: { item: AdvisorItem; selected: boolean; onOpen: (key: string) => void }) {
  return (
    <li className={styles.row} data-kind="requirement" data-requirement="advisor" data-selected={selected || undefined}>
      <button type="button" className={styles.reqOpen} data-row-open={`${REQUIREMENT_PREFIX}${item.key}`} aria-current={selected || undefined} onClick={() => onOpen(item.key)}>
        <span className={styles.lead} aria-hidden="true">
          <StatusGlyph status="check" />
        </span>
        <span className={styles.reqName}>{item.name}</span>
        <span className={styles.reqReason}>
          <span className={styles.srOnly}>, </span>
          {item.text}
        </span>
      </button>
    </li>
  );
});
