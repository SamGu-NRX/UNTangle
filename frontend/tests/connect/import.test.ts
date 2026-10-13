import { expect, test } from "bun:test";
import { parseConnectTranscript } from "../../src/lib/connect/import";
import { missingApprovedRecords } from "../../src/lib/connect/import-confirmation";
import { transcriptLines } from "../../../tools/mock-myunt/pdf";
test("rendered transcript uses the existing local parser and contains course records only", async () => {
  const result = await parseConnectTranscript(
    { kind: "transcript-text", text: transcriptLines.join("\n") },
    new AbortController().signal,
  );
  expect(result.records.map((row) => row.code)).toEqual([
    "CSCE 1030",
    "ENGL 1310",
    "MATH 1650",
    "CSCE 1040",
  ]);
  expect(result.records[0]).toMatchObject({
    term: "2025 Fall",
    grade: "A",
    appliedStatus: "completed",
  });
  expect(JSON.stringify(result)).not.toContain("Synthetic Student");
  expect(JSON.stringify(result)).not.toContain("00000000");
});
test("an aborted parsing request cannot start extraction or produce course records", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    parseConnectTranscript(
      { kind: "transcript-text", text: transcriptLines.join("\n") },
      controller.signal,
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
});

test("identity fields inside an unknown course title are removed before the parser sees them", async () => {
  const text =
    "2025 Fall\nZZZZ 1234 Name: Synthetic Person Student ID: 01234567 3.000 3.000 A 12.000";
  const result = await parseConnectTranscript(
    { kind: "transcript-text", text },
    new AbortController().signal,
  );
  expect(result.records).toHaveLength(1);
  expect(result.records[0].title).toContain("[redacted]");
  expect(result.records[0].title).not.toContain("Synthetic Person");
  expect(result.records[0].title).not.toContain("01234567");
});

test("an approved import survives when its records are in the adopted planner", async () => {
  const { records } = await parseConnectTranscript(
    { kind: "transcript-text", text: transcriptLines.join("\n") },
    new AbortController().signal,
  );
  expect(missingApprovedRecords(records, records)).toEqual([]);
});

test("an adopted plan without the approved batch needs those courses re-applied", async () => {
  const { records } = await parseConnectTranscript(
    { kind: "transcript-text", text: transcriptLines.join("\n") },
    new AbortController().signal,
  );
  expect(
    missingApprovedRecords(records.slice(0, 2), []).map((row) => row.code),
  ).toEqual(["CSCE 1030", "ENGL 1310"]);
});

test("partial adoption retains matching approvals and restores changed statuses", async () => {
  const { records } = await parseConnectTranscript(
    { kind: "transcript-text", text: transcriptLines.join("\n") },
    new AbortController().signal,
  );
  const current = records.slice(0, 2).map((record) => ({
    ...record,
    appliedStatus:
      record.code === "ENGL 1310" ? ("ignored" as const) : record.appliedStatus,
  }));
  expect(
    missingApprovedRecords(records.slice(0, 3), current).map((row) => row.code),
  ).toEqual(["ENGL 1310", "MATH 1650"]);
});
