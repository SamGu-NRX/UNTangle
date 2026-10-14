// Generates the hand-labeling worksheet from the study cache.
// Usage: bun --no-env-file tools/syllabus/make-worksheet.ts --readable=<list.json> [--cache=<dir>] [--output=<file>]
// The JSON list contains cached text filenames selected for manual review.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { extractSyllabusFacts } from "../../frontend/src/lib/syllabus/extract";

const option = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const readablePath = option("readable");
if (!readablePath) throw new Error("--readable=<list.json> is required; supply a JSON array of cached <sha1(url)>.txt filenames");
const cache = option("cache") ?? path.join(import.meta.dir, ".cache");
const rawManifest = JSON.parse(readFileSync(path.join(cache, "manifest.json"), "utf8"));
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
const readable: unknown = JSON.parse(readFileSync(readablePath, "utf8"));
if (!Array.isArray(readable) || !readable.every((file): file is string => typeof file === "string" && /^[a-f0-9]{40}\.txt$/.test(file))) {
  throw new Error("--readable must contain a JSON array of <sha1(url)>.txt filenames");
}

const out: string[] = [];
for (const f of readable) {
  const text = readFileSync(path.join(cache, "text", f), "utf8");
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
const dst = option("output") ?? "/tmp/worksheet.txt";
writeFileSync(dst, out.join("\n"));
console.log(`worksheet entries: ${out.length} chars: ${out.join("").length} -> ${dst}`);
