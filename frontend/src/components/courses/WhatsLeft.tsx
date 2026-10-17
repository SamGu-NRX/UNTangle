"use client";

import { memo, type ReactNode } from "react";
import { ChevronDown } from "@/components/ui/icons";
import { StatusGlyph } from "@/components/ui/StatusGlyph";
import styles from "./courses.module.css";
import type { AdvisorItem, AuditedDegree, Requirement } from "./model/degree";
import { leftHeadline, leftNotes } from "./model/left-copy";

export type LeftGroupKey = "major" | "core" | "advisor";
export const LEFT_OPEN_AT_START: Readonly<Record<LeftGroupKey, boolean>> = { major: true, core: true, advisor: true };

/** A requirement row opens its detail; the key is prefixed so it never collides with a course code. */
export const REQUIREMENT_PREFIX = "req:";

type Props = {
  degree: AuditedDegree;
  open: Readonly<Record<LeftGroupKey, boolean>>;
  onToggle: (key: LeftGroupKey) => void;
  selectedKey: string | null;
  onOpen: (key: string) => void;
};

/**
 * The first answer on Courses for a major the degree audit covers: how many
 * credits are left, then what is left by area (the major, the University
 * Core), then what only an advisor can settle, each as rows that open their
 * detail with the catalog's reason. Groups open and close at once, like the
 * course groups below (MOTION.md §7).
 */
export function WhatsLeft({ degree, open, onToggle, selectedKey, onOpen }: Props) {
  const groups: { key: LeftGroupKey; title: string; requirements: Requirement[] }[] = degree.areas.map((area) => ({ key: area.area, title: area.title, requirements: area.requirements }));
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
      {groups.map((group) =>
        group.requirements.length === 0 ? null : (
          <LeftGroup key={group.key} id={group.key} title={group.title} count={group.requirements.length} open={open[group.key]} onToggle={onToggle}>
            {group.requirements.map((requirement) => (
              <RequirementRow key={requirement.key} requirement={requirement} selected={selectedKey === requirement.key} onOpen={onOpen} />
            ))}
          </LeftGroup>
        ),
      )}
      {degree.advisor.length > 0 ? (
        // Never counted: each item is a question to ask, not a tally to shrink.
        <LeftGroup id="advisor" title="Check with an advisor" count={null} open={open.advisor} onToggle={onToggle}>
          {degree.advisor.map((item) => (
            <AdvisorRow key={item.key} item={item} selected={selectedKey === item.key} onOpen={onOpen} />
          ))}
        </LeftGroup>
      ) : null}
    </section>
  );
}

function LeftGroup({ id, title, count, open, onToggle, children }: { id: LeftGroupKey; title: string; count: number | null; open: boolean; onToggle: (key: LeftGroupKey) => void; children: ReactNode }) {
  const headId = `left-${id}`;
  return (
    <section className={styles.leftGroup} aria-labelledby={headId} data-open={open}>
      <h3 className={styles.groupHeading}>
        <button id={headId} type="button" className={styles.groupHead} aria-expanded={open} onClick={() => onToggle(id)}>
          <span>{title}</span>
          {open || count === null ? null : <span className={styles.count}>{count}</span>}
          <ChevronDown size={16} className={styles.chev} />
        </button>
      </h3>
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
