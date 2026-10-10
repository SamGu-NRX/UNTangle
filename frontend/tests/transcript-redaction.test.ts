/**
 * Privacy tests for transcript redaction (frontend/src/lib/transcript-import.ts).
 *
 * Every fixture below is fabricated synthetic data: invented student names,
 * fake 8-digit IDs, fake addresses, and fake digit runs that only resemble
 * SSNs and phone numbers. No real person's transcript data appears here.
 *
 * Known limits recorded per the frontend README — these are documented
 * behavior, NOT defects:
 * - Text redaction is label-anchored: `Name:` is only redacted when followed
 *   by `Student ID:`, and `Student Address:` only up to `Print Date:`.
 *   Unexpected labels or formats pass through.
 * - Rendered-page masking is positional, not semantic: only the top 20% of
 *   page 1 (top 7.5% of later pages) is painted over; identity text anywhere
 *   else on a rendered page is not removed.
 */
import { describe, expect, it } from "bun:test";
import {
  buildTranscriptPrompt,
  redactRenderedTranscriptPage,
  redactTranscriptText,
} from "@/lib/transcript-import";

const SYNTHETIC_TRANSCRIPT = `UNIVERSITY OF NORTH TEXAS (synthetic fixture) - Unofficial Transcript
Name: Test Student        Student ID: 10012345
UNT ID: 10012345   EMPLID: 88990077
DOB: 04/05/2003
Student Address: 1234 Fake Street, Denton, TX 76201   Print Date: 10/01/2026
Email: test.student@example.invalid
SSN: 123-45-6789
Phone: 817-555-0142

2023 Fall
CSCE 1030 Computer Science I  3.000  3.000  A  3.000
MATH 1650 Precalculus  3.000  3.000  B  3.000

2024 Spring
CSCE 2110 Data Structures  3.000  3.000  EN  0.000`;

describe("redactTranscriptText (synthetic data only)", () => {
  const redacted = redactTranscriptText(SYNTHETIC_TRANSCRIPT);

  it("redacts the labeled student name", () => {
    expect(redacted).toContain("Name: [redacted]");
    expect(redacted).not.toContain("Test Student");
  });

  it("redacts the labeled student ID", () => {
    expect(redacted).toContain("Student ID: [redacted]");
    expect(redacted).not.toContain("Student ID: 10012345");
  });

  it("redacts UNT ID / EMPLID labeled digit runs", () => {
    expect(redacted).toContain("[redacted student id]");
    expect(redacted).not.toContain("EMPLID: 88990077");
  });

  it("redacts the labeled date of birth", () => {
    expect(redacted).toContain("[redacted birth date]");
    expect(redacted).not.toContain("04/05/2003");
  });

  it("redacts the student address up to the Print Date label", () => {
    expect(redacted).toContain("Student Address: [redacted]");
    expect(redacted).not.toContain("1234 Fake Street");
    // The terminator label itself must survive so the parser keeps context.
    expect(redacted).toContain("Print Date: 10/01/2026");
  });

  it("redacts email addresses", () => {
    expect(redacted).toContain("[redacted email]");
    expect(redacted).not.toContain("test.student@example.invalid");
  });

  it("redacts SSN-like 3-2-4 digit runs", () => {
    expect(redacted).toContain("[redacted id]");
    expect(redacted).not.toContain("123-45-6789");
  });

  it("redacts phone-like 3-3-4 digit runs", () => {
    expect(redacted).toContain("[redacted phone]");
    expect(redacted).not.toContain("817-555-0142");
  });

  it("keeps course, term, and grade rows intact", () => {
    expect(redacted).toContain("CSCE 1030 Computer Science I  3.000  3.000  A  3.000");
    expect(redacted).toContain("MATH 1650 Precalculus  3.000  3.000  B  3.000");
    expect(redacted).toContain("CSCE 2110 Data Structures  3.000  3.000  EN  0.000");
    expect(redacted).toContain("2023 Fall");
    expect(redacted).toContain("2024 Spring");
  });

  // Known limit (README), documented behavior not a defect: the Name label is
  // only redacted when followed by Student ID. Other formats pass through.
  it("documents the label-anchored limit for names without a Student ID label", () => {
    const unlabeled = redactTranscriptText("Registrant: Test Student\nCSCE 1030 3.000 3.000 A 3.000");
    expect(unlabeled).toContain("Test Student");
  });

  // Known limit (README): identity text outside labeled positions is never
  // touched by text redaction.
  it("documents that a bare 8-digit ID without a label passes through", () => {
    const bare = redactTranscriptText("Reference 10012345\nCSCE 1030 3.000 3.000 A 3.000");
    expect(bare).toContain("10012345");
  });

  it("keeps synthetic identity fields out of the outbound AI prompt", () => {
    const prompt = buildTranscriptPrompt(SYNTHETIC_TRANSCRIPT);
    expect(prompt).not.toContain("Test Student");
    expect(prompt).not.toContain("10012345");
    expect(prompt).not.toContain("123-45-6789");
    expect(prompt).not.toContain("817-555-0142");
    expect(prompt).not.toContain("test.student@example.invalid");
    // Course evidence is intentionally still part of the prompt (README: the
    // course, term, and grade rows are always part of what is sent).
    expect(prompt).toContain("CSCE 1030");
  });
});

