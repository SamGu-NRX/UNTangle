/**
 * Deterministic candidate-vs-current comparison for the catalog-ingest
 * pipeline. Everything the report contains is sorted with a stable
 * comparator and formatted with fixed decimal places, so two runs over the
 * same inputs produce byte-identical output and reports diff cleanly.
 */
import type { CandidateBundle, CandidateSection } from "./schema";

export type CurrentMeeting = { buildingId: string | null };
export type CurrentSection = { meetings: CurrentMeeting[] };
export type CurrentCourse = { code: string; prerequisites: string[] };
export type CurrentBuilding = { id: string; name: string; shortName: string };

export type CurrentBundle = {
  buildings: CurrentBuilding[];
  courses: CurrentCourse[];
  sections: CurrentSection[];
};

export type BuildingUsage = { id: string; name: string; meetings: number };

export type CompareReport = {
  counts: {
    current: { courses: number; sections: number; buildings: number };
    candidate: { courses: number; sections: number; buildings: number };
  };
  coursesAdded: string[];
  coursesMissing: string[];
  buildingsUsed: BuildingUsage[];
  currentBuildingsUsed: string[];
  meetingsPerBuilding: { id: string; meetings: number }[];
  onlineShare: { onlineSections: number; totalSections: number; percent: number };
  prereqUnresolved: { course: string; prerequisite: string }[];
  prereqUnresolvedCurrentCount: number;
  term: { id: string; label: string; classesStart: string | null; classesEnd: string | null } | null;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function byString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Lenient reader for the CURRENT seed bundle (whose top-level shape is the
 * shipped seed shape: buildings/courses/sections plus courseStatuses, which
 * this comparison ignores). Unknown keys are tolerated; only recognizable
 * records are read, so a drifted seed degrades to a smaller count rather
 * than a crash.
 */
export function readCurrentBundle(input: unknown): CurrentBundle {
  const bundle: CurrentBundle = { buildings: [], courses: [], sections: [] };
  if (!isPlainObject(input)) return bundle;
  if (Array.isArray(input.buildings)) {
    for (const entry of input.buildings) {
      if (isPlainObject(entry) && typeof entry.id === "string") {
        bundle.buildings.push({
          id: entry.id,
          name: typeof entry.name === "string" ? entry.name : entry.id,
          shortName: typeof entry.shortName === "string" ? entry.shortName : entry.id,
        });
      }
    }
  }
  if (Array.isArray(input.courses)) {
    for (const entry of input.courses) {
      if (isPlainObject(entry) && typeof entry.code === "string") {
        bundle.courses.push({
          code: entry.code,
          prerequisites: Array.isArray(entry.prerequisites)
            ? entry.prerequisites.filter((p): p is string => typeof p === "string")
            : [],
        });
      }
    }
  }
  if (Array.isArray(input.sections)) {
    for (const entry of input.sections) {
      if (isPlainObject(entry) && Array.isArray(entry.meetings)) {
        bundle.sections.push({
          meetings: entry.meetings
            .filter(isPlainObject)
            .map((meeting) => ({
              buildingId: typeof meeting.buildingId === "string" ? meeting.buildingId : null,
            })),
        });
      }
    }
  }
  return bundle;
}

function meetingCounts(sections: { meetings: { buildingId: string | null }[] }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const section of sections) {
    for (const meeting of section.meetings) {
      if (meeting.buildingId === null) continue;
      counts.set(meeting.buildingId, (counts.get(meeting.buildingId) ?? 0) + 1);
    }
  }
  return counts;
}

function isOnlineSection(section: CandidateSection): boolean {
  if (section.modality === "online") return true;
  return !section.meetings.some((meeting) => meeting.buildingId !== null);
}

