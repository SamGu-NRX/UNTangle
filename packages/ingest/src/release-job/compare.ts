/**
 * Step 3 of "Reference data: published releases"
 * (docs/architecture/README.md): compare a candidate release with the last
 * good one, and refuse to publish one that looks broken.
 *
 * The diff is a report, not a patch: sections added and removed, and changes
 * to status, instructor, room, time, dates and seats. The sanity checks are
 * deliberately coarse: a scrape that lost a fifth of its courses, a term with
 * no sections, or a course the parser could not read that parsed last time
 * means the release is suspect, and the last good one stays published.
 */

import type { ComponentRecord, Fact, SectionRelease, SectionRecord } from "../section-release";

export type ChangeKind = "status" | "instructor" | "room" | "time" | "dates" | "seats" | "components";

export type SectionChange = {
  courseCode: string;
  optionId: string;
  sectionCode: string;
  /** The component whose fact changed, or null for an option-level fact. */
  component: string | null;
  kind: ChangeKind;
  before: string;
  after: string;
};

export type ReleaseDiff = {
  coursesAdded: string[];
  coursesRemoved: string[];
  sectionsAdded: string[];
  sectionsRemoved: string[];
  changes: SectionChange[];
  /** One line: "2 courses added, 1 removed, 3 sections changed". Empty when identical. */
  summary: string;
};

export function diffReleases(previous: SectionRelease, next: SectionRelease): ReleaseDiff {
  const previousCourses = new Map(previous.courses.map(course => [course.courseCode, course]));
  const nextCourses = new Map(next.courses.map(course => [course.courseCode, course]));
  const coursesAdded = [...nextCourses.keys()].filter(code => !previousCourses.has(code)).sort();
  const coursesRemoved = [...previousCourses.keys()].filter(code => !nextCourses.has(code)).sort();

  const previousSections = new Map(previous.courses.flatMap(course => courseSections(course)).map(section => [section.optionId, section]));
  const nextSections = new Map(next.courses.flatMap(course => courseSections(course)).map(section => [section.optionId, section]));
  const sectionsAdded = [...nextSections.keys()].filter(id => !previousSections.has(id)).sort();
  const sectionsRemoved = [...previousSections.keys()].filter(id => !nextSections.has(id)).sort();

  const changes: SectionChange[] = [];
  for (const [optionId, nextSection] of nextSections) {
    const previousSection = previousSections.get(optionId);
    if (!previousSection) continue;
    changes.push(...diffSection(previousSection, nextSection));
  }

  const parts: string[] = [];
  if (coursesAdded.length) parts.push(`${coursesAdded.length} course${plural(coursesAdded)} added`);
  if (coursesRemoved.length) parts.push(`${coursesRemoved.length} course${plural(coursesRemoved)} removed`);
  if (sectionsAdded.length) parts.push(`${sectionsAdded.length} section${plural(sectionsAdded)} added`);
  if (sectionsRemoved.length) parts.push(`${sectionsRemoved.length} section${plural(sectionsRemoved)} removed`);
  if (changes.length) parts.push(`${changes.length} change${plural(changes)} to existing sections`);

  return { coursesAdded, coursesRemoved, sectionsAdded, sectionsRemoved, changes, summary: parts.join(", ") };
}

function plural(list: readonly unknown[]): string {
  return list.length === 1 ? "" : "s";
}

function courseSections(course: SectionRelease["courses"][number]): SectionRecord[] {
  return course.availability === "sections" ? course.sections : [];
}

