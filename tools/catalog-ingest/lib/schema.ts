const DAY_ENUM = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MODALITY_ENUM = ["in-person", "online", "hybrid", "unknown"] as const;

export type CandidateSection = {
  id: string;
  courseCode: string;
  title: string;
  professor: string;
  rating: number | null;
  modality?: (typeof MODALITY_ENUM)[number];
  status?: string | null;
  room?: string | null;
  meetings: CandidateMeeting[];
};

export type CandidateMeeting = {
  day: (typeof DAY_ENUM)[number];
  start: string;
  end: string;
  buildingId: string | null;
  room?: string | null;
};

export type CandidateBuilding = {
  id: string;
  name: string;
  shortName: string;
  lat: number;
  lng: number;
};

export type CandidateCourse = {
  code: string;
  title: string;
  department: string;
  creditHours: number;
  description: string;
  prerequisites: string[];
  planned: false;
};

export type CandidateTerm = {
  id: string;
  label: string;
  classesStart: string | null;
  classesEnd: string | null;
};

export type CandidateBundle = {
  term: CandidateTerm;
  buildings: CandidateBuilding[];
  courses: CandidateCourse[];
  sections: CandidateSection[];
};

export type ValidateResult = { ok: true } | { ok: false; errors: string[] };

function sortErrors(errors: string[]): string[] {
  return [...errors].sort((a, b) => {
    const ac = a.indexOf(":");
    const bc = b.indexOf(":");
    const ap = ac >= 0 ? a.slice(0, ac) : a;
    const bp = bc >= 0 ? b.slice(0, bc) : b;
    const at = ap.split(/[.\[\]]+/).filter(Boolean);
    const bt = bp.split(/[.\[\]]+/).filter(Boolean);
    for (let i = 0; i < Math.min(at.length, bt.length); i++) {
      const an = /^\d+$/.test(at[i]);
      const bn = /^\d+$/.test(bt[i]);
      if (an && bn) {
        const n = Number(at[i]) - Number(bt[i]);
        if (n !== 0) return n;
      } else if (at[i] !== bt[i]) {
        return at[i] < bt[i] ? -1 : 1;
      }
    }
    return at.length - bt.length;
  });
}

function fmt(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return `${typeof value} ${value}`;
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return String(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const TOP_LEVEL_KEYS = ["term", "buildings", "courses", "sections"] as const;

function checkKeys(
  errors: string[],
  path: string,
  obj: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      errors.push(`${path}: unknown key "${key}"`);
    }
  }
  for (const key of required) {
    if (!(key in obj)) {
      errors.push(`${path}: missing required key "${key}"`);
    }
  }
}

function checkType(
  errors: string[],
  path: string,
  value: unknown,
  expected: "string" | "number" | "boolean" | "object" | "array",
): boolean {
  const got = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
  if (got !== expected) {
    errors.push(`${path}: expected ${expected}, got ${got} ${fmt(value)}`);
    return false;
  }
  return true;
}

function checkTime(
  errors: string[],
  path: string,
  field: "start" | "end",
  value: unknown,
): value is string {
  if (!checkType(errors, `${path}.${field}`, value, "string")) return false;
  const time = value as string;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    errors.push(`${path}.${field}: ${fmt(time)} is not a valid HH:MM time`);
    return false;
  }
  return true;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function checkDate(
  errors: string[],
  path: string,
  value: unknown,
): value is string | null {
  if (value === null) return true;
  if (!checkType(errors, path, value, "string")) return false;
  const date = value as string;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    errors.push(`${path}: ${fmt(date)} is not a valid YYYY-MM-DD date`);
    return false;
  }
  const [y, m, d] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  const real = `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(utc.getUTCDate()).padStart(2, "0")}`;
  if (y < 1970 || utc.getUTCMonth() !== m - 1 || utc.getUTCDate() !== d || real !== date) {
    errors.push(`${path}: ${fmt(date)} is not a valid YYYY-MM-DD date`);
    return false;
  }
  return true;
}

