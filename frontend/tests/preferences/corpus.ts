/**
 * Labeled corpus of schedule-preference phrasings.
 *
 * Every entry pairs a realistic student utterance with the exact intent the
 * parser should return. Labels follow the documented rules in
 * `parse.ts` — in particular the bare-hour plausibility rule (1–7 read as
 * pm, 8–11 as am, 12 as noon), the pm-flip for unmarked ranges whose end is
 * not after their start, and the last-mention-wins rule for singleton
 * fields. Phrasings whose bare-hour reading is genuinely ambiguous on both
 * sides (e.g. "before 7" without a marker) are avoided on purpose; phrasings
 * the parser is not expected to reach are labeled exactly that way, so the
 * evaluation reports them as misses rather than hiding them.
 */

import type {
  InstructorPreference,
  PrefBlockedTime,
  PrefDay,
  SoftKey,
} from "../../src/lib/preferences/schema";
import { PREF_DAYS } from "../../src/lib/preferences/schema";

const ALL = PREF_DAYS as readonly PrefDay[];
const WD: PrefDay[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const WE: PrefDay[] = ["Sat", "Sun"];

const block = (
  days: readonly PrefDay[],
  start: number,
  end: number,
  label?: string,
): PrefBlockedTime[] =>
  days.map((day) => ({ day, start, end, ...(label ? { label } : {}) }));

export type CorpusExpect = {
  earliestStart?: number;
  latestEnd?: number;
  daysOff?: PrefDay[];
  blockedTimes?: PrefBlockedTime[];
  creditMin?: number;
  creditMax?: number;
  openSeatsOnly?: boolean;
  campusScope?: "dentonOnly" | "otherSitesOk";
  mode?: "online" | "inPerson";
  wantedCourses?: string[];
  avoidedCourses?: string[];
  /** Soft keys present at any strength. */
  soft?: SoftKey[];
  /** Soft keys that must be strong. */
  softStrong?: SoftKey[];
  instructor?: InstructorPreference;
};

export type CorpusEntry = {
  id: string;
  kind:
    | "earliestStart"
    | "latestEnd"
    | "daysOff"
    | "blockedTimes"
    | "credits"
    | "seats"
    | "campus"
    | "mode"
    | "courses"
    | "instructor"
    | "soft"
    | "multi"
    | "unsupported"
    | "chatter";
  text: string;
  expect?: CorpusExpect;
  unsupportedTags?: string[];
  unparseable?: boolean;
};

export const CORPUS: CorpusEntry[] = [
  // ---------------------------------------------------------------- earliest
  { id: "es-001", kind: "earliestStart", text: "No classes before 10am", expect: { earliestStart: 600 } },
  { id: "es-002", kind: "earliestStart", text: "no classes before 10 a.m.", expect: { earliestStart: 600 } },
  { id: "es-003", kind: "earliestStart", text: "nothing before 9", expect: { earliestStart: 540 } },
  { id: "es-004", kind: "earliestStart", text: "I don't want to start before 9", expect: { earliestStart: 540 } },
  { id: "es-005", kind: "earliestStart", text: "I can't take classes before 11", expect: { earliestStart: 660 } },
  { id: "es-006", kind: "earliestStart", text: "nothing earlier than 8", expect: { earliestStart: 480 } },
  { id: "es-007", kind: "earliestStart", text: "don't start before 8:30", expect: { earliestStart: 510 } },
  { id: "es-008", kind: "earliestStart", text: "can't start until 9:30", expect: { earliestStart: 570 } },
  { id: "es-009", kind: "earliestStart", text: "don't begin until 10am", expect: { earliestStart: 600 } },
  { id: "es-010", kind: "earliestStart", text: "my first class can't start before 10", expect: { earliestStart: 600 } },
  { id: "es-011", kind: "earliestStart", text: "first section shouldn't begin before 9am", expect: { earliestStart: 540 } },
  { id: "es-012", kind: "earliestStart", text: "earliest I can start is 9:30", expect: { earliestStart: 570 } },
  { id: "es-013", kind: "earliestStart", text: "earliest I could start 10", expect: { earliestStart: 600 } },
  { id: "es-014", kind: "earliestStart", text: "no morning classes", expect: { earliestStart: 720 } },
  { id: "es-015", kind: "earliestStart", text: "no early classes", expect: { earliestStart: 720 } },
  { id: "es-016", kind: "earliestStart", text: "9am is too early", expect: { earliestStart: 540 } },
  { id: "es-017", kind: "earliestStart", text: "8ams are too early for me", expect: { earliestStart: 480 } },
  { id: "es-018", kind: "earliestStart", text: "I'm not a morning person, nothing before 10", expect: { earliestStart: 600 } },
  { id: "es-019", kind: "earliestStart", text: "not before 9am", expect: { earliestStart: 540 } },
  { id: "es-020", kind: "earliestStart", text: "nothing that starts before 8:45am", expect: { earliestStart: 525 } },
  { id: "es-021", kind: "earliestStart", text: "no classes that begin before noon", expect: { earliestStart: 720 } },
  { id: "es-022", kind: "earliestStart", text: "I really can't do anything before 10am", expect: { earliestStart: 600 } },
  { id: "es-023", kind: "earliestStart", text: "no classes before 11:30", expect: { earliestStart: 690 } },
  { id: "es-024", kind: "earliestStart", text: "don't want anything before noon", expect: { earliestStart: 720 } },
  { id: "es-025", kind: "earliestStart", text: "no sections before 10am", expect: { earliestStart: 600 } },
  { id: "es-026", kind: "earliestStart", text: "can't have classes before 9", expect: { earliestStart: 540 } },
  { id: "es-027", kind: "earliestStart", text: "no classes before 7am", expect: { earliestStart: 420 } },
  { id: "es-028", kind: "earliestStart", text: "nothing before 9:15 please", expect: { earliestStart: 555 } },
  { id: "es-029", kind: "earliestStart", text: "nothing before noon", expect: { earliestStart: 720 } },
  { id: "es-030", kind: "earliestStart", text: "can't start until noon", expect: { earliestStart: 720 } },
  { id: "es-031", kind: "earliestStart", text: "I don't want classes that start before 9:30am", expect: { earliestStart: 570 } },
  { id: "es-032", kind: "earliestStart", text: "no classes that begin before 11", expect: { earliestStart: 660 } },

  // ----------------------------------------------------------------- latest
  { id: "le-001", kind: "latestEnd", text: "No classes after 3pm", expect: { latestEnd: 900 } },
  { id: "le-002", kind: "latestEnd", text: "no classes after 3", expect: { latestEnd: 900 } },
  { id: "le-003", kind: "latestEnd", text: "nothing past 5", expect: { latestEnd: 1020 } },
  { id: "le-004", kind: "latestEnd", text: "nothing after 5:30", expect: { latestEnd: 1050 } },
  { id: "le-005", kind: "latestEnd", text: "I need to be done by 3:30", expect: { latestEnd: 930 } },
  { id: "le-006", kind: "latestEnd", text: "I need to be done by noon", expect: { latestEnd: 720 } },
  { id: "le-007", kind: "latestEnd", text: "out by 4", expect: { latestEnd: 960 } },
  { id: "le-008", kind: "latestEnd", text: "done by 2:30", expect: { latestEnd: 870 } },
  { id: "le-009", kind: "latestEnd", text: "finished by 5", expect: { latestEnd: 1020 } },
  { id: "le-010", kind: "latestEnd", text: "can't stay past 2", expect: { latestEnd: 840 } },
  { id: "le-011", kind: "latestEnd", text: "can't go past 6pm", expect: { latestEnd: 1080 } },
  { id: "le-012", kind: "latestEnd", text: "no classes that end after 4", expect: { latestEnd: 960 } },
  { id: "le-013", kind: "latestEnd", text: "no classes ending after 3:30", expect: { latestEnd: 930 } },
  { id: "le-014", kind: "latestEnd", text: "don't want to end after 6", expect: { latestEnd: 1080 } },
  { id: "le-015", kind: "latestEnd", text: "nothing later than 3:30pm", expect: { latestEnd: 930 } },
  { id: "le-016", kind: "latestEnd", text: "not later than 5pm", expect: { latestEnd: 1020 } },
  { id: "le-017", kind: "latestEnd", text: "I have to leave by 4", expect: { latestEnd: 960 } },
  { id: "le-018", kind: "latestEnd", text: "latest class can end at 6", expect: { latestEnd: 1080 } },
  { id: "le-019", kind: "latestEnd", text: "latest class should end by 4:30", expect: { latestEnd: 990 } },
  { id: "le-020", kind: "latestEnd", text: "6pm is too late", expect: { latestEnd: 1080 } },
  { id: "le-021", kind: "latestEnd", text: "5 is too late", expect: { latestEnd: 1020 } },
  { id: "le-022", kind: "latestEnd", text: "I want to be home by 5", expect: { latestEnd: 1020 } },
  { id: "le-023", kind: "latestEnd", text: "be home by 4:30", expect: { latestEnd: 990 } },
  { id: "le-024", kind: "latestEnd", text: "no classes after noon", expect: { latestEnd: 720 } },
  { id: "le-025", kind: "latestEnd", text: "over by 2:30", expect: { latestEnd: 870 } },
  { id: "le-026", kind: "latestEnd", text: "I'd like to finish by 3", expect: { latestEnd: 900 } },
  { id: "le-027", kind: "latestEnd", text: "no classes after 4:30", expect: { latestEnd: 990 } },
  { id: "le-028", kind: "latestEnd", text: "don't let out after 5", expect: { latestEnd: 1020 } },
  { id: "le-029", kind: "latestEnd", text: "nothing after 2 on Tuesdays", expect: { latestEnd: 840 } },
  { id: "le-030", kind: "latestEnd", text: "I need to be off by 3:30", expect: { latestEnd: 930 } },
  { id: "le-031", kind: "latestEnd", text: "nothing after 7", expect: { latestEnd: 1140 } },
  { id: "le-032", kind: "latestEnd", text: "no classes past 1", expect: { latestEnd: 780 } },

  // ---------------------------------------------------------------- days off
  { id: "do-001", kind: "daysOff", text: "no classes on Friday", expect: { daysOff: ["Fri"] } },
  { id: "do-002", kind: "daysOff", text: "no classes on Fridays", expect: { daysOff: ["Fri"] } },
  { id: "do-003", kind: "daysOff", text: "no Friday classes", expect: { daysOff: ["Fri"] } },
  { id: "do-004", kind: "daysOff", text: "I don't want Friday classes", expect: { daysOff: ["Fri"] } },
  { id: "do-005", kind: "daysOff", text: "don't schedule anything on Tuesdays", expect: { daysOff: ["Tue"] } },
  { id: "do-006", kind: "daysOff", text: "skip Tuesdays and Thursdays", expect: { daysOff: ["Tue", "Thu"] } },
  { id: "do-007", kind: "daysOff", text: "no Monday or Wednesday classes", expect: { daysOff: ["Mon", "Wed"] } },
  { id: "do-008", kind: "daysOff", text: "avoid Friday classes", expect: { daysOff: ["Fri"] } },
  { id: "do-009", kind: "daysOff", text: "Fridays off", expect: { daysOff: ["Fri"] } },
  { id: "do-010", kind: "daysOff", text: "weekends are off", expect: { daysOff: WE } },
  { id: "do-011", kind: "daysOff", text: "weekends off", expect: { daysOff: WE } },
  { id: "do-012", kind: "daysOff", text: "weekdays off", expect: { daysOff: WD } },
  { id: "do-013", kind: "daysOff", text: "keep my weekends free", expect: { daysOff: WE } },
  { id: "do-014", kind: "daysOff", text: "keep Fridays free", expect: { daysOff: ["Fri"] } },
  { id: "do-015", kind: "daysOff", text: "leave my Fridays open", expect: { daysOff: ["Fri"] } },
  { id: "do-016", kind: "daysOff", text: "I'm free on Wednesdays", expect: { daysOff: ["Wed"] } },
  { id: "do-017", kind: "daysOff", text: "free Fridays", expect: { daysOff: ["Fri"] } },
  { id: "do-018", kind: "daysOff", text: "Wednesdays are free", expect: { daysOff: ["Wed"] } },
  { id: "do-019", kind: "daysOff", text: "nothing on Mondays", expect: { daysOff: ["Mon"] } },
  { id: "do-020", kind: "daysOff", text: "I go home on Saturdays", expect: { daysOff: ["Sat"] } },
  { id: "do-021", kind: "daysOff", text: "I go back home Fridays", expect: { daysOff: ["Fri"] } },
  { id: "do-022", kind: "daysOff", text: "I have church on Sundays", expect: { daysOff: ["Sun"] } },
  { id: "do-023", kind: "daysOff", text: "only MWF", expect: { daysOff: ["Tue", "Thu", "Sat", "Sun"] } },
  { id: "do-024", kind: "daysOff", text: "only on TTH", expect: { daysOff: ["Mon", "Wed", "Fri", "Sat", "Sun"] } },
  { id: "do-025", kind: "daysOff", text: "no classes on weekends", expect: { daysOff: WE } },
  { id: "do-026", kind: "daysOff", text: "no saturday classes", expect: { daysOff: ["Sat"] } },
  { id: "do-027", kind: "daysOff", text: "I'd rather not have Friday classes", expect: { daysOff: ["Fri"] } },
  { id: "do-028", kind: "daysOff", text: "no thursday classes please", expect: { daysOff: ["Thu"] } },
  { id: "do-029", kind: "daysOff", text: "MW only", expect: { daysOff: ["Tue", "Thu", "Fri", "Sat", "Sun"] } },
  { id: "do-030", kind: "daysOff", text: "skip mondays", expect: { daysOff: ["Mon"] } },
  { id: "do-031", kind: "daysOff", text: "don't want Monday or Wednesday classes", expect: { daysOff: ["Mon", "Wed"] } },
  { id: "do-032", kind: "daysOff", text: "no classes tues or thurs", expect: { daysOff: ["Tue", "Thu"] } },
  { id: "do-033", kind: "daysOff", text: "nothing on saturdays", expect: { daysOff: ["Sat"] } },
  { id: "do-034", kind: "daysOff", text: "Fridays are free", expect: { daysOff: ["Fri"] } },

  // ------------------------------------------------------------ blocked time
  { id: "bt-001", kind: "blockedTimes", text: "I work MWF 9-2", expect: { blockedTimes: block(["Mon", "Wed", "Fri"], 540, 840, "work") } },
  { id: "bt-002", kind: "blockedTimes", text: "I work Mondays 9 to 2", expect: { blockedTimes: block(["Mon"], 540, 840, "work") } },
  { id: "bt-003", kind: "blockedTimes", text: "Mondays I work 9 to 2", expect: { blockedTimes: block(["Mon"], 540, 840, "work") } },
  { id: "bt-004", kind: "blockedTimes", text: "keep 12-1 free", expect: { blockedTimes: block(ALL, 720, 780) } },
  { id: "bt-005", kind: "blockedTimes", text: "keep 12 to 1 free for lunch on weekdays", expect: { blockedTimes: block(WD, 720, 780, "lunch") } },
  { id: "bt-006", kind: "blockedTimes", text: "keep 11-1 open", expect: { blockedTimes: block(ALL, 660, 780) } },
  { id: "bt-007", kind: "blockedTimes", text: "Tuesday and Thursday 2-5pm", expect: { blockedTimes: block(["Tue", "Thu"], 840, 1020) } },
  { id: "bt-008", kind: "blockedTimes", text: "Tuesdays and Thursdays 2 to 5", expect: { blockedTimes: block(["Tue", "Thu"], 840, 1020) } },
  { id: "bt-009", kind: "blockedTimes", text: "I have practice 3 to 5", expect: { blockedTimes: block(ALL, 900, 1020, "practice") } },
  { id: "bt-010", kind: "blockedTimes", text: "I volunteer Tuesdays 1-4", expect: { blockedTimes: block(["Tue"], 780, 960, "volunteer") } },
  { id: "bt-011", kind: "blockedTimes", text: "I babysit every weekday 2-6", expect: { blockedTimes: block(WD, 840, 1080, "babysit") } },
  { id: "bt-012", kind: "blockedTimes", text: "no 8am classes", expect: { blockedTimes: block(ALL, 480, 540) } },
  { id: "bt-013", kind: "blockedTimes", text: "no 3pm classes", expect: { blockedTimes: block(ALL, 900, 960) } },
  { id: "bt-014", kind: "blockedTimes", text: "can't do 9ams", expect: { blockedTimes: block(ALL, 540, 600) } },
  { id: "bt-015", kind: "blockedTimes", text: "I work from 8am to 4pm every day", expect: { blockedTimes: block(ALL, 480, 960, "work") } },
  { id: "bt-016", kind: "blockedTimes", text: "daily 10 to 11:30", expect: { blockedTimes: block(ALL, 600, 690) } },
  { id: "bt-017", kind: "blockedTimes", text: "set aside noon to 2 for lunch", expect: { blockedTimes: block(ALL, 720, 840, "lunch") } },
  { id: "bt-018", kind: "blockedTimes", text: "reserve 2-4 for practice", expect: { blockedTimes: block(ALL, 840, 960, "practice") } },
  { id: "bt-019", kind: "blockedTimes", text: "I have lab from 2 until 6", expect: { blockedTimes: block(ALL, 840, 1080, "lab") } },
  { id: "bt-020", kind: "blockedTimes", text: "clinical rotations run 8 to 5", expect: { blockedTimes: block(ALL, 480, 1020, "clinical") } },
  { id: "bt-021", kind: "blockedTimes", text: "reserve 7am to 3pm on Saturdays", expect: { blockedTimes: block(["Sat"], 420, 900) } },
  { id: "bt-022", kind: "blockedTimes", text: "keep 5 to 6pm blocked", expect: { blockedTimes: block(ALL, 1020, 1080) } },
  { id: "bt-023", kind: "blockedTimes", text: "keep 9:30 to 11 free", expect: { blockedTimes: block(ALL, 570, 660) } },
  { id: "bt-024", kind: "blockedTimes", text: "I train 10-2 on Saturdays", expect: { blockedTimes: block(["Sat"], 600, 840, "train") } },
  { id: "bt-025", kind: "blockedTimes", text: "I work Sundays 8am to noon", expect: { blockedTimes: block(["Sun"], 480, 720, "work") } },
  { id: "bt-026", kind: "blockedTimes", text: "keep 4-5 free", expect: { blockedTimes: block(ALL, 960, 1020) } },
  { id: "bt-027", kind: "blockedTimes", text: "practice from 1 to 3 daily", expect: { blockedTimes: block(ALL, 780, 900, "practice") } },
  { id: "bt-028", kind: "blockedTimes", text: "no 9am classes", expect: { blockedTimes: block(ALL, 540, 600) } },
  { id: "bt-029", kind: "blockedTimes", text: "keep 2 to 1 free", expect: { blockedTimes: block(ALL, 840, 1500) } },
  { id: "bt-030", kind: "blockedTimes", text: "I volunteer Fridays 9 to 1", expect: { blockedTimes: block(["Fri"], 540, 780, "volunteer") } },

  // ---------------------------------------------------------------- credits
  { id: "cr-001", kind: "credits", text: "no more than 15 credit hours", expect: { creditMax: 15 } },
  { id: "cr-002", kind: "credits", text: "no more than 15 credits", expect: { creditMax: 15 } },
  { id: "cr-003", kind: "credits", text: "at least 12 credits", expect: { creditMin: 12 } },
  { id: "cr-004", kind: "credits", text: "at least 12 credit hours", expect: { creditMin: 12 } },
  { id: "cr-005", kind: "credits", text: "exactly 15 credits", expect: { creditMin: 15, creditMax: 15 } },
  { id: "cr-006", kind: "credits", text: "between 12 and 15 credits", expect: { creditMin: 12, creditMax: 15 } },
  { id: "cr-007", kind: "credits", text: "between 12 and 15 credit hours", expect: { creditMin: 12, creditMax: 15 } },
  { id: "cr-008", kind: "credits", text: "12 to 15 credit hours", expect: { creditMin: 12, creditMax: 15 } },
  { id: "cr-009", kind: "credits", text: "max 18 hours", expect: { creditMax: 18 } },
  { id: "cr-010", kind: "credits", text: "maximum of 16 credits", expect: { creditMax: 16 } },
  { id: "cr-011", kind: "credits", text: "15 hours max", expect: { creditMax: 15 } },
  { id: "cr-012", kind: "credits", text: "no fewer than 12 credits", expect: { creditMin: 12 } },
  { id: "cr-013", kind: "credits", text: "fewer than 15 credits", expect: { creditMax: 14 } },
  { id: "cr-014", kind: "credits", text: "less than 12 hours", expect: { creditMax: 11 } },
  { id: "cr-015", kind: "credits", text: "more than 12 credit hours", expect: { creditMin: 13 } },
  { id: "cr-016", kind: "credits", text: "over 14 credits", expect: { creditMin: 15 } },
  { id: "cr-017", kind: "credits", text: "up to 16 credits", expect: { creditMax: 16 } },
  { id: "cr-018", kind: "credits", text: "I need 12 credit hours", expect: { creditMin: 12 } },
  { id: "cr-019", kind: "credits", text: "minimum of 14 credits", expect: { creditMin: 14 } },
  { id: "cr-020", kind: "credits", text: "12 or fewer credits", expect: { creditMax: 12 } },
  { id: "cr-021", kind: "credits", text: "16 or more credits", expect: { creditMin: 16 } },
  { id: "cr-022", kind: "credits", text: "at most 13 credit hours", expect: { creditMax: 13 } },
  { id: "cr-023", kind: "credits", text: "somewhere between 13 and 16 hours", expect: { creditMin: 13, creditMax: 16 } },
  { id: "cr-024", kind: "credits", text: "at least 9 hours", expect: { creditMin: 9 } },
  { id: "cr-025", kind: "credits", text: "no more than 12hrs", expect: { creditMax: 12 } },
  { id: "cr-026", kind: "credits", text: "around 15 credits is my sweet spot", expect: {} },
  { id: "cr-027", kind: "credits", text: "I want about 15 credits", expect: {}, unparseable: true },
  { id: "cr-028", kind: "credits", text: "no more than 18 credit hours please", expect: { creditMax: 18 } },

  // ------------------------------------------------------------------ seats
  { id: "st-001", kind: "seats", text: "only classes with open seats", expect: { openSeatsOnly: true } },
  { id: "st-002", kind: "seats", text: "open seats only", expect: { openSeatsOnly: true } },
  { id: "st-003", kind: "seats", text: "no waitlisted classes", expect: { openSeatsOnly: true } },
  { id: "st-004", kind: "seats", text: "no wait-listed sections", expect: { openSeatsOnly: true } },
  { id: "st-005", kind: "seats", text: "don't pick closed sections", expect: { openSeatsOnly: true } },
  { id: "st-006", kind: "seats", text: "don't suggest full courses", expect: { openSeatsOnly: true } },
  { id: "st-007", kind: "seats", text: "nothing waitlisted", expect: { openSeatsOnly: true } },
  { id: "st-008", kind: "seats", text: "nothing closed", expect: { openSeatsOnly: true } },
  { id: "st-009", kind: "seats", text: "make sure they have open seats", expect: { openSeatsOnly: true } },
  { id: "st-010", kind: "seats", text: "only sections that still have open seats", expect: { openSeatsOnly: true } },
  { id: "st-011", kind: "seats", text: "don't show me closed classes", expect: { openSeatsOnly: true } },

  // ----------------------------------------------------------------- campus
  { id: "ca-001", kind: "campus", text: "Denton campus only", expect: { campusScope: "dentonOnly" } },
  { id: "ca-002", kind: "campus", text: "main campus only", expect: { campusScope: "dentonOnly" } },
  { id: "ca-003", kind: "campus", text: "only the Denton campus", expect: { campusScope: "dentonOnly" } },
  { id: "ca-004", kind: "campus", text: "no Frisco", expect: { campusScope: "dentonOnly" } },
  { id: "ca-005", kind: "campus", text: "Frisco is too far", expect: { campusScope: "dentonOnly" } },
  { id: "ca-006", kind: "campus", text: "other campuses are too far", expect: { campusScope: "dentonOnly" } },
  { id: "ca-007", kind: "campus", text: "don't send me to Frisco", expect: { campusScope: "dentonOnly" } },
  { id: "ca-008", kind: "campus", text: "keep me at the main campus", expect: { campusScope: "dentonOnly" } },
  { id: "ca-009", kind: "campus", text: "denton only", expect: { campusScope: "dentonOnly" } },
  { id: "ca-010", kind: "campus", text: "other campuses are fine", expect: { campusScope: "otherSitesOk" } },
  { id: "ca-011", kind: "campus", text: "I can go to Frisco", expect: { campusScope: "otherSitesOk" } },
  { id: "ca-012", kind: "campus", text: "I could drive to other sites", expect: { campusScope: "otherSitesOk" } },
  { id: "ca-013", kind: "campus", text: "don't mind going to Frisco", expect: { campusScope: "otherSitesOk" } },
  { id: "ca-014", kind: "campus", text: "open to other campuses", expect: { campusScope: "otherSitesOk" } },
  { id: "ca-015", kind: "campus", text: "Frisco works for me", expect: { campusScope: "otherSitesOk" } },
  { id: "ca-016", kind: "campus", text: "other campuses work too", expect: { campusScope: "otherSitesOk" } },
  { id: "ca-017", kind: "campus", text: "no other sites", expect: { campusScope: "dentonOnly" } },

  // ------------------------------------------------------------------- mode
  { id: "mo-001", kind: "mode", text: "online only", expect: { mode: "online" } },
  { id: "mo-002", kind: "mode", text: "all online", expect: { mode: "online" } },
  { id: "mo-003", kind: "mode", text: "I want all online classes", expect: { mode: "online" } },
  { id: "mo-004", kind: "mode", text: "everything online", expect: { mode: "online" } },
  { id: "mo-005", kind: "mode", text: "no in-person classes", expect: { mode: "online" } },
  { id: "mo-006", kind: "mode", text: "no campus classes", expect: { mode: "online" } },
  { id: "mo-007", kind: "mode", text: "only online courses", expect: { mode: "online" } },
  { id: "mo-008", kind: "mode", text: "in person only", expect: { mode: "inPerson" } },
  { id: "mo-009", kind: "mode", text: "in-person only", expect: { mode: "inPerson" } },
  { id: "mo-010", kind: "mode", text: "no online sections", expect: { mode: "inPerson" } },
  { id: "mo-011", kind: "mode", text: "face-to-face only", expect: { mode: "inPerson" } },
  { id: "mo-012", kind: "mode", text: "I need to be in a classroom", expect: { mode: "inPerson" } },
  { id: "mo-013", kind: "mode", text: "as much online as possible", unsupportedTags: ["onlinePreference"] },

  // ---------------------------------------------------------------- courses
  { id: "co-001", kind: "courses", text: "I need CSCE 3110", expect: { wantedCourses: ["CSCE 3110"] } },
  { id: "co-002", kind: "courses", text: "I have to take MATH 1710", expect: { wantedCourses: ["MATH 1710"] } },
  { id: "co-003", kind: "courses", text: "signing up for BIOL 2041", expect: { wantedCourses: ["BIOL 2041"] } },
  { id: "co-004", kind: "courses", text: "avoid CSCE 4110", expect: { avoidedCourses: ["CSCE 4110"] } },
  { id: "co-005", kind: "courses", text: "I don't want to take MATH 1710", expect: { avoidedCourses: ["MATH 1710"] } },
  { id: "co-006", kind: "courses", text: "anything but HIST 2610", expect: { avoidedCourses: ["HIST 2610"] } },
  { id: "co-007", kind: "courses", text: "I need CSCE 3110 and MATH 1710", expect: { wantedCourses: ["CSCE 3110", "MATH 1710"] } },
  { id: "co-008", kind: "courses", text: "take ENGL 1310 this term", expect: { wantedCourses: ["ENGL 1310"] } },
  { id: "co-009", kind: "courses", text: "planning on PSCI 2305", expect: { wantedCourses: ["PSCI 2305"] } },
  { id: "co-010", kind: "courses", text: "not interested in ART 1300", expect: { avoidedCourses: ["ART 1300"] } },
  { id: "co-011", kind: "courses", text: "skip CHEM 2370", expect: { avoidedCourses: ["CHEM 2370"] } },
  { id: "co-012", kind: "courses", text: "I want ECON 1110", expect: { wantedCourses: ["ECON 1110"] } },
  { id: "co-013", kind: "courses", text: "hoping for MUSM 1250", expect: { wantedCourses: ["MUSM 1250"] } },
  { id: "co-014", kind: "courses", text: "must take PHYS 2250", expect: { wantedCourses: ["PHYS 2250"] } },
  { id: "co-015", kind: "courses", text: "I need to add KMED 3000", expect: { wantedCourses: ["KMED 3000"] } },
  { id: "co-016", kind: "courses", text: "Transfer credit for MATH 1710 already posted", expect: {} },
  { id: "co-017", kind: "courses", text: "avoiding ART 1300 and MUSM 1250", expect: { avoidedCourses: ["ART 1300", "MUSM 1250"] } },
  { id: "co-018", kind: "courses", text: "I need CSCE 3110, MATH 1710, and BIOL 2041", expect: { wantedCourses: ["CSCE 3110", "MATH 1710", "BIOL 2041"] } },
  { id: "co-019", kind: "courses", text: "require PHIL 1050", expect: { wantedCourses: ["PHIL 1050"] } },
  { id: "co-020", kind: "courses", text: "no CSCE 4110 for me", expect: { avoidedCourses: ["CSCE 4110"] } },
  { id: "co-021", kind: "courses", text: "I need CSCE 3110 and no MATH 1710", expect: { wantedCourses: ["CSCE 3110"], avoidedCourses: ["MATH 1710"] } },
  { id: "co-022", kind: "courses", text: "sign up for ANTH 2350", expect: { wantedCourses: ["ANTH 2350"] } },
  { id: "co-023", kind: "courses", text: "I'd rather take MATH 1650", expect: { wantedCourses: ["MATH 1650"] } },
  { id: "co-024", kind: "courses", text: "I need UHST 3010", expect: { wantedCourses: ["UHST 3010"] } },
  { id: "co-025", kind: "courses", text: "not CSCE 4110", expect: { avoidedCourses: ["CSCE 4110"] } },

  // ------------------------------------------------------------- instructor
  { id: "in-001", kind: "instructor", text: "prefer professor Miller", expect: { instructor: { kind: "named", name: "Miller", strength: "mild" } } },
  { id: "in-002", kind: "instructor", text: "I really want professor Kim", expect: { instructor: { kind: "named", name: "Kim", strength: "strong" } } },
  { id: "in-003", kind: "instructor", text: "want dr. Patel", expect: { instructor: { kind: "named", name: "Patel", strength: "mild" } } },
  { id: "in-004", kind: "instructor", text: "only want a class with prof Nguyen", expect: { instructor: { kind: "named", name: "Nguyen", strength: "mild" } } },
  { id: "in-005", kind: "instructor", text: "professor Wang if possible", expect: { instructor: { kind: "named", name: "Wang", strength: "mild" } } },
  { id: "in-006", kind: "instructor", text: "please pick prof Adams", expect: { instructor: { kind: "named", name: "Adams", strength: "strong" } } },
  { id: "in-007", kind: "instructor", text: "give me dr. Chen", expect: { instructor: { kind: "named", name: "Chen", strength: "mild" } } },
  { id: "in-008", kind: "instructor", text: "looking for easier graders", expect: { instructor: { kind: "easierGraders", strength: "mild" } } },
  { id: "in-009", kind: "instructor", text: "I need easier graders", expect: { instructor: { kind: "easierGraders", strength: "strong" } } },
  { id: "in-010", kind: "instructor", text: "lenient grading please", expect: { instructor: { kind: "easierGraders", strength: "mild" } } },
  { id: "in-011", kind: "instructor", text: "an easy A would be nice", expect: { instructor: { kind: "easierGraders", strength: "mild" } } },
  { id: "in-012", kind: "instructor", text: "I really need easy graders", expect: { instructor: { kind: "easierGraders", strength: "strong" } } },
  { id: "in-013", kind: "instructor", text: "grades easily", expect: { instructor: { kind: "easierGraders", strength: "mild" } } },
  { id: "in-014", kind: "instructor", text: "I must have professor Ortiz", expect: { instructor: { kind: "named", name: "Ortiz", strength: "strong" } } },

  // ------------------------------------------------------------------- soft
  { id: "so-001", kind: "soft", text: "compact schedule please", expect: { soft: ["compact"] } },
  { id: "so-002", kind: "soft", text: "I really want a compact schedule", expect: { soft: ["compact"], softStrong: ["compact"] } },
  { id: "so-003", kind: "soft", text: "back-to-back is fine", expect: { soft: ["compact"] } },
  { id: "so-004", kind: "soft", text: "don't want back-to-back", expect: { soft: ["spreadOut"] } },
  { id: "so-005", kind: "soft", text: "no back-to-back classes", expect: { soft: ["spreadOut"] } },
  { id: "so-006", kind: "soft", text: "spread my classes out", expect: { soft: ["spreadOut"] } },
  { id: "so-007", kind: "soft", text: "please spread them out", expect: { soft: ["spreadOut"], softStrong: ["spreadOut"] } },
  { id: "so-008", kind: "soft", text: "I need gaps between my classes", expect: { soft: ["spreadOut"], softStrong: ["spreadOut"] } },
  { id: "so-009", kind: "soft", text: "some breaks between classes", expect: { soft: ["spreadOut"] } },
  { id: "so-010", kind: "soft", text: "as few days on campus as possible", expect: { soft: ["fewerDays"], softStrong: ["fewerDays"] } },
  { id: "so-011", kind: "soft", text: "fewer days on campus", expect: { soft: ["fewerDays"] } },
  { id: "so-012", kind: "soft", text: "minimize my days on campus", expect: { soft: ["fewerDays"] } },
  { id: "so-013", kind: "soft", text: "I want the fewest days possible", expect: { soft: ["fewerDays"] } },
  { id: "so-014", kind: "soft", text: "minimal walking", expect: { soft: ["minimalWalking"] } },
  { id: "so-015", kind: "soft", text: "as little walking as possible", expect: { soft: ["minimalWalking"], softStrong: ["minimalWalking"] } },
  { id: "so-016", kind: "soft", text: "walk as little as possible", expect: { soft: ["minimalWalking"], softStrong: ["minimalWalking"] } },
  { id: "so-017", kind: "soft", text: "don't want to walk across campus", expect: { soft: ["minimalWalking"] } },
  { id: "so-018", kind: "soft", text: "no long walks between classes", expect: { soft: ["minimalWalking"] } },
  { id: "so-019", kind: "soft", text: "I want to get it all over with", expect: { soft: ["compact"] } },
  { id: "so-020", kind: "soft", text: "tight schedule please", expect: { soft: ["compact"] } },
  { id: "so-021", kind: "soft", text: "really need a tight schedule", expect: { soft: ["compact"], softStrong: ["compact"] } },
  { id: "so-022", kind: "soft", text: "space them out", expect: { soft: ["spreadOut"] } },
  { id: "so-023", kind: "soft", text: "short walks between buildings", expect: { soft: ["minimalWalking"] } },
  { id: "so-024", kind: "soft", text: "clump everything together", expect: { soft: ["compact"] } },
  { id: "so-025", kind: "soft", text: "I hate long gaps between classes", expect: { soft: ["spreadOut"], softStrong: ["spreadOut"] } },
  { id: "so-026", kind: "soft", text: "as few days on campus as possible please", expect: { soft: ["fewerDays"], softStrong: ["fewerDays"] } },

  // ------------------------------------------------------------------ multi
  { id: "mu-001", kind: "multi", text: "no classes before 10am or after 6pm", expect: { earliestStart: 600, latestEnd: 1080 } },
  { id: "mu-002", kind: "multi", text: "no Friday classes and nothing before 9", expect: { daysOff: ["Fri"], earliestStart: 540 } },
  { id: "mu-003", kind: "multi", text: "keep 12-1 free and no more than 15 credit hours", expect: { blockedTimes: block(ALL, 720, 780), creditMax: 15 } },
  { id: "mu-004", kind: "multi", text: "online only, no classes before 9am", expect: { mode: "online", earliestStart: 540 } },
  { id: "mu-005", kind: "multi", text: "I need CSCE 3110 and no classes on Friday", expect: { wantedCourses: ["CSCE 3110"], daysOff: ["Fri"] } },
  { id: "mu-006", kind: "multi", text: "at least 12 credits, nothing after 5pm, compact", expect: { creditMin: 12, latestEnd: 1020, soft: ["compact"] } },
  { id: "mu-007", kind: "multi", text: "weekends off and no classes before 9:30", expect: { daysOff: WE, earliestStart: 570 } },
  { id: "mu-008", kind: "multi", text: "I work Tuesdays 2-6 and prefer easier graders", expect: { blockedTimes: block(["Tue"], 840, 1080, "work"), instructor: { kind: "easierGraders", strength: "mild" } } },
  { id: "mu-009", kind: "multi", text: "Denton campus only, don't want back-to-back", expect: { campusScope: "dentonOnly", soft: ["spreadOut"] } },
  { id: "mu-010", kind: "multi", text: "only classes with open seats and no more than 2 classes a day", expect: { openSeatsOnly: true }, unsupportedTags: ["maxClassesPerDay"] },
  { id: "mu-011", kind: "multi", text: "no classes before 10am, don't schedule anything on Mondays", expect: { earliestStart: 600, daysOff: ["Mon"] } },
  { id: "mu-012", kind: "multi", text: "as few days on campus as possible and nothing after 3", expect: { soft: ["fewerDays"], softStrong: ["fewerDays"], latestEnd: 900 } },
  { id: "mu-013", kind: "multi", text: "spread them out, Frisco is fine", expect: { soft: ["spreadOut"], campusScope: "otherSitesOk" } },
  { id: "mu-014", kind: "multi", text: "no 8am classes and no more than 15 credit hours", expect: { blockedTimes: block(ALL, 480, 540), creditMax: 15 } },
  { id: "mu-015", kind: "multi", text: "skip Fridays, at least 12 credits, out by 4", expect: { daysOff: ["Fri"], creditMin: 12, latestEnd: 960 } },
  { id: "mu-016", kind: "multi", text: "I work MWF 9-2 and want dr. Patel", expect: { blockedTimes: block(["Mon", "Wed", "Fri"], 540, 840, "work"), instructor: { kind: "named", name: "Patel", strength: "mild" } } },
  { id: "mu-017", kind: "multi", text: "no classes on Tuesday or Thursday, 12 to 15 credits", expect: { daysOff: ["Tue", "Thu"], creditMin: 12, creditMax: 15 } },
  { id: "mu-018", kind: "multi", text: "in person only and nothing before 10", expect: { mode: "inPerson", earliestStart: 600 } },
  { id: "mu-019", kind: "multi", text: "compact please, no Friday classes", expect: { soft: ["compact"], daysOff: ["Fri"] } },
  { id: "mu-020", kind: "multi", text: "no classes before 9am or after 3", expect: { earliestStart: 540, latestEnd: 900 } },
  { id: "mu-021", kind: "multi", text: "at least 12 credits, avoid CSCE 4110", expect: { creditMin: 12, avoidedCourses: ["CSCE 4110"] } },
  { id: "mu-022", kind: "multi", text: "nothing after 4pm, minimal walking", expect: { latestEnd: 960, soft: ["minimalWalking"] } },
  { id: "mu-023", kind: "multi", text: "weekends off and online only", expect: { daysOff: WE, mode: "online" } },
  { id: "mu-024", kind: "multi", text: "I have practice 3 to 5 and no classes on Monday", expect: { blockedTimes: block(ALL, 900, 1020, "practice"), daysOff: ["Mon"] } },

  // ------------------------------------------------------------ unsupported
  { id: "un-001", kind: "unsupported", text: "no more than 2 classes a day", unsupportedTags: ["maxClassesPerDay"] },
  { id: "un-002", kind: "unsupported", text: "2 classes a day max", unsupportedTags: ["maxClassesPerDay"] },
  { id: "un-003", kind: "unsupported", text: "I want to be on campus twice a week", unsupportedTags: ["exactDaysPerWeek"] },
  { id: "un-004", kind: "unsupported", text: "I want to be on campus three times a week", unsupportedTags: ["exactDaysPerWeek"] },
  { id: "un-005", kind: "unsupported", text: "avoid professor Smith", unsupportedTags: ["avoidInstructor"] },
  { id: "un-006", kind: "unsupported", text: "no class with professor Boyd", unsupportedTags: ["avoidInstructor"] },
  { id: "un-007", kind: "unsupported", text: "parking is a nightmare", unsupportedTags: ["parking"] },
  { id: "un-008", kind: "unsupported", text: "parking near campus is impossible", unsupportedTags: ["parking"] },
  { id: "un-009", kind: "unsupported", text: "only 3000-level courses", unsupportedTags: ["courseLevel"] },
  { id: "un-010", kind: "unsupported", text: "upper level only", unsupportedTags: ["courseLevel"] },
  { id: "un-011", kind: "unsupported", text: "no 4000-level courses", unsupportedTags: ["courseLevel"] },
  { id: "un-012", kind: "unsupported", text: "sections that meet only once a week", unsupportedTags: ["meetingsPerWeek"] },
  { id: "un-013", kind: "unsupported", text: "no three-hour blocks", unsupportedTags: ["classDuration"] },
  { id: "un-014", kind: "unsupported", text: "3 hour classes are too long", unsupportedTags: ["classDuration"] },
  { id: "un-015", kind: "unsupported", text: "no Discovery Park", unsupportedTags: ["discoveryPark"] },
  { id: "un-016", kind: "unsupported", text: "avoid Discovery Park", unsupportedTags: ["discoveryPark"] },
  { id: "un-017", kind: "unsupported", text: "hybrid would be ideal", unsupportedTags: ["hybridMode"] },
  { id: "un-018", kind: "unsupported", text: "small classes", unsupportedTags: ["classSize"] },
  { id: "un-019", kind: "unsupported", text: "class size matters", unsupportedTags: ["classSize"] },
  { id: "un-020", kind: "unsupported", text: "professors with at least a 3.5 average GPA", unsupportedTags: ["gpaThreshold"] },
  { id: "un-021", kind: "unsupported", text: "no evening classes", unsupportedTags: ["timeOfDayBan"] },
  { id: "un-022", kind: "unsupported", text: "same professor for everything", unsupportedTags: ["sameInstructor"] },
  { id: "un-023", kind: "unsupported", text: "I want the same instructor across courses", unsupportedTags: ["sameInstructor"] },
  { id: "un-024", kind: "unsupported", text: "no classes that meet on Fridays only", expect: {} },

  // ---------------------------------------------------------------- chatter
  { id: "ch-001", kind: "chatter", text: "I like pizza", expect: {} },
  { id: "ch-002", kind: "chatter", text: "hello there", expect: {} },
  { id: "ch-003", kind: "chatter", text: "I prefer afternoons", unparseable: true },
  { id: "ch-004", kind: "chatter", text: "I'd rather not take 8ams", unparseable: true },
  { id: "ch-005", kind: "chatter", text: "idk whatever works", expect: {} },
  { id: "ch-006", kind: "chatter", text: "just make it work", expect: {} },
  { id: "ch-007", kind: "chatter", text: "I want it to feel right", unparseable: true },
  { id: "ch-008", kind: "chatter", text: "surprise me", expect: {} },
  { id: "ch-009", kind: "chatter", text: "classes are hard", expect: {} },
  { id: "ch-010", kind: "chatter", text: "I dunno, something chill", unparseable: true },
];
