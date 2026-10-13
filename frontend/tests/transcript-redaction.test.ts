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
 */
import { describe, expect, it } from "bun:test";
import { buildLocalFallbackPayload, redactTranscriptText } from "@/lib/transcript-import";

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

  it("keeps synthetic identity fields out of the parsed course rows", () => {
    const rows = JSON.stringify(buildLocalFallbackPayload(redacted).records);
    expect(rows).not.toContain("Test Student");
    expect(rows).not.toContain("10012345");
    expect(rows).not.toContain("123-45-6789");
    expect(rows).not.toContain("817-555-0142");
    expect(rows).not.toContain("test.student@example.invalid");
    expect(rows).toContain("CSCE 1030");
  });
});
