"use client";

import { createContext, useContext, type ReactNode } from "react";
import styles from "./courses.module.css";
import type { RowStatus } from "./model/course-model";
import { ruleTokens, type RuleNode } from "./model/rules";

export type CourseNavigation = {
  open: (id: string) => void;
  /** Courses the view can open. Rules name courses outside the bundled catalog (CSCE 3010). */
  isKnown: (id: string) => boolean;
};

export const CourseNavigationContext = createContext<CourseNavigation>({ open: () => {}, isKnown: () => false });

export function courseHref(id: string): string {
  const [subject, number] = id.split(" ");
  return `/courses/${encodeURIComponent(subject)}/${encodeURIComponent(number ?? "")}`;
}

/**
 * Covered and Check have no glyph in ui/StatusGlyph (it draws the five
 * DESIGN.md states), so the Courses view keeps this one with all seven.
 */
export function StatusGlyph({ status }: { status: RowStatus }) {
  return <span className={styles.glyph} data-status={status} aria-hidden="true" />;
}

/**
 * A course code that opens the panel. A code the catalog does not carry stays
 * plain text with an explanation, so following it can never empty the panel.
 */
export function CourseLink({ id, children }: { id: string; children?: ReactNode }) {
  const { open, isKnown } = useContext(CourseNavigationContext);
  if (!isKnown(id)) {
    return (
      <span className={styles.unknownCourse} title={`${id} is not in UNTangle's catalog yet.`}>
        {children ?? id}
      </span>
    );
  }
  return (
    <a
      className={styles.link}
      href={courseHref(id)}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        open(id);
      }}
    >
      {children ?? id}
    </a>
  );
}

export function RuleText({ rule, grades = true }: { rule: RuleNode | null; grades?: boolean }) {
  const tokens = ruleTokens(rule, false, { grades });
  return (
    <>
      {tokens.map((token, index) =>
        token.kind === "course" ? (
          <CourseLink key={index} id={token.id} />
        ) : token.kind === "unparsed" ? (
          <q key={index}>{token.text}</q>
        ) : (
          <span key={index}>{token.text}</span>
        ),
      )}
    </>
  );
}
