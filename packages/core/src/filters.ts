/**
 * Section filters: does one enrollment option pass one filter?
 *
 * The answer has three values. "pass" and "fail" are what the data proves;
 * "unknown" means the data can't say, and unknown never satisfies a filter
 * (docs/architecture/README.md, "Feature rules that follow from evidence").
 * A section with unknown seats doesn't pass "open seats only", and a meeting
 * whose day is TBA doesn't pass a day filter.
 *
 * The filters cover what the app can judge from its section data today:
 * seats, how classes meet, campus site, meeting days and times, instructor
 * and credit hours. Syllabus facts are left out until their pipeline exists.
 *
 * The persisted form of a filter is SectionFilterSchema in
 * @untangle/contracts/filters; its tests pin it to the types here.
 */

/** Every day a class can meet, as frontend/src/lib/sections/model.ts writes them. */
export type ClassDay = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

/**
 * How one meeting is held:
 * - "in-person": in a room, whether or not the campus catalogue knows the building;
 * - "online-timed": online at a set day or time;
 * - "online-async": online with no set day and time.
 */
export type MeetingMode = "in-person" | "online-timed" | "online-async";

/** One filter. A list of them is ANDed: an option passes only when it passes every one. */
export type SectionFilter =
  /** Every component has at least `minimum` open seats, and the option isn't closed, wait-listed or cancelled. */
  | { kind: "open-seats"; minimum: number }
  /** Every meeting is held in one of the allowed modes. */
  | { kind: "modality"; allowed: MeetingMode[] }
  /** Every meeting that has a physical place is at one of the allowed campus sites ("unt-denton"). */
  | { kind: "site"; allowed: string[] }
  /** Every meeting that has a day falls on one of the allowed days. */
  | { kind: "days"; allowed: ClassDay[] }
  /** Every meeting that has a time starts at or after `earliestStart` and ends at or before `latestEnd`, in minutes after midnight. Null leaves that side open. */
  | { kind: "time-window"; earliestStart: number | null; latestEnd: number | null }
  /** "only": one of these instructors teaches the option. "not": none of them does. */
  | { kind: "instructor"; match: "only" | "not"; names: string[] }
  /** The course's credit hours lie within the bounds, inclusive. Null leaves that side open. */
  | { kind: "credit-hours"; min: number | null; max: number | null };

export type FilterOutcome = "pass" | "fail" | "unknown";

/**
 * The parts of a meeting the filters read: a structural subset of `Meeting`
 * in frontend/src/lib/sections/model.ts, so a parsed section passes in as is.
 */
export type FilterableMeeting = {
  /** "building" and "unknown" have a room; "unassigned" has none; "online" is online. */
  kind: "building" | "unknown" | "online" | "unassigned";
  /** The campus-catalogue building, for kind "building". */
  buildingId: string | null;
  /** The room's code as written ("FRLD"), for kind "unknown". */
  buildingCode: string | null;
  day: ClassDay | null;
  startMinutes: number | null;
  endMinutes: number | null;
  /** Online with no set day and time. Such a meeting has no day or time to judge, which is not the same as an unknown one. */
  async: boolean;
};

/** The parts of an enrollment option (`Section` in frontend/src/lib/sections/model.ts) the filters read. */
export type FilterableSection = {
  status: "open" | "closed" | "waitlist" | "cancelled" | "unknown";
  /** The primary component's instructor; display is null when the source names none (TBA, Staff). Co-teachers are joined with "; ". */
  instructor: { display: string | null };
  /** Every component, primary first. Each needs a seat for the option to be open. */
  components: ReadonlyArray<{ seats: { open: number | null } }>;
  /** Every component's meetings, flattened. */
  meetings: readonly FilterableMeeting[];
};

/** Which campus site a place is in. Core holds no campus data, so the caller passes it in. */
export type SiteDirectory = {
  /** Campus-catalogue building id to site id, for meetings of kind "building". */
  byBuildingId: Readonly<Record<string, string>>;
  /** Room codes the catalogue doesn't map, to site id, for meetings of kind "unknown". */
  byRoomCode: Readonly<Record<string, string>>;
};

/** Facts about the option that don't live on the section itself. */
export type FilterContext = {
  /** The course's credit hours from the catalogue; null when the catalogue doesn't list the course. */
  creditHours: number | null;
  sites: SiteDirectory;
};

function combineOutcomes(outcomes: readonly FilterOutcome[]): FilterOutcome {
  if (outcomes.includes("fail")) return "fail";
  return outcomes.includes("unknown") ? "unknown" : "pass";
}