export function validateBundle(input: unknown): ValidateResult {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: [`root: expected object, got ${fmt(input)}`] };
  }
  const bundle = input as Record<string, unknown>;

  for (const key of Object.keys(bundle)) {
    if (!(TOP_LEVEL_KEYS as readonly string[]).includes(key)) {
      errors.push(`root: unknown top-level key "${key}"`);
    }
  }
  for (const key of TOP_LEVEL_KEYS) {
    if (!(key in bundle)) {
      errors.push(`root: missing required top-level key "${key}"`);
    }
  }
  if (!(TOP_LEVEL_KEYS as readonly string[]).every((k) => k in bundle)) {
    return { ok: false, errors: sortErrors(errors) };
  }

  if (isPlainObject(bundle.term)) {
    const term = bundle.term;
    const termPath = "term";
    checkKeys(errors, termPath, term, ["id", "label", "classesStart", "classesEnd"], [
      "id",
      "label",
      "classesStart",
      "classesEnd",
    ]);
    if (checkType(errors, `${termPath}.id`, term.id, "string") && (term.id as string).length === 0) {
      errors.push(`${termPath}.id: must be a non-empty string`);
    }
    if (checkType(errors, `${termPath}.label`, term.label, "string") && (term.label as string).length === 0) {
      errors.push(`${termPath}.label: must be a non-empty string`);
    }
    const startVal = term.classesStart;
    const endVal = term.classesEnd;
    const startOk = checkDate(errors, `${termPath}.classesStart`, startVal);
    const endOk = checkDate(errors, `${termPath}.classesEnd`, endVal);
    if (startOk && endOk && startVal !== null && endVal !== null && startVal > endVal) {
      errors.push(
        `${termPath}: classesStart ${fmt(startVal)} must be on or before classesEnd ${fmt(endVal)}`,
      );
    }
  } else {
    errors.push(`term: expected object, got ${fmt(bundle.term)}`);
  }

  const buildingIds = new Set<string>();
  if (Array.isArray(bundle.buildings)) {
    (bundle.buildings as unknown[]).forEach((entry, i) => {
      const path = `buildings[${i}]`;
      if (!isPlainObject(entry)) {
        errors.push(`${path}: expected object, got ${fmt(entry)}`);
        return;
      }
      checkKeys(errors, path, entry, ["id", "name", "shortName", "lat", "lng"], [
        "id",
        "name",
        "shortName",
        "lat",
        "lng",
      ]);
      if (checkType(errors, `${path}.id`, entry.id, "string")) {
        if ((entry.id as string).length === 0) {
          errors.push(`${path}.id: must be a non-empty string`);
        } else {
          buildingIds.add(entry.id as string);
        }
      }
      if (checkType(errors, `${path}.name`, entry.name, "string") && (entry.name as string).length === 0) {
        errors.push(`${path}.name: must be a non-empty string`);
      }
      checkType(errors, `${path}.shortName`, entry.shortName, "string");
      checkType(errors, `${path}.lat`, entry.lat, "number");
      checkType(errors, `${path}.lng`, entry.lng, "number");
    });
  } else {
    errors.push(`buildings: expected array, got ${fmt(bundle.buildings)}`);
  }

  const courseCodes = new Set<string>();
  if (Array.isArray(bundle.courses)) {
    (bundle.courses as unknown[]).forEach((entry, i) => {
      const path = `courses[${i}]`;
      if (!isPlainObject(entry)) {
        errors.push(`${path}: expected object, got ${fmt(entry)}`);
        return;
      }
      checkKeys(errors, path, entry, ["code", "title", "department", "creditHours", "description", "prerequisites", "planned"], [
        "code",
        "title",
        "department",
        "creditHours",
        "description",
        "prerequisites",
        "planned",
      ]);
      if (checkType(errors, `${path}.code`, entry.code, "string") && !/^[A-Z]{2,4} \d{4}$/.test(entry.code as string)) {
        errors.push(`${path}.code: ${fmt(entry.code)} does not match course-code pattern`);
      }
      if (checkType(errors, `${path}.title`, entry.title, "string") && (entry.title as string).length === 0) {
        errors.push(`${path}.title: must be a non-empty string`);
      }
      if (checkType(errors, `${path}.department`, entry.department, "string") && (entry.department as string).length === 0) {
        errors.push(`${path}.department: must be a non-empty string`);
      }
      if (checkType(errors, `${path}.creditHours`, entry.creditHours, "number")) {
        const creditHours = entry.creditHours as number;
        if (!Number.isInteger(creditHours) || creditHours <= 0) {
          errors.push(
            `${path}.creditHours: expected positive integer, got ${fmt(entry.creditHours)}`,
          );
        }
      }
      checkType(errors, `${path}.description`, entry.description, "string");
      if (Array.isArray(entry.prerequisites)) {
        (entry.prerequisites as unknown[]).forEach((prereq, j) => {
          if (checkType(errors, `${path}.prerequisites[${j}]`, prereq, "string")) {
            if (!/^[A-Z]{2,4} \d{4}$/.test(prereq as string)) {
              errors.push(`${path}.prerequisites[${j}]: ${fmt(prereq)} is not a valid course code`);
            }
          }
        });
      } else {
        errors.push(`${path}.prerequisites: expected array, got ${fmt(entry.prerequisites)}`);
      }
      if ("planned" in entry) {
        if (entry.planned !== false) {
          errors.push(`${path}.planned: must be exactly false, got ${fmt(entry.planned)}`);
        }
      } else {
        errors.push(`${path}.planned: missing required key "planned"`);
      }
      if (checkType(errors, `${path}.code`, entry.code, "string")) {
        courseCodes.add(entry.code as string);
      }
    });
  } else {
    errors.push(`courses: expected array, got ${fmt(bundle.courses)}`);
  }

  const sectionIds = new Set<string>();
  if (Array.isArray(bundle.sections)) {
    (bundle.sections as unknown[]).forEach((entry, i) => {
      const path = `sections[${i}]`;
      if (!isPlainObject(entry)) {
        errors.push(`${path}: expected object, got ${fmt(entry)}`);
        return;
      }
      checkKeys(errors, path, entry, ["id", "courseCode", "title", "professor", "rating", "modality", "status", "room", "meetings"], [
        "id",
        "courseCode",
        "title",
        "professor",
        "rating",
        "meetings",
      ]);
      if (checkType(errors, `${path}.id`, entry.id, "string") && (entry.id as string).length > 0) {
        const id = entry.id as string;
        if (sectionIds.has(id)) {
          errors.push(`${path}: duplicate section id ${fmt(id)}`);
        } else {
          sectionIds.add(id);
        }
      }
      if (
        checkType(errors, `${path}.courseCode`, entry.courseCode, "string") &&
        !courseCodes.has(entry.courseCode as string)
      ) {
        errors.push(`${path}.courseCode: ${fmt(entry.courseCode)} does not resolve to a course code`);
      }
      if (checkType(errors, `${path}.title`, entry.title, "string") && (entry.title as string).length === 0) {
        errors.push(`${path}.title: must be a non-empty string`);
      }
      if (checkType(errors, `${path}.professor`, entry.professor, "string") && (entry.professor as string).length === 0) {
        errors.push(`${path}.professor: must be a non-empty string`);
      }
      if (entry.rating !== null) {
        checkType(errors, `${path}.rating`, entry.rating, "number");
      }
      if ("modality" in entry && entry.modality !== undefined) {
        if (typeof entry.modality !== "string" || !(MODALITY_ENUM as readonly string[]).includes(entry.modality)) {
          errors.push(`${path}.modality: ${fmt(entry.modality)} not in modality enum`);
        }
      }
      if ("status" in entry && entry.status !== null) {
        checkType(errors, `${path}.status`, entry.status, "string");
      }
      if ("room" in entry && entry.room !== null) {
        checkType(errors, `${path}.room`, entry.room, "string");
      }
      const modality = typeof entry.modality === "string" ? entry.modality : "unknown";
      if (Array.isArray(entry.meetings)) {
        (entry.meetings as unknown[]).forEach((meeting, j) => {
          const mPath = `${path}.meetings[${j}]`;
          if (!isPlainObject(meeting)) {
            errors.push(`${mPath}: expected object, got ${fmt(meeting)}`);
            return;
          }
          checkKeys(errors, mPath, meeting, ["day", "start", "end", "buildingId", "room"], [
            "day",
            "start",
            "end",
            "buildingId",
          ]);
          if (checkType(errors, `${mPath}.day`, meeting.day, "string") && !(DAY_ENUM as readonly string[]).includes(meeting.day as string)) {
            errors.push(`${mPath}: day ${fmt(meeting.day)} not in day enum`);
          }
          const startVal = meeting.start;
          const endVal = meeting.end;
          const startOk = checkTime(errors, mPath, "start", startVal);
          const endOk = checkTime(errors, mPath, "end", endVal);
          if (startOk && endOk) {
            if (toMinutes(startVal) >= toMinutes(endVal)) {
              errors.push(`${mPath}: start ${fmt(startVal)} must be before end ${fmt(endVal)}`);
            }
          }
          if (meeting.buildingId !== null) {
            checkType(errors, `${mPath}.buildingId`, meeting.buildingId, "string");
          }
          if ("room" in meeting && meeting.room !== null) {
            checkType(errors, `${mPath}.room`, meeting.room, "string");
          }
          if (meeting.buildingId === null) {
            if (modality !== "online") {
              errors.push(
                `${mPath}.buildingId: null buildingId is only allowed for online sections (section modality ${fmt(modality)})`,
              );
            }
          } else if (typeof meeting.buildingId === "string") {
            if (!buildingIds.has(meeting.buildingId)) {
              errors.push(`${mPath}.buildingId: ${fmt(meeting.buildingId)} does not resolve to buildings[].id`);
            }
            if (modality === "online") {
              errors.push(`${mPath}.buildingId: ${fmt(meeting.buildingId)} must be null for online sections`);
            }
          }
        });
      } else {
        errors.push(`${path}.meetings: expected array, got ${fmt(entry.meetings)}`);
      }
    });
  } else {
    errors.push(`sections: expected array, got ${fmt(bundle.sections)}`);
  }

  if (errors.length === 0) {
    return { ok: true };
  }
  return { ok: false, errors: sortErrors(errors) };
}
