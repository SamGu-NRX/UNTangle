import { expect, test } from "bun:test";
import { parseConnectTranscript } from "../../src/lib/connect/import";
import { transcriptLines } from "../../../tools/mock-myunt/pdf";
test("rendered transcript uses the existing local parser and contains course records only", async () => {
  const result = await parseConnectTranscript({ kind: "transcript-text", text: transcriptLines.join("\n") }, new AbortController().signal);
  expect(result.records.map(row => row.code)).toEqual(["CSCE 1030", "ENGL 1310", "MATH 1650", "CSCE 1040"]);
  expect(result.records[0]).toMatchObject({ term: "2025 Fall", grade: "A", appliedStatus: "completed" });
  expect(JSON.stringify(result)).not.toContain("Synthetic Student");
  expect(JSON.stringify(result)).not.toContain("00000000");
});
test("an aborted parsing request cannot start extraction or produce course records", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(parseConnectTranscript({ kind: "transcript-text", text: transcriptLines.join("\n") }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
});