function diffSection(previous: SectionRecord, next: SectionRecord): SectionChange[] {
  const changes: SectionChange[] = [];
  const push = (kind: ChangeKind, component: string | null, before: string, after: string) => {
    changes.push({ courseCode: nextCourseCode(previous, next), optionId: previous.optionId, sectionCode: previous.sectionCode, component, kind, before, after });
  };

  const previousComponents = new Map(previous.components.map(component => [component.classNumber, component]));
  const nextComponents = new Map(next.components.map(component => [component.classNumber, component]));
  if (previousComponents.size !== nextComponents.size || [...previousComponents.keys()].some(id => !nextComponents.has(id))) {
    push("components", null, componentList(previous.components), componentList(next.components));
    return changes;
  }

  if (!factEqual(previous.status, next.status)) push("status", null, factText(previous.status), factText(next.status));
  if (!factEqual(previous.dates, next.dates)) push("dates", null, factText(previous.dates), factText(next.dates));
  for (const [classNumber, previousComponent] of previousComponents) {
    const nextComponent = nextComponents.get(classNumber) as ComponentRecord;
    if (!factEqual(previousComponent.instructor, nextComponent.instructor)) {
      push("instructor", classNumber, factText(previousComponent.instructor), factText(nextComponent.instructor));
    }
    if (!factEqual(previousComponent.openSeats, nextComponent.openSeats) || !factEqual(previousComponent.totalSeats, nextComponent.totalSeats)) {
      push("seats", classNumber, seatText(previousComponent), seatText(nextComponent));
    }
    const previousMeetings = meetingText(previousComponent);
    const nextMeetings = meetingText(nextComponent);
    if (previousMeetings !== nextMeetings) push("time", classNumber, previousMeetings, nextMeetings);
  }
  return changes;
}

function nextCourseCode(previous: SectionRecord, next: SectionRecord): string {
  // optionId is `vsb:<term>:<course>:<class numbers>`; both records share it.
  const code = previous.optionId.split(":")[2];
  return code ?? next.optionId.split(":")[2] ?? "";
}

function componentList(components: ComponentRecord[]): string {
  return components.map(component => component.classNumber).join("+") || "none";
}

function seatText(component: ComponentRecord): string {
  return `${factText(component.openSeats)} of ${factText(component.totalSeats)} open`;
}

/** Meetings as one stable line, so any day, time, room or date change shows here. */
function meetingText(component: ComponentRecord): string {
  return component.meetings
    .map(meeting => [factText(meeting.day), factText(meeting.startMinutes), factText(meeting.endMinutes), factText(meeting.room), factText(meeting.dates)].join(" "))
    .join("; ") || "no meetings";
}

function factText(fact: Fact<unknown>): string {
  return fact.state === "known" ? String(fact.value) : `unknown${fact.raw === null ? "" : ` (${fact.raw})`}`;
}

function factEqual(a: Fact<unknown>, b: Fact<unknown>): boolean {
  if (a.state !== b.state) return false;
  return a.state === "known" ? JSON.stringify(a.value) === JSON.stringify((b as typeof a).value) : a.raw === (b as typeof a).raw;
}

export type SanityResult = { ok: true } | { ok: false; check: string; detail: string };

/**
 * Refuses a release that looks broken. `previous` is null for a first
 * release, which only the file-level checks cover: a first release with no
 * sections, or with any course the parser failed on, is refused too, since
 * the mirror's own coverage claim cannot vouch for what we failed to read.
 */
export function sanityCheck(previous: SectionRelease | null, next: SectionRelease): SanityResult {
  if (next.manifest.counts.courses === 0) {
    return { ok: false, check: "empty", detail: "the release has no courses at all" };
  }
  if (next.manifest.counts.coursesWithSections === 0 && (previous === null || previous.manifest.counts.coursesWithSections > 0)) {
    return { ok: false, check: "no-sections", detail: "no course has any enrollment option" };
  }
  if (next.manifest.counts.invalidCourses > 0 && (previous === null || next.manifest.counts.invalidCourses > previous.manifest.counts.invalidCourses)) {
    return {
      ok: false,
      check: "parser-failure",
      detail: `${next.manifest.counts.invalidCourses} course(s) failed to parse versus ${previous?.manifest.counts.invalidCourses ?? 0} in the last good release`,
    };
  }
  if (previous !== null && previous.manifest.counts.courses > 0) {
    const drop = (previous.manifest.counts.courses - next.manifest.counts.courses) / previous.manifest.counts.courses;
    if (drop > 0.2) {
      return {
        ok: false,
        check: "course-count-drop",
        detail: `${next.manifest.counts.courses} courses versus ${previous.manifest.counts.courses} in the last good release: a ${(drop * 100).toFixed(1)}% drop, over the 20% limit`,
      };
    }
  }
  return { ok: true };
}
