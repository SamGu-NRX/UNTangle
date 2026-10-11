import { describe, expect, test } from "bun:test";
import {
  validateBundle,
  type CandidateBundle,
} from "../../../tools/catalog-ingest/lib/schema";

function validBundle(): CandidateBundle {
  return {
    term: {
      id: "fall-2026",
      label: "Fall 2026",
      classesStart: "2026-08-24",
      classesEnd: "2026-12-11",
    },
    buildings: [
      { id: "art", name: "Art Building", shortName: "ART", lat: 33.2, lng: -97.1 },
      { id: "chem", name: "Chemistry Building", shortName: "CHEM", lat: 33.21, lng: -97.15 },
    ],
    courses: [
      {
        code: "ANTH 1010",
        title: "Introduction to Anthropology",
        department: "ANTH",
        creditHours: 3,
        description: "Surveys and explains the cultural and linguistic ...",
        prerequisites: [],
        planned: false,
      },
      {
        code: "BIOL 2050",
        title: "General Biology I",
        department: "BIOL",
        creditHours: 4,
        description: "Fundamentals of biology ...",
        prerequisites: ["ANTH 1010"],
        planned: false,
      },
      {
        code: "CHEM 3010",
        title: "Organic Chemistry I",
        department: "CHEM",
        creditHours: 3,
        description: "Structure and reactions of organic molecules ...",
        prerequisites: ["BIOL 2050"],
        planned: false,
      },
    ],
    sections: [
      {
        id: "anth-1010-001",
        courseCode: "ANTH 1010",
        title: "Introduction to Anthropology",
        professor: "Jamie K. Johnson",
        rating: 4.6,
        meetings: [
          { day: "Mon", start: "16:00", end: "16:50", buildingId: "art" },
          { day: "Wed", start: "16:00", end: "16:50", buildingId: "art", room: "121" },
        ],
      },
      {
        id: "biol-2050-001",
        courseCode: "BIOL 2050",
        title: "General Biology I",
        professor: "Robin Lee",
        rating: null,
        modality: "online",
        status: "Open",
        meetings: [],
      },
      {
        id: "chem-3010-001",
        courseCode: "CHEM 3010",
        title: "Organic Chemistry I",
        professor: "Maya Chen",
        rating: 3.9,
        modality: "hybrid",
        status: "Open",
        room: "CHEN 101",
        meetings: [{ day: "Fri", start: "09:00", end: "11:50", buildingId: "chem", room: "L101" }],
      },
    ],
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function defective(mutate: (bundle: Record<string, any>) => void): unknown {
  const bundle = clone(validBundle()) as Record<string, any>;
  mutate(bundle);
  return bundle;
}

function errorsOf(input: unknown): string[] {
  const result = validateBundle(input);
  if (result.ok) throw new Error("expected validation to fail");
  return result.errors;
}

describe("candidate bundle validator", () => {
  test("accepts a fully valid mini bundle", () => {
    expect(validateBundle(validBundle())).toEqual({ ok: true });
  });

  test("accepts a structurally valid bundle with rating null and modality/status/room omitted", () => {
    const bundle = clone(validBundle());
    for (const section of bundle.sections) {
      section.rating = null;
      const loose = section as unknown as Record<string, unknown>;
      delete loose.modality;
      delete loose.status;
      delete loose.room;
      for (const meeting of section.meetings) {
        delete (meeting as unknown as Record<string, unknown>).room;
      }
    }
    expect(validateBundle(bundle)).toEqual({ ok: true });
  });

  test("accepts explicit null extras (room/status null)", () => {
    const bundle = clone(validBundle());
    const hybrid = bundle.sections[2];
    hybrid.room = null;
    hybrid.status = null;
    expect(validateBundle(bundle)).toEqual({ ok: true });
  });

  test("accepts empty collections", () => {
    const bundle = clone(validBundle());
    bundle.buildings = [];
    bundle.courses = [];
    bundle.sections = [];
    expect(validateBundle(bundle)).toEqual({ ok: true });
  });

  test("accepts an online section whose meetings carry a null buildingId", () => {
    const bundle = clone(validBundle());
    bundle.sections[1].meetings = [
      { day: "Mon", start: "10:00", end: "10:50", buildingId: null, room: "Zoom" },
    ];
    expect(validateBundle(bundle)).toEqual({ ok: true });
  });

  test("rejects non-object input", () => {
    for (const input of [null, [], "bundle", 42]) {
      const result = validateBundle(input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain("expected object, got");
      }
    }
  });

  test("rejects an unknown top-level key (courseStatuses is not publishable)", () => {
    const errors = errorsOf(
      defective((b) => {
        b.courseStatuses = { "ANTH 1010": "notTaken" };
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('unknown top-level key "courseStatuses"');
  });

  test("rejects a missing top-level key (no term)", () => {
    const errors = errorsOf(
      defective((b) => {
        delete b.term;
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('missing required top-level key "term"');
  });

  test("rejects an unknown course key", () => {
    const errors = errorsOf(
      defective((b) => {
        b.courses[0].extra = 1;
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('courses[0]: unknown key "extra"');
  });

  test("rejects a day outside the day enum", () => {
    const errors = errorsOf(
      defective((b) => {
        b.sections[0].meetings[0].day = "Mndy";
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe('sections[0].meetings[0]: day "Mndy" not in day enum');
  });

  test("rejects malformed or out-of-range times", () => {
    const unpadded = errorsOf(
      defective((b) => {
        b.sections[0].meetings[0].start = "9:15";
      }),
    );
    expect(unpadded).toHaveLength(1);
    expect(unpadded[0]).toContain('.start: "9:15" is not a valid HH:MM time');

    const hourRange = errorsOf(
      defective((b) => {
        b.sections[0].meetings[0].start = "24:00";
      }),
    );
    expect(hourRange).toHaveLength(1);
    expect(hourRange[0]).toContain('.start: "24:00" is not a valid HH:MM time');

    const minuteRange = errorsOf(
      defective((b) => {
        b.sections[0].meetings[0].end = "16:60";
      }),
    );
    expect(minuteRange).toHaveLength(1);
    expect(minuteRange[0]).toContain('.end: "16:60" is not a valid HH:MM time');
  });

  test("rejects start >= end", () => {
    const equal = errorsOf(
      defective((b) => {
        b.sections[0].meetings[0].start = "16:50";
      }),
    );
    expect(equal).toHaveLength(1);
    expect(equal[0]).toContain('sections[0].meetings[0]: start "16:50" must be before end "16:50"');

    const after = errorsOf(
      defective((b) => {
        b.sections[0].meetings[0].start = "17:00";
      }),
    );
    expect(after).toHaveLength(1);
    expect(after[0]).toContain('start "17:00" must be before end "16:50"');
  });

  test("rejects a dangling buildingId reference", () => {
    const errors = errorsOf(
      defective((b) => {
        b.sections[0].meetings[0].buildingId = "zzz";
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('sections[0].meetings[0].buildingId: "zzz" does not resolve to buildings[].id');
  });

  test("rejects an online section with a non-null buildingId", () => {
    const errors = errorsOf(
      defective((b) => {
        b.sections[1].meetings = [
          { day: "Mon", start: "10:00", end: "10:50", buildingId: "art" },
        ];
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('sections[1].meetings[0].buildingId: "art" must be null for online sections');
  });

  test("rejects an in-person section with a null buildingId", () => {
    const errors = errorsOf(
      defective((b) => {
        b.sections[0].modality = "in-person";
        b.sections[0].meetings[0].buildingId = null;
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('null buildingId is only allowed for online sections (section modality "in-person")');
  });

  test("rejects a duplicate section id", () => {
    const errors = errorsOf(
      defective((b) => {
        b.sections[2].id = "anth-1010-001";
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe('sections[2]: duplicate section id "anth-1010-001"');
  });

  test("rejects a section courseCode that resolves to no course", () => {
    const errors = errorsOf(
      defective((b) => {
        b.sections[0].courseCode = "ZZZZ 9999";
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('sections[0].courseCode: "ZZZZ 9999" does not resolve to a course code');
  });

  test("rejects non-positive or non-integer creditHours", () => {
    for (const value of [0, -1, 2.5]) {
      const errors = errorsOf(
        defective((b) => {
          b.courses[0].creditHours = value;
        }),
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(`courses[0].creditHours: expected positive integer, got number ${value}`);
    }
  });

  test("rejects planned true", () => {
    const errors = errorsOf(
      defective((b) => {
        b.courses[0].planned = true;
      }),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("courses[0].planned: must be exactly false, got boolean true");
  });

  test("rejects an invalid term date and an inverted date range", () => {
    const badDate = errorsOf(
      defective((b) => {
        b.term.classesStart = "2026-13-01";
      }),
    );
    expect(badDate).toHaveLength(1);
    expect(badDate[0]).toContain('term.classesStart: "2026-13-01" is not a valid YYYY-MM-DD date');

    const notCalendar = errorsOf(
      defective((b) => {
        b.term.classesEnd = "2026-02-30";
      }),
    );
    expect(notCalendar).toHaveLength(1);
    expect(notCalendar[0]).toContain('term.classesEnd: "2026-02-30" is not a valid YYYY-MM-DD date');

    const inverted = errorsOf(
      defective((b) => {
        b.term.classesStart = "2026-12-11";
        b.term.classesEnd = "2026-08-24";
      }),
    );
    expect(inverted).toHaveLength(1);
    expect(inverted[0]).toContain('term: classesStart "2026-12-11" must be on or before classesEnd "2026-08-24"');
  });

  test("collects every defect and sorts them deterministically", () => {
    const errors = errorsOf(
      defective((b) => {
        b.courseStatuses = {};
        b.courses[0].creditHours = 0;
        b.sections[0].meetings[0].day = "Mndy";
        b.sections[2].id = "anth-1010-001";
      }),
    );
    expect(errors).toEqual([
      "courses[0].creditHours: expected positive integer, got number 0",
      'root: unknown top-level key "courseStatuses"',
      'sections[0].meetings[0]: day "Mndy" not in day enum',
      'sections[2]: duplicate section id "anth-1010-001"',
    ]);
  });

  test("sorts index paths numerically, not lexicographically", () => {
    const bundle = clone(validBundle()) as Record<string, any>;
    for (let i = 3; i <= 10; i++) {
      const extra = clone(bundle.sections[0]);
      extra.id = `filler-${i}`;
      bundle.sections[i] = extra;
    }
    bundle.sections[2].id = "anth-1010-001";
    bundle.sections[10].meetings[0].day = "Sndy";
    const errors = errorsOf(bundle);
    const paths = errors.map((e) => e.slice(0, e.indexOf(":")));
    expect(paths).toEqual(["sections[2]", "sections[10].meetings[0]"]);
  });
});
