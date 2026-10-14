// Dumps full grading-table context for entries whose tables were truncated
// in the worksheet. Usage: bun --no-env-file tools/syllabus/dump-tables.ts
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dir, "../..");
const entries: Array<[string, RegExp]> = [
  ["2c9683edecd47668b766dd10178e996646421318", /Assignment Name Weight/i],
  ["3b36d995e73a9aab5d66a34e14643d620e6e390e", /Activities and Assessments Percentage/i],
  ["566716274a1f2ea8d206a7b5831b35c8a1869fb8", /ASSESSMENTS Percentage/i],
  ["6652c54ca679b7d623fd0a6243e47a976156adc5", /Assessments and Grading/i],
  ["675493165524d0e3392cad10944f7d6d140962eb", /Grading Scale .{0,40}Class Participation/i],
  ["6f7e6c98d48e93f69ef8d49f09ccf6bc6f8b8e77", /where the grades come from/i],
  ["79ea149e0d8c839e0023a9ee9f7695ac23a26a92", /Assessing|Grading/i],
  ["7c1dac403e0f440fe8683e455f197929cae2543e", /weighted combination/i],
  ["420d6d0d4eb344673a43770d6d15147e873a9834", /Activities \(undergraduate\)/i],
  ["4cfca730d6620eed3ece424667ccc48d38edd976", /grading|Grade Distribution|components/i],
  ["a1f7871a8dfa8492ac217a8be1f1adb0766711bb", /weighted as follows/i],
  ["ac2e4902053c30d7bc28b0a1750a9d7805609ded", /FINAL GRADE %/i],
  ["bf3264fa10c29b22caad260f305f0c2f1d7f1928", /Assignment % of Final Grade/i],
  ["0b53402c4272ec5ea5cb577252f06e8ba0d6af2f", /FINAL GRADE PERCENTAGE/i],
  ["56dce29ee3c06f8b85a31f462ca1257d3f717b38", /Participation and Attendance/i],
];
for (const [hash, re] of entries) {
  const text = readFileSync(path.join(root, "tools/syllabus/.cache/text", `${hash}.txt`), "utf8");
  const flat = text.replace(/\s+/g, " ");
  const m = re.exec(flat);
  console.log(`\n=== ${hash}`);
  if (!m) {
    console.log("  (no match)");
    continue;
  }
  console.log("  | " + flat.slice(Math.max(0, m.index - 50), m.index + 900));
}
