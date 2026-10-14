"use client";

import { useState, type MouseEvent } from "react";
import { SectionsTag, summarizeProvenance } from "@/components/sections-provenance";
import { Check, Plus } from "@/components/ui/icons";
import { Plate } from "@/components/ui/Plate";
import type { Hue } from "@/lib/course-colors";
import { meetingsConflict, optionLabel, rangeLabel, sampleOption, type CourseOptions } from "@/lib/planner-sections";
import type { Day, Meeting, Section } from "@/lib/sections";
import styles from "./courses.module.css";

/** A planned section on the mini week, with its course's color. */
export type PlacedSection = { section: Section; hue: Hue | undefined };

type Props = {
  courseId: string;
  term: string;
  options: CourseOptions;
  /** Every planned course's section, this course's included. */
  placed: readonly PlacedSection[];
  /** The plan's pick for this course, when it is planned. */
  chosenId: string | undefined;
  /** False for courses that cannot be added (locked, done, taking). */
  canAdd: boolean;
  onAdd: (sectionId: string, event: MouseEvent) => void;
  /** Average GPA by instructor display name, from the grade records; absent when there are none. */
  gpaOf: (instructor: string) => number | null;
};

const WEEK: readonly Day[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const LETTER: Record<Day, string> = { Mon: "M", Tue: "T", Wed: "W", Thu: "R", Fri: "F", Sat: "S", Sun: "U" };
const DAY_NAME: Record<Day, string> = { Mon: "Mon", Tue: "Tue", Wed: "Wed", Thu: "Thu", Fri: "Fri", Sat: "Sat", Sun: "Sun" };
/** Sections shown before "Show all". Starting value, matching the mockup's four rows. */
const FIRST_SECTIONS = 4;

type Timed = Meeting & { day: Day; startMinutes: number; endMinutes: number };
const timed = (meeting: Meeting): meeting is Timed => meeting.day !== null && meeting.startMinutes !== null && meeting.endMinutes !== null;

function clock(minutes: number) {
  const hours = Math.floor(minutes / 60);
  return `${hours % 12 === 0 ? 12 : hours % 12}:${String(minutes % 60).padStart(2, "0")}`;
}

/** "MWF 10:00–10:50", one pattern per distinct time; "Online, no set time" without one. */
function when(section: Section): string {
  const patterns = new Map<string, Day[]>();
  for (const meeting of section.meetings.filter(timed)) {
    const key = `${clock(meeting.startMinutes)}–${clock(meeting.endMinutes)}`;
    patterns.set(key, [...(patterns.get(key) ?? []), meeting.day]);
  }
  if (patterns.size === 0) return section.online || section.async ? "Online, no set time" : "Time to be announced";
  return [...patterns].map(([time, days]) => `${[...new Set(days)].map((day) => LETTER[day]).join("")} ${time}`).join(" and ");
}

/** "18 open", "Full", "Wait list". Samples have no seats. */
function seats(section: Section): { text: string; full: boolean } | null {
  if (section.term === null) return null;
  switch (section.status) {
    case "open":
      return { text: section.seats.open !== null ? `${section.seats.open} open` : "Open", full: false };
    case "waitlist":
      return { text: "Wait list", full: false };
    case "closed":
      return { text: "Full", full: true };
    case "cancelled":
      return { text: "Cancelled", full: true };
    default:
      return { text: section.rawStatus, full: false };
  }
}

/**
 * "GAB 535" -> "535". A location that is a building name ("Life Sciences
 * Complex", as the samples have) has no room number, so nothing shows after the plate.
 */
export function roomNumber(meeting: Pick<Meeting, "room" | "buildingCode">): string | undefined {
  const [first, ...rest] = meeting.room.trim().split(/\s+/);
  const room = rest.join(" ");
  return meeting.buildingCode && first?.toUpperCase() === meeting.buildingCode && /\d/.test(room) ? room : undefined;
}

const joinDays = (days: string[]) => (days.length <= 1 ? days.join("") : `${days.slice(0, -1).join(", ")} and ${days.at(-1)}`);

/** "Overlaps MATH 2700 on Mon, Wed and Fri", naming the first course it overlaps. */
function overlap(section: Section, others: readonly Section[]): string | null {
  for (const other of others) {
    const days = new Set<Day>();
    for (const mine of section.meetings) {
      if (mine.day && other.meetings.some((theirs) => meetingsConflict(mine, theirs))) days.add(mine.day);
    }
    if (days.size > 0) return `Overlaps ${other.courseCode} on ${joinDays([...days].map((day) => DAY_NAME[day]))}`;
  }
  return null;
}

export function SectionList({ courseId, term, options, placed, chosenId, canAdd, onAdd, gpaOf }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [preview, setPreview] = useState<{ id: string; instant: boolean } | null>(null);

  if (options.status === "loading") {
    return (
      <div aria-busy="true" aria-label={`Loading ${term} sections`}>
        <div className={styles.shimmer} />
        <div className={styles.shimmer} />
      </div>
    );
  }
  const result = options.result;
  const sections = result.sections;
  if (sections.length === 0) {
    return <p className={styles.meta}>{result.availability === "no_classes" ? `Not offered in ${term}.` : "No sections listed for this course."}</p>;
  }

  // An old plan's made-up section, when this course now has real ones: say so, so the student picks a real one.
  const savedSample = chosenId && !sections.some((section) => section.id === chosenId) ? sampleOption(chosenId) : undefined;
  const others = placed.filter((entry) => entry.section.courseCode !== courseId).map((entry) => entry.section);
  const chosen = sections.find((section) => section.id === chosenId);
  // The short list always holds the plan's section, so the chosen one is never hidden.
  const first = sections.slice(0, FIRST_SECTIONS);
  const shown = showAll ? sections : chosen && !first.includes(chosen) ? [...sections.slice(0, FIRST_SECTIONS - 1), chosen] : first;
  const previewed = sections.find((section) => section.id === preview?.id) ?? null;

  return (
    <>
      <MiniWeek
        placed={placed}
        preview={previewed}
        previewClashes={previewed ? overlap(previewed, others) !== null : false}
        instant={preview?.instant ?? false}
      />
      <p className={styles.miniCaption}>
        <span className={styles.finePointer}>Your {term} week. Point at a section to see where it lands.</span>
        <span className={styles.coarsePointer}>Your {term} week. Tap a section to see where it lands.</span>
      </p>
      {savedSample ? (
        <p className={styles.fallback}>
          Your plan has sample section §{optionLabel(savedSample)}, which is made up. Pick a real {term} section below.
        </p>
      ) : null}
      <ul className={styles.sections} aria-label={`Sections of ${courseId}`}>
        {shown.map((section) => {
          const clash = overlap(section, others);
          const seat = seats(section);
          const isChosen = section.id === chosenId;
          const instructor = section.instructor.display;
          const gpa = instructor ? gpaOf(instructor) : null;
          const room = section.meetings.find((meeting) => meeting.buildingCode);
          const label = `§${optionLabel(section)}`;
          return (
            <li
              key={section.id}
              className={styles.section}
              onPointerEnter={(event) => event.pointerType === "mouse" && setPreview({ id: section.id, instant: false })}
              onPointerLeave={(event) => event.pointerType === "mouse" && setPreview((current) => (current?.id === section.id ? null : current))}
              // Focus from the keyboard draws the preview at once (keyboard actions never animate).
              onFocus={(event) => setPreview({ id: section.id, instant: event.target.matches(":focus-visible") })}
            >
              {canAdd ? (
                <button
                  type="button"
                  className={styles.addSection}
                  data-state={isChosen ? "on" : seat?.full ? "full" : clash ? "warn" : undefined}
                  // The chosen one keeps focus (aria-disabled), so a keyboard pick does not drop it.
                  disabled={!isChosen && seat?.full}
                  aria-disabled={isChosen || undefined}
                  aria-label={
                    isChosen
                      ? `${label} is in your plan`
                      : seat?.full
                        ? `${label} is full`
                        : `Add ${label} to ${term}${clash ? `. ${clash}` : ""}`
                  }
                  onClick={(event) => {
                    if (!isChosen) onAdd(section.id, event);
                  }}
                >
                  {isChosen ? <Check size={18} /> : <Plus size={18} />}
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                className={styles.sectionBody}
                onClick={(event) => setPreview({ id: section.id, instant: event.detail === 0 })}
              >
                <span className={styles.sectionWhen}>
                  <span className={styles.sectionCode}>{label}</span>
                  {when(section)}
                </span>
                <span className={styles.sectionWho}>
                  <span>{instructor ?? "Instructor not listed"}</span>
                  {gpa !== null ? (
                    <span className={styles.gpa}>
                      <span className={styles.srOnly}>average grade </span>
                      {gpa.toFixed(2)} GPA
                    </span>
                  ) : null}
                  {room?.buildingCode ? <Plate building={room.buildingCode} room={roomNumber(room)} name={room.buildingName} /> : null}
                </span>
                {section.term !== null && section.session.label !== "Regular Academic Session" && rangeLabel(section.session.dates) ? (
                  // A short session (eight weeks, a late start) changes when the class meets, so it is named.
                  <span className={styles.sectionNote}>{`${section.session.label}, ${rangeLabel(section.session.dates)}`}</span>
                ) : null}
                {clash ? <span className={styles.conflict}>{clash}</span> : null}
              </button>
              <span className={styles.seats} data-full={seat?.full || undefined}>
                {seat?.text}
              </span>
            </li>
          );
        })}
      </ul>
      {sections.length > FIRST_SECTIONS ? (
        <button type="button" className={styles.textButton} onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Show fewer sections" : `Show all ${sections.length} sections`}
        </button>
      ) : null}
      <div className={styles.source}>
        <SectionsTag provenance={summarizeProvenance([result])} compact={false} />
      </div>
    </>
  );
}

/**
 * The plan's week in miniature, Monday to Friday, with the section the
 * student points at drawn on it before they add it: red where it overlaps.
 */
function MiniWeek({
  placed,
  preview,
  previewClashes,
  instant,
}: {
  placed: readonly PlacedSection[];
  preview: Section | null;
  previewClashes: boolean;
  instant: boolean;
}) {
  const blocks = placed.flatMap(({ section, hue }) => section.meetings.filter(timed).map((meeting) => ({ meeting, hue, key: section.id })));
  const ghosts = preview ? preview.meetings.filter(timed) : [];
  const all = [...blocks.map((block) => block.meeting), ...ghosts];
  // 8:00 to 5:00 unless the week runs outside it.
  const start = Math.min(8 * 60, ...all.map((meeting) => Math.floor(meeting.startMinutes / 60) * 60));
  const end = Math.max(17 * 60, ...all.map((meeting) => Math.ceil(meeting.endMinutes / 60) * 60));
  const place = (meeting: Timed) => ({
    top: `${((meeting.startMinutes - start) / (end - start)) * 100}%`,
    height: `${((meeting.endMinutes - meeting.startMinutes) / (end - start)) * 100}%`,
  });
  return (
    <div aria-hidden="true">
      <div className={styles.miniDays}>
        {WEEK.map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className={styles.miniWeek}>
        {WEEK.map((day) => (
          <div key={day}>
            {blocks
              .filter((block) => block.meeting.day === day)
              .map((block, index) => (
                <i key={`${block.key}-${index}`} className={styles.block} data-hue={block.hue} style={place(block.meeting)} />
              ))}
            {ghosts
              .filter((meeting) => meeting.day === day)
              .map((meeting, index) => (
                <i key={`ghost-${index}`} className={styles.ghost} data-clash={previewClashes || undefined} data-instant={instant || undefined} style={place(meeting)} />
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