// Recording stub for the 2D context: redactRenderedTranscriptPage only draws
// (save/restore, fillRect, fillText), so capturing calls is enough to assert
// the masking bands without a real canvas implementation.
type RecordedCall = { op: string; args: unknown[]; fillStyle: string; font: string };

function recordingContext() {
  const calls: RecordedCall[] = [];
  let fillStyle = "";
  let font = "";
  const context = {
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(value: string) {
      fillStyle = value;
    },
    get font() {
      return font;
    },
    set font(value: string) {
      font = value;
    },
    save: () => calls.push({ op: "save", args: [], fillStyle, font }),
    restore: () => calls.push({ op: "restore", args: [], fillStyle, font }),
    fillRect: (...args: unknown[]) =>
      calls.push({ op: "fillRect", args, fillStyle, font }),
    fillText: (...args: unknown[]) =>
      calls.push({ op: "fillText", args, fillStyle, font }),
  } as unknown as CanvasRenderingContext2D;
  return { calls, context };
}

const STUB_CANVAS = { width: 1200, height: 1600 } as HTMLCanvasElement;

describe("redactRenderedTranscriptPage (positional page masking)", () => {
  it("masks the top 20% of page 1 with a white band and a banner", () => {
    const { calls, context } = recordingContext();
    redactRenderedTranscriptPage(STUB_CANVAS, context, 1);

    const band = calls.find((call) => call.op === "fillRect");
    expect(band).toBeDefined();
    // 1600 * 0.2 = 320px tall band, spanning the full page width.
    expect(band?.args).toEqual([0, 0, 1200, 320]);
    expect(band?.fillStyle).toBe("#ffffff");

    const banner = calls.find((call) => call.op === "fillText");
    expect(banner?.args[0]).toBe("student identity redacted");
    // The banner is drawn inside the masked band.
    expect(Number(banner?.args[2])).toBeLessThan(320);

    expect(calls[0]?.op).toBe("save");
    expect(calls.at(-1)?.op).toBe("restore");
  });

  it("masks a smaller 7.5% band on later pages", () => {
    const { calls, context } = recordingContext();
    redactRenderedTranscriptPage(STUB_CANVAS, context, 2);

    const band = calls.find((call) => call.op === "fillRect");
    // 1600 * 0.075 = 120px tall band on page 2+.
    expect(band?.args).toEqual([0, 0, 1200, 120]);
  });

  // Known limit (README), documented behavior not a defect: masking is
  // positional only. Identity text below the top band of a rendered page is
  // not removed; the function paints exactly one band plus the banner.
  it("paints exactly one masking band and one banner per page (positional only)", () => {
    const { calls, context } = recordingContext();
    redactRenderedTranscriptPage(STUB_CANVAS, context, 1);
    expect(calls.filter((call) => call.op === "fillRect").length).toBe(1);
    expect(calls.filter((call) => call.op === "fillText").length).toBe(1);
  });
});