export function compareBundles(current: CurrentBundle, candidate: CandidateBundle): CompareReport {
  const currentCodes = new Set(current.courses.map((course) => course.code));
  const candidateCodes = new Set(candidate.courses.map((course) => course.code));
  const candidateCodeList = [...candidateCodes].sort(byString);
  const currentCodeList = [...currentCodes].sort(byString);

  const coursesAdded = candidateCodeList.filter((code) => !currentCodes.has(code));
  const coursesMissing = currentCodeList.filter((code) => !candidateCodes.has(code));

  const currentCounts = meetingCounts(current.sections);
  const candidateCounts = meetingCounts(candidate.sections);
  const candidateBuildingIds = [...candidateCounts.keys()].sort(byString);

  const nameById = new Map(candidate.buildings.map((building) => [building.id, building.name] as const));
  const buildingsUsed = candidateBuildingIds.map((id) => ({
    id,
    name: nameById.get(id) ?? id,
    meetings: candidateCounts.get(id) ?? 0,
  }));
  const meetingsPerBuilding = candidateBuildingIds.map((id) => ({
    id,
    meetings: candidateCounts.get(id) ?? 0,
  }));
  const currentBuildingsUsed = [...currentCounts.keys()].sort(byString);

  const totalSections = candidate.sections.length;
  const onlineSections = candidate.sections.filter(isOnlineSection).length;
  const percent =
    totalSections === 0 ? 0 : Number(((onlineSections / totalSections) * 100).toFixed(1));

  const prereqUnresolved = candidate.courses
    .flatMap((course) =>
      course.prerequisites
        .filter((prereq) => !candidateCodes.has(prereq))
        .map((prereq) => ({ course: course.code, prerequisite: prereq })),
    )
    .sort((a, b) =>
      a.course !== b.course ? byString(a.course, b.course) : byString(a.prerequisite, b.prerequisite),
    );

  const prereqUnresolvedCurrentCount = current.courses.reduce(
    (sum, course) => sum + course.prerequisites.filter((prereq) => !currentCodes.has(prereq)).length,
    0,
  );

  return {
    counts: {
      current: {
        courses: current.courses.length,
        sections: current.sections.length,
        buildings: current.buildings.length,
      },
      candidate: {
        courses: candidate.courses.length,
        sections: candidate.sections.length,
        buildings: candidate.buildings.length,
      },
    },
    coursesAdded,
    coursesMissing,
    buildingsUsed,
    currentBuildingsUsed,
    meetingsPerBuilding,
    onlineShare: { onlineSections, totalSections, percent },
    prereqUnresolved,
    prereqUnresolvedCurrentCount,
    term: { ...candidate.term },
  };
}

export function renderReport(report: CompareReport): string {
  const lines: string[] = [];
  const push = (line = ""): void => {
    lines.push(line);
  };
  const listOrNone = (items: string[]): string[] =>
    items.length === 0 ? ["(none)"] : items.map((item) => `- ${item}`);

  push("# Catalog ingest comparison report");
  push();
  push("## Counts");
  push();
  push("| metric | current | candidate |");
  push("| --- | --- | --- |");
  push(`| courses | ${report.counts.current.courses} | ${report.counts.candidate.courses} |`);
  push(`| sections | ${report.counts.current.sections} | ${report.counts.candidate.sections} |`);
  push(`| buildings | ${report.counts.current.buildings} | ${report.counts.candidate.buildings} |`);
  push();
  push("## Courses added (candidate only)");
  push();
  push(...listOrNone(report.coursesAdded));
  push();
  push("## Courses missing (current only)");
  push();
  push(...listOrNone(report.coursesMissing));
  push();
  push("## Buildings used by candidate sections");
  push();
  if (report.buildingsUsed.length === 0) {
    push("(none)");
  } else {
    push("| building code | name | meetings |");
    push("| --- | --- | --- |");
    for (const building of report.buildingsUsed) {
      push(`| ${building.id} | ${building.name} | ${building.meetings} |`);
    }
  }
  push();
  push("## Building codes used by the current bundle");
  push();
  push(...listOrNone(report.currentBuildingsUsed));
  push();
  push("## Meetings per building (candidate)");
  push();
  if (report.meetingsPerBuilding.length === 0) {
    push("(none)");
  } else {
    push("| building code | meetings |");
    push("| --- | --- |");
    for (const entry of report.meetingsPerBuilding) {
      push(`| ${entry.id} | ${entry.meetings} |`);
    }
  }
  push();
  push("## Online share");
  push();
  push(
    `${report.onlineShare.onlineSections} of ${report.onlineShare.totalSections} candidate sections (${report.onlineShare.percent.toFixed(1)}%) are online or have no in-person meeting.`,
  );
  push();
  push("## Unresolved prerequisite references (candidate)");
  push();
  if (report.prereqUnresolved.length === 0) {
    push("(none)");
  } else {
    for (const edge of report.prereqUnresolved) {
      push(`- ${edge.course} requires ${edge.prerequisite} (no candidate course)`);
    }
  }
  push();
  push(`Context: the current bundle has ${report.prereqUnresolvedCurrentCount} unresolved prerequisite edge(s).`);
  push();
  push("## Term");
  push();
  push(`- id: ${report.term?.id ?? "(none)"}`);
  push(`- label: ${report.term?.label ?? "(none)"}`);
  push(`- classesStart: ${report.term?.classesStart ?? "null"}`);
  push(`- classesEnd: ${report.term?.classesEnd ?? "null"}`);
  push();
  return lines.join("\n");
}
