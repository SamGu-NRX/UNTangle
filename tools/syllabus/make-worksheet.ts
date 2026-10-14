// Generates the hand-labeling worksheet from the study cache.
// Usage: bun --no-env-file tools/syllabus/make-worksheet.ts [output]
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { extractSyllabusFacts } from "../../frontend/src/lib/syllabus/extract";

const root = path.join(import.meta.dir, "../..");
const rawManifest = JSON.parse(readFileSync(path.join(root, "tools/syllabus/.cache/manifest.json"), "utf8"));
const manifest: Array<{
  syllabusUrl: string;
  courseCode?: string;
  section?: string;
  faculty?: string;
  profileUrl?: string;
  textChars?: number;
}> = Array.isArray(rawManifest)
  ? rawManifest
  : ((rawManifest.entries ?? Object.values(rawManifest)[0] ?? []) as typeof manifest);
const byKey = new Map(manifest.map((r) => [createHash("sha1").update(r.syllabusUrl).digest("hex"), r]));
const readable = JSON.parse(readFileSync("/tmp/readable.json", "utf8")) as string[];

const out: string[] = [];
for (const f of readable) {
  const text = readFileSync(path.join(root, "tools/syllabus/.cache/text", f), "utf8");
  const meta = byKey.get(f.replace(".txt", ""));
  let d = `\n=== ${f}\n`;
  d += `META ${JSON.stringify({ course: meta?.courseCode, section: meta?.section, faculty: meta?.faculty, profileUrl: meta?.profileUrl, syllabusUrl: meta?.syllabusUrl, chars: meta?.textChars })}\n`;
  const facts = extractSyllabusFacts(text);
  d += `EXT attendance: ${facts.attendancePolicy.found ? JSON.stringify(facts.attendancePolicy.source.quote) : "NOT FOUND"}\n`;
  d += `EXT examCount: ${facts.examCount.found ? `${facts.examCount.count} | ${JSON.stringify(facts.examCount.source.quote)}` : "NOT FOUND"}\n`;
  d += `EXT grading: ${facts.gradingWeights.found ? JSON.stringify(facts.gradingWeights.components) : "NOT FOUND"}\n`;
  const flat = text.replace(/\s+/g, " ");
  const sents = flat.split(/(?<=[.!?])\s+/);
  const pick = (pred: (s: string) => boolean, n: number) =>
    sents.filter(pred).slice(0, n).map((s) => `  | ${s.slice(0, 250)}`);
  d += `ATT:\n${pick((s) => /\b(attendance|absen|tard)/i.test(s) && s.length > 40, 4).join("\n") || "  | none"}\n`;
  d += `EXAM:\n${pick((s) => /\b(exams?|midterms?|finals?)\b/i.test(s) && /\b(there (are|will be)|consists? of|\d exams?|\bone|two|three|four|five|six|seven)\b/i.test(s), 4).join("\n") || "  | none"}\n`;
  d += `GRADE:\n${pick((s) => /\d+(\.\d+)?\s*%|\b\d+\s*points?\b/i.test(s) && /(grade|grading|assessment|worth|weight|exam|quiz|homework|assignment|participation|lab|project|final|midterm|attendance)/i.test(s), 8).join("\n") || "  | none"}\n`;
  out.push(d);
}
const dst = process.argv[2] ?? "/tmp/worksheet.txt";
writeFileSync(dst, out.join("\n"));
console.log(`worksheet entries: ${out.length} chars: ${out.join("").length} -> ${dst}`);
