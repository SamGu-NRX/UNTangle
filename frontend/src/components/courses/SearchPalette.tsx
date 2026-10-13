"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./courses.module.css";
import { CloseIcon, SearchIcon } from "./bits";
import { useFocusTrap } from "./hooks";
import { statusLabels, type CourseRowModel } from "./model/course-model";
import { onlyCheckable, ruleCourseIds } from "./model/rules";
import { searchCatalog, type SearchCourse, type SearchInstructor } from "./model/search";

type Item = { kind: "course"; id: string; title: string } | { kind: "instructor"; name: string; courseIds: string[] };

function rowSummary(row: CourseRowModel | undefined): string {
  if (!row) return "";
  const label = statusLabels[row.status];
  if (row.status === "locked" || row.status === "check") {
    const needs = ruleCourseIds(onlyCheckable(row.unmet));
    return needs.length > 0 ? `${label} · needs ${needs.slice(0, 2).join(", ")}` : label;
  }
  return label;
}

/**
 * ⌘K. Opens and closes with no animation: it is summoned from the keyboard
 * many times a session. Enter opens the course; ⌘/Ctrl+Enter plans or
 * unplans it and keeps the palette open.
 */
type PaletteProps = {
  open: boolean;
  onClose: () => void;
  className: string;
  courses: readonly SearchCourse[];
  instructors: readonly SearchInstructor[];
  rows: ReadonlyMap<string, CourseRowModel>;
  onOpenCourse: (id: string, instructor?: string) => void;
  /** Returns the sentence to announce. */
  onTogglePlan: (id: string) => string;
};

/** Mounted only while open, so each opening starts with an empty query. */
export function SearchPalette(props: PaletteProps) {
  return props.open ? <PaletteBody {...props} /> : null;
}

function PaletteBody({
  onClose,
  className,
  courses,
  instructors,
  rows,
  onOpenCourse,
  onTogglePlan,
}: PaletteProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [announcement, setAnnouncement] = useState("");

  const results = useMemo(() => searchCatalog(query, courses, instructors), [query, courses, instructors]);
  const items: Item[] = useMemo(
    () => [
      ...results.courses.map((course) => ({ kind: "course" as const, id: course.id, title: course.title })),
      ...results.instructors.map((instructor) => ({ kind: "instructor" as const, ...instructor })),
    ],
    [results],
  );

  const dialogRef = useRef<HTMLDivElement>(null);
  // Declared before the focus effect so the trap records the opener, not the input.
  useFocusTrap(dialogRef, true);
  useEffect(() => {
    inputRef.current?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    document.getElementById(`${id}-item-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, id]);

  const activate = (item: Item | undefined) => {
    if (!item) return;
    if (item.kind === "course") onOpenCourse(item.id);
    else onOpenCourse(item.courseIds[0], item.name);
    onClose();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const item = items[active];
      if ((event.metaKey || event.ctrlKey) && item?.kind === "course") setAnnouncement(onTogglePlan(item.id));
      else activate(item);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  const listId = `${id}-list`;
  const courseCount = results.courses.length;
  const renderItem = (item: Item, index: number) => (
    <div
      key={item.kind === "course" ? item.id : `i:${item.name}`}
      id={`${id}-item-${index}`}
      role="option"
      aria-selected={index === active}
      data-active={index === active}
      className={styles.palItem}
      onPointerMove={() => setActive(index)}
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => activate(item)}
    >
      {item.kind === "course" ? (
        <>
          <span className={styles.code}>{item.id}</span>
          <span>{item.title}</span>
          <span className={styles.meta}>{rowSummary(rows.get(item.id))}</span>
        </>
      ) : (
        <>
          <span style={{ fontWeight: 500 }}>{item.name}</span>
          <span className={styles.meta}>{item.courseIds.slice(0, 3).join(" · ")}</span>
          <span />
        </>
      )}
    </div>
  );

  return createPortal(
    <div className={className}>
      <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
      <div ref={dialogRef} className={styles.palette} role="dialog" aria-modal="true" aria-label="Search courses">
        <div className={styles.palIn}>
          <SearchIcon size={18} />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label="Search courses and instructors"
            aria-expanded={items.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={items.length > 0 ? `${id}-item-${active}` : undefined}
            placeholder="Course code, title or instructor"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <kbd className={`${styles.kbd} ${styles.desktopOnly}`}>esc</kbd>
          <button type="button" className={`${styles.btn} ${styles.iconBtn} ${styles.phoneOnly}`} aria-label="Close search" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className={styles.palList}>
          {query.trim() === "" ? (
            <p className={styles.palHint}>Type a course code like 1030, a title, or an instructor.</p>
          ) : items.length === 0 ? (
            <p className={styles.palHint}>Nothing matches “{query.trim()}”.</p>
          ) : null}
          <div id={listId} role="listbox" aria-label="Results">
            {courseCount > 0 ? (
              <div role="group" aria-labelledby={`${id}-courses`}>
                <div className={styles.palSec} id={`${id}-courses`} role="presentation">
                  Courses
                </div>
                {items.slice(0, courseCount).map((item, index) => renderItem(item, index))}
              </div>
            ) : null}
            {items.length > courseCount ? (
              <div role="group" aria-labelledby={`${id}-instructors`}>
                <div className={styles.palSec} id={`${id}-instructors`} role="presentation">
                  Instructors
                </div>
                {items.slice(courseCount).map((item, index) => renderItem(item, courseCount + index))}
              </div>
            ) : null}
          </div>
        </div>
        <div className={styles.palFoot} aria-hidden="true">
          <span>
            <kbd className={styles.kbd}>↑</kbd>
            <kbd className={styles.kbd}>↓</kbd> move
          </span>
          <span>
            <kbd className={styles.kbd}>↵</kbd> open
          </span>
          <span>
            <kbd className={styles.kbd}>⌘</kbd>
            <kbd className={styles.kbd}>↵</kbd> plan / unplan
          </span>
        </div>
        <p className={styles.srOnly} role="status" aria-live="polite">
          {announcement}
        </p>
      </div>
    </div>,
    document.body,
  );
}
