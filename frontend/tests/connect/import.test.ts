import { expect, test } from "bun:test";
import { parseConnectTranscript } from "../../src/lib/connect/import";
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

test("a PDF with no text layer is a scan or a photo", async () => {
  await expect(
    parseConnectTranscript({ kind: "transcript-text", text: "  \n \n " }, new AbortController().signal),
  ).rejects.toMatchObject({ name: "ImportProblem", kind: "notext" });
});

test("a degree audit is refused by name before its course codes are read as rows", async () => {
  const audit = "Academic Advisement Report\nRequirement: Computer Science core\nCSCE 1030 Taken 3.00 A\nCSCE 2110 Not taken";
  await expect(parseConnectTranscript({ kind: "transcript-text", text: audit }, new AbortController().signal)).rejects.toMatchObject({
    kind: "wrongfile",
    document: "degree audit",
  });
});

test("a transcript that mentions a degree audit is still read as a transcript", async () => {
  const text = `Unofficial Transcript (see your degree audit for requirements)\n${transcriptLines.join("\n")}`;
  const result = await parseConnectTranscript({ kind: "transcript-text", text }, new AbortController().signal);
  expect(result.records.length).toBeGreaterThan(0);
});

test("text with no course rows says so, with where to find the transcript", async () => {
  await expect(
    parseConnectTranscript({ kind: "transcript-text", text: "A letter about parking permits." }, new AbortController().signal),
  ).rejects.toMatchObject({ kind: "unreadable", message: expect.stringContaining("Unofficial Transcript") });
});

test("reading reports its two stages in order", async () => {
  const stages: string[] = [];
  await parseConnectTranscript({ kind: "transcript-text", text: transcriptLines.join("\n") }, new AbortController().signal, (stage) =>
    stages.push(stage),
  );
  expect(stages).toEqual(["read", "match"]);
});

test("a PDF that pdf.js can't open is an unreadable-file problem, not a pdf.js error", async () => {
  const broken = new File(["%PDF-1.7\nthis is not a real PDF body"], "broken.pdf", { type: "application/pdf" });
  await expect(parseConnectTranscript(broken, new AbortController().signal)).rejects.toMatchObject({
    name: "ImportProblem",
    kind: "unreadable",
  });
});

test("a file that isn't a PDF says so", async () => {
  const text = new File(["hello"], "notes.pdf", { type: "application/pdf" });
  await expect(parseConnectTranscript(text, new AbortController().signal)).rejects.toMatchObject({
    kind: "unreadable",
    message: expect.stringContaining("isn't a PDF"),
  });
});
