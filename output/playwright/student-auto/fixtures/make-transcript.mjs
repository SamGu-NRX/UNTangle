#!/usr/bin/env node
/**
 * Regenerates synthetic-transcript.pdf, the made-up myUNT unofficial
 * transcript the student-auto journey imports through /connect.
 *
 * The PDF is written by hand (no dependencies): one page, Helvetica text,
 * one text run per line, so pdf.js reads each row as a single string the
 * same way it reads a real downloaded transcript.
 *
 * The rows mirror the sample transcript the app itself ships
 * (src/components/courses/model/sample-transcript.ts): MATH 1710, ENGL 1310
 * and CSCE 1040, completed with passing grades. Those are the courses the
 * 2026-27 catalog's own inference engine can verify from a transcript, so the
 * import produces the same model the sample flow does.
 *
 * Synthetic, not a capture: no source URL, no real student record. The
 * parser's redaction removes the labeled name and ID before matching.
 *
 * Usage: node make-transcript.mjs
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const LINES = [
  { font: "F2", size: 14, text: "University of North Texas" },
  { font: "F1", size: 11, text: "Unofficial Academic Transcript - student copy" },
  { font: "F1", size: 10, text: "Printed: 10/15/2026" },
  { font: "F2", size: 11, text: "Student: JORDAN R SAMPLE     Student ID: 1001234567" },
  { font: "F1", size: 9, text: "" },
  { font: "F2", size: 11, text: "Fall 2025" },
  { font: "F1", size: 10, text: "MATH 1710 Calculus I 3.000 3.000 B 3.000" },
  { font: "F1", size: 10, text: "ENGL 1310 College Writing I 3.000 3.000 A 3.000" },
  { font: "F1", size: 9, text: "Term GPA: 3.500" },
  { font: "F1", size: 9, text: "" },
  { font: "F2", size: 11, text: "Spring 2026" },
  { font: "F1", size: 10, text: "CSCE 1040 Computer Science II 3.000 3.000 A 3.000" },
  { font: "F1", size: 9, text: "Term GPA: 4.000" },
  { font: "F1", size: 9, text: "" },
  { font: "F1", size: 9, text: "End of transcript." },
];

const esc = (text) => text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

// One BT block per line keeps pdf.js text items aligned with the rows.
const content = LINES.map(
  (line, index) =>
    `BT /${line.font} ${line.size} Tf 72 ${740 - index * 20} Td (${esc(line.text)}) Tj ET`,
).join("\n");

const objects = [
  "<</Type /Catalog /Pages 2 0 R>>",
  "<</Type /Pages /Kids [3 0 R] /Count 1>>",
  "<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources <</Font <</F1 5 0 R /F2 6 0 R>>>>>>",
  `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
  "<</Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding>>",
  "<</Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding>>",
];

let pdf = "%PDF-1.4\n";
const offsets = [0];
for (const [index, body] of objects.entries()) {
  offsets.push(pdf.length);
  pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
}
const xrefStart = pdf.length;
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
pdf += `trailer\n<</Size ${objects.length + 1} /Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF\n`;

const out = join(dirname(fileURLToPath(import.meta.url)), "synthetic-transcript.pdf");
writeFileSync(out, pdf, "latin1");
console.log(`wrote ${out} (${pdf.length} bytes)`);
