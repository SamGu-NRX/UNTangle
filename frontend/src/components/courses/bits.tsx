"use client";

import { createContext, useContext, type ReactNode } from "react";
import styles from "./courses.module.css";
import type { RowStatus } from "./model/course-model";
import { ruleTokens, type RuleNode } from "./model/rules";

/** Opens a course in the detail panel; links fall back to the deep-link URL. */
export const OpenCourseContext = createContext<(id: string) => void>(() => {});

export function courseHref(id: string): string {
  const [subject, number] = id.split(" ");
  return `/courses/${encodeURIComponent(subject)}/${encodeURIComponent(number ?? "")}`;
}

export function StatusGlyph({ status }: { status: RowStatus }) {
  return <span className={styles.glyph} data-status={status} aria-hidden="true" />;
}

export function CourseLink({ id, children }: { id: string; children?: ReactNode }) {
  const open = useContext(OpenCourseContext);
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

export function ProvenanceTag({ children, title }: { children: ReactNode; title: string }) {
  return (
    <span className={styles.tag} title={title}>
      {children}
      <span className={styles.srOnly}>: {title}</span>
    </span>
  );
}

export const SearchIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5 14 14" strokeLinecap="round" />
  </svg>
);

export const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" stroke="currentColor" strokeWidth="1.6" fill="none" aria-hidden="true">
    <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
  </svg>
);
