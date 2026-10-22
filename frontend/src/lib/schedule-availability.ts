import type { ScheduleBody } from "../../../packages/contracts/src/documents";
import type { AvailabilitySection, CourseAvailability, ScheduleAvailability, SeatAvailability } from "../../../packages/contracts/src/schedule-availability";
import type { CourseSections, Section } from "./sections/model";
import { coursePattern } from "./sections/config";

export type ReadCourseSections = (term: string, courseCode: string) => Promise<CourseSections>;

/** Stop waiting without cancelling a proxy fetch that another request may share. */
async function readUntilAborted(read: () => Promise<CourseSections>, signal?: AbortSignal): Promise<CourseSections> {
  if (!signal) return read();
  signal.throwIfAborted();
  let stop: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    stop = () => reject(signal.reason);
    signal.addEventListener("abort", stop, { once: true });
  });
  try {
    return await Promise.race([read(), aborted]);
  } finally {
    signal.removeEventListener("abort", stop);
  }
}

/** Unlike the permissive search filter, a positive check needs known seats in every component. */
export function seatAvailability(section: Section): SeatAvailability {
  if (section.status === "cancelled" || section.status === "closed" || section.status === "waitlist") return section.status;
  if (section.seats.open === 0 || section.components.some((component) => component.seats.open === 0)) return "full";
  if (section.status !== "open" || section.seats.open === null || section.components.length === 0 ||
    section.components.some((component) => component.seats.open === null)) return "unknown";
  return "open";
}

function describeSection(section: Section): AvailabilitySection {
  return {
    id: section.id,
    sectionCode: section.sectionCode,
    classNumbers: section.classNumbers,
    status: section.status,
    seats: seatAvailability(section),
    components: section.components.map(({ classNumber, sectionCode, role, seats }) => ({ classNumber, sectionCode, role, seats })),
  };
}

/** Resolve only the saved option id. A different option with the same label is not a replacement. */
export function checkCourseAvailability(courseCode: string, selectedSectionId: string, result: CourseSections): CourseAvailability {
  const selection = { courseCode, selectedSectionId };
  if (result.status === "unavailable") {
    return { ...selection, state: result.sections.some((section) => section.id === selectedSectionId) ? "sample" : "unavailable", evidence: null, section: null };
  }
  const evidence = { checkedAt: result.checkedAt, provenance: result.provenance };
  const found = result.sections.find((section) => section.id === selectedSectionId);
  const section = found ? describeSection(found) : null;
  if (result.status === "stale") return { ...selection, state: "stale", evidence, section };
  if (!section) return { ...selection, state: "missing", evidence, section: null };
  return { ...selection, state: section.seats, evidence, section };
}

/** One failed course lookup leaves the other courses' evidence usable. Reads never change saved picks. */
export async function checkScheduleAvailability(schedule: ScheduleBody, readSections: ReadCourseSections, signal?: AbortSignal): Promise<Pick<ScheduleAvailability, "summary" | "courses">> {
  const courses: CourseAvailability[] = [];
  // Sequential reads share the proxy's term cache and avoid a request burst for a saved schedule.
  for (const courseCode of schedule.courses) {
    const selectedSectionId = schedule.selectedSections[courseCode] ?? null;
    if (!selectedSectionId) {
      courses.push({ courseCode, selectedSectionId: null, state: "unselected", evidence: null, section: null });
    } else if (!coursePattern.test(courseCode)) {
      courses.push({ courseCode, selectedSectionId, state: "unsupported-course", evidence: null, section: null });
    } else {
      try {
        const result = await readUntilAborted(() => readSections(schedule.termId, courseCode), signal);
        // Keep evidence for another course or term out of this student's check.
        if (result.term !== schedule.termId || result.courseCode !== courseCode) throw new Error("Section lookup identity mismatch.");
        courses.push(checkCourseAvailability(courseCode, selectedSectionId, result));
      } catch {
        courses.push({ courseCode, selectedSectionId, state: "unavailable", evidence: null, section: null });
      }
    }
  }
  const blockers = new Set<CourseAvailability["state"]>(["unselected", "missing", "full", "closed", "waitlist", "cancelled"]);
  const summary = courses.length === 0 ? "empty"
    : courses.some((course) => blockers.has(course.state)) ? "needs-attention"
    : courses.every((course) => course.state === "open") ? "open" : "unknown";
  return { summary, courses };
}
