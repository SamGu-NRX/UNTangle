// Every identity and course row in this fixture is synthetic.
export const transcriptLines = [
  "University of North Texas Unofficial Transcript",
  "Name: Synthetic Student Student ID: 00000000",
  "2025 Fall",
  "Course Description Attempted Earned Grade Points",
  "CSCE 1030 Computer Science I 3.000 3.000 A 12.000",
  "MATH 1650 Pre-Calculus 5.000 5.000 B 15.000",
  "ENGL 1310 College Writing I 3.000 3.000 A 12.000",
  "2026 Spring",
  "CSCE 1040 Computer Science II 3.000 3.000 B 9.000",
  "This is a fabricated local test report. It represents no real person.",
];
export function syntheticPdf(): Uint8Array {
  const stream = `BT /F1 12 Tf 40 750 Td 18 TL ${transcriptLines.map((line, i) => `${i ? "T* " : ""}(${line.replace(/[()\\]/g, "\\$&")}) Tj`).join("\n")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
