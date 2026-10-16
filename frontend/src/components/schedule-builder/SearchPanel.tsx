"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { ChevronDown } from "@/components/ui/icons";
import { SearchField } from "@/components/ui/SearchField";
import { StatusGlyph } from "@/components/ui/StatusGlyph";
import type { Day, Section } from "@/lib/sections";
import { hasOpenSeats } from "@/lib/sections/open-seats";
import styles from "./builder.module.css";
import { isTimed } from "./conflicts";
import type { BuilderHost, SearchHit } from "./host";
import { SectionRows } from "./SectionRows";

const STATUS_NAME: Record<NonNullable<SearchHit["status"]>, string> = {
  available: "you can take this",
  planned: "planned",
  check: "check with an advisor",
  locked: "locked",
  taking: "taking now",
  done: "done",
};

/**
 * myUNT class numbers have four or five digits. Four digits can also be a
 * course number ("2110"), so a four-digit query is looked up as a class
 * number only when no course matches it.
 */
export const CLASS_NUMBER = /^\d{4,5}$/;

const DAYS: readonly Day[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const LEVELS = ["1000", "2000", "3000", "4000"] as const;
type Format = "in-person" | "online";

type Filters = { openSeats: boolean; days: Day[]; formats: Format[]; levels: string[] };
const NO_FILTERS: Filters = { openSeats: false, days: [...DAYS], formats: ["in-person", "online"], levels: [] };

function sectionPasses(section: Section, filters: Filters): boolean {
  if (filters.openSeats && !hasOpenSeats(section)) return false;
  // A section with no set time is online only when its meetings are; an in-person TBA section stays in person.
  if (!filters.formats.includes(section.online ? "online" : "in-person")) return false;
  // Weekends have no chip, so only the weekdays a chip turns off can hide a section.
  return section.meetings.filter(isTimed).every((meeting) => !DAYS.includes(meeting.day) || filters.days.includes(meeting.day));
}

/** "1000" to "4000"; graduate numbers count as 4000+. */
const levelOf = (code: string) => `${Math.min(4, Number(code.split(" ")[1]?.[0] ?? 0))}000`;
const isDefault = (filters: Filters) => JSON.stringify(filters) === JSON.stringify(NO_FILTERS);

type Props = {
  host: BuilderHost;
  query: string;
  onQuery: (query: string) => void;
  /** Sections on the week, for clash checks. */
  week: readonly Section[];
  onPlace: (section: Section, overlaps: string[], fromKeyboard: boolean) => void;
  onPreview: (section: Section | null) => void;
  autoFocus: boolean;
};

type Lookup = { number: string; state: "looking" | "found" | "none" | "failed"; courseCode?: string; sectionId?: string };

/**
 * Find courses (DESIGN.md §4.3): a search over codes, titles and class
 * numbers; a result opens in place into its sections, each one tap from
 * the week, with a clash shown before the tap.
 */
export function SearchPanel({ host, query, onQuery, week, onPlace, onPreview, autoFocus }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const trimmed = query.trim();
  const courseHits = trimmed ? host.search.find(trimmed) : null;
  const number = CLASS_NUMBER.test(trimmed) && (trimmed.length === 5 || courseHits?.length === 0) ? trimmed : null;

  useEffect(() => {
    if (autoFocus) input.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const open = lookup?.state === "found" && lookup.number === number ? (lookup.courseCode ?? null) : expanded;
  const { load } = host.search;
  useEffect(() => {
    if (open) load([open]);
  }, [load, open]);

  useEffect(() => {
    if (!number) return;
    let live = true;
    host.search.classNumber(number).then(
      (hit) => live && setLookup(hit ? { number, state: "found", ...hit } : { number, state: "none" }),
      () => live && setLookup({ number, state: "failed" }),
    );
    return () => {
      live = false;
    };
  }, [host.search, number]);
  const found = number && lookup?.number === number ? lookup : number ? { number, state: "looking" as const } : null;

  const hits: SearchHit[] = found
    ? found.state === "found" && found.courseCode
      ? host.search.find(found.courseCode).filter((hit) => hit.code === found.courseCode).slice(0, 1)
      : []
    : (courseHits ?? host.search.suggestions());
  const shown = hits.filter((hit) => filters.levels.length === 0 || filters.levels.includes(levelOf(hit.code)));
  const onWeek = new Map(host.courses.map((course) => [course.code, course.section?.id ?? null]));
  const filtered = !isDefault(filters);

  return (
    <div className={styles.find}>
      <SearchField
        ref={input}
        label="Search courses"
        placeholder="Code, title or class number"
        value={query}
        onChange={(event) => {
          onQuery(event.target.value);
          setExpanded(null);
        }}
        onClear={() => onQuery("")}
        inputMode="search"
        autoComplete="off"
        enterKeyHint="search"
      />
      <div className={styles.chips}>
        <Chip size="sm" selected={filters.openSeats} onSelectedChange={(on) => setFilters({ ...filters, openSeats: on })}>
          Open seats
        </Chip>
        <Button variant="quiet" size="sm" aria-expanded={filtersOpen} aria-controls="builder-filters" onClick={() => setFiltersOpen(!filtersOpen)}>
          {filtered ? "Filters on" : "Filters"}
          <ChevronDown size={14} className={styles.chevron} />
        </Button>
      </div>
      <div id="builder-filters" className={styles.filters} hidden={!filtersOpen}>
        <div role="group" aria-label="Days" className={styles.filterRow}>
          <span className={styles.label} aria-hidden="true">
            Days
          </span>
          {DAYS.map((day) => (
            <Chip
              key={day}
              size="sm"
              selected={filters.days.includes(day)}
              onSelectedChange={(on) => setFilters({ ...filters, days: on ? DAYS.filter((d) => d === day || filters.days.includes(d)) : filters.days.filter((d) => d !== day) })}
            >
              {day}
            </Chip>
          ))}
        </div>
        <div role="group" aria-label="Format" className={styles.filterRow}>
          <span className={styles.label} aria-hidden="true">
            Format
          </span>
          {(["in-person", "online"] as const).map((format) => (
            <Chip
              key={format}
              size="sm"
              selected={filters.formats.includes(format)}
              onSelectedChange={(on) => setFilters({ ...filters, formats: on ? [...filters.formats, format] : filters.formats.filter((f) => f !== format) })}
            >
              {format === "online" ? "Online" : "In person"}
            </Chip>
          ))}
        </div>
        <div role="group" aria-label="Level" className={styles.filterRow}>
          <span className={styles.label} aria-hidden="true">
            Level
          </span>
          {LEVELS.map((level) => (
            <Chip
              key={level}
              size="sm"
              selected={filters.levels.includes(level)}
              onSelectedChange={(on) => setFilters({ ...filters, levels: on ? [...filters.levels, level] : filters.levels.filter((l) => l !== level) })}
            >
              {level === "4000" ? "4000+" : level}
            </Chip>
          ))}
        </div>
      </div>

      <div className={styles.results} aria-live="polite" aria-busy={found?.state === "looking"}>
        {found?.state === "looking" ? <p className={styles.hint}>Looking up class {found.number}.</p> : null}
        {found?.state === "none" ? <p className={styles.hint}>No {host.term.label} section has class number {found.number}.</p> : null}
        {found?.state === "failed" ? <p className={styles.hint}>Class numbers can&rsquo;t be checked right now. Search by course code instead.</p> : null}
        {found?.state === "found" && shown.length === 0 ? (
          <p className={styles.hint}>Class {found.number} is {found.courseCode}, which isn&rsquo;t in this course list.</p>
        ) : null}
        {!found && trimmed && shown.length === 0 ? <p className={styles.hint}>No course matches &ldquo;{trimmed}&rdquo;. Try a department code like CSCE.</p> : null}
        {!found && !trimmed && shown.length === 0 ? <p className={styles.hint}>Try a course code, a title or a class number.</p> : null}
        {!found && !trimmed && shown.length > 0 ? <p className={`${styles.label} ${styles.group}`}>You can take</p> : null}
        <ul className={styles.courses}>
          {shown.map((hit) => {
            const isOpen = open === hit.code;
            const options = isOpen ? host.search.options(hit.code) : null;
            const visible = options?.filter((section) => sectionPasses(section, filters)) ?? null;
            return (
              <li key={hit.code}>
                <button
                  type="button"
                  className={styles.course}
                  aria-expanded={isOpen}
                  onClick={() => setExpanded(isOpen ? null : hit.code)}
                >
                  {hit.status ? (
                    <span aria-hidden="true">
                      <StatusGlyph status={hit.status} />
                    </span>
                  ) : null}
                  <span className={styles.courseText}>
                    <span className={styles.code}>{hit.code}</span>
                    <span className={styles.courseTitle}>{hit.title}</span>
                  </span>
                  {/* The code comes first in the name; the status follows it. */}
                  {hit.status ? <span className="sr-only-v2">, {STATUS_NAME[hit.status]}</span> : null}
                  <ChevronDown size={16} className={styles.chevron} />
                </button>
                {isOpen ? (
                  <div className={styles.courseSections}>
                    {options === null ? (
                      <p className={styles.hint}>Loading sections.</p>
                    ) : visible && visible.length === 0 && options.length > 0 ? (
                      <p className={styles.hint}>
                        {filtered ? "No section matches these filters." : "No sections this term."}
                      </p>
                    ) : (
                      <>
                        {/* Samples (term null) stand in when the term's sections can't be loaded; say so before one is picked. */}
                        {options.some((section) => section.term === null) ? (
                          <p className={styles.hint}>
                            <strong>Sample sections.</strong> These times, rooms and instructors are made up for planning. Real {host.term.label}{" "}
                            sections replace them when UNT&rsquo;s class schedule loads.
                          </p>
                        ) : null}
                        <SectionRows
                          courseCode={hit.code}
                          sections={visible ?? []}
                          week={week}
                          currentId={onWeek.get(hit.code) ?? null}
                          verb="add"
                          highlightId={found?.state === "found" ? found.sectionId : null}
                          onPlace={onPlace}
                          onPreview={onPreview}
                        />
                      </>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
