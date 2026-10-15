"use client";

import { createContext, useContext, type ReactNode } from "react";
import styles from "./courses.module.css";
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
 * A course code that opens the detail. A code the catalog does not carry
 * stays plain text with an explanation, so following it can never empty the
 * detail.
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
      className={styles.courseLink}
      href={courseHref(id)}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
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