function evaluateMeetings(
  meetings: readonly FilterableMeeting[],
  evaluate: (meeting: FilterableMeeting) => FilterOutcome,
): FilterOutcome {
  if (meetings.length === 0) return "unknown";
  return combineOutcomes(meetings.map(evaluate));
}

function normalizeInstructor(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Judges one option against one filter.
 *
 * Filters over meetings judge each meeting, then combine: any meeting that
 * fails fails the option; otherwise any meeting the data can't judge makes
 * it unknown; otherwise it passes. A meeting with nothing for the filter to
 * judge, such as an async meeting under a day filter, passes. An option
 * with no meetings at all is unknown under every meeting filter.
 *
 * Never treats missing data as a pass, never reads the network or a clock,
 * and never changes its arguments. Throws on a filter kind it doesn't know,
 * so a filter added later can't silently pass everything.
 */
export function evaluateFilter(section: FilterableSection, filter: SectionFilter, context: FilterContext): FilterOutcome {
  switch (filter.kind) {
    case "open-seats": {
      if (section.status === "closed" || section.status === "waitlist" || section.status === "cancelled") return "fail";
      const seats = section.components.map(({ seats }): FilterOutcome => {
        if (seats.open === null) return "unknown";
        return seats.open >= filter.minimum ? "pass" : "fail";
      });
      return combineOutcomes([
        section.status === "unknown" || section.components.length === 0 ? "unknown" : "pass",
        ...seats,
      ]);
    }
    case "modality":
      return evaluateMeetings(section.meetings, (meeting) => {
        if (meeting.kind === "unassigned") {
          return filter.allowed.includes("in-person") && filter.allowed.includes("online-timed") && filter.allowed.includes("online-async")
            ? "pass"
            : "unknown";
        }
        const mode: MeetingMode = meeting.kind === "online" ? (meeting.async ? "online-async" : "online-timed") : "in-person";
        return filter.allowed.includes(mode) ? "pass" : "fail";
      });
    case "site":
      return evaluateMeetings(section.meetings, (meeting) => {
        if (meeting.kind === "online") return "pass";
        if (meeting.kind === "unassigned") return "unknown";
        const directory = meeting.kind === "building" ? context.sites.byBuildingId : context.sites.byRoomCode;
        const key = meeting.kind === "building" ? meeting.buildingId : meeting.buildingCode;
        if (key === null || !Object.hasOwn(directory, key)) return "unknown";
        const site = directory[key];
        if (site === undefined) return "unknown";
        return filter.allowed.includes(site) ? "pass" : "fail";
      });
    case "days":
      return evaluateMeetings(section.meetings, (meeting) => {
        if (meeting.async) return "pass";
        if (meeting.day === null) return "unknown";
        return filter.allowed.includes(meeting.day) ? "pass" : "fail";
      });
    case "time-window":
      return evaluateMeetings(section.meetings, (meeting) => {
        if (meeting.async) return "pass";
        const { startMinutes, endMinutes } = meeting;
        if (filter.earliestStart !== null && startMinutes !== null && startMinutes < filter.earliestStart) return "fail";
        if (filter.latestEnd !== null && endMinutes !== null && endMinutes > filter.latestEnd) return "fail";
        if ((filter.earliestStart !== null && startMinutes === null) || (filter.latestEnd !== null && endMinutes === null)) return "unknown";
        return "pass";
      });
    case "instructor": {
      if (section.instructor.display === null) return "unknown";
      const instructors = section.instructor.display.split(";").map(normalizeInstructor).filter((name) => name.length > 0);
      if (instructors.length === 0) return "unknown";
      const matches = filter.names.some((name) => instructors.includes(normalizeInstructor(name)));
      return matches === (filter.match === "only") ? "pass" : "fail";
    }
    case "credit-hours": {
      const hours = context.creditHours;
      if (hours === null) return "unknown";
      if (filter.min !== null && hours < filter.min) return "fail";
      if (filter.max !== null && hours > filter.max) return "fail";
      return "pass";
    }
    default: {
      const unknownFilter: never = filter;
      throw new Error(`Unknown section filter kind: ${JSON.stringify(unknownFilter)}`);
    }
  }
}

/**
 * Judges one option against a list of filters: "fail" if any filter fails,
 * otherwise "unknown" if any is unknown, otherwise "pass". An empty list
 * passes. The order of the list never changes the answer. An option passes
 * the set only when the answer is "pass".
 */
export function evaluateFilters(
  section: FilterableSection,
  filters: readonly SectionFilter[],
  context: FilterContext,
): FilterOutcome {
  return combineOutcomes(filters.map((filter) => evaluateFilter(section, filter, context)));
}
