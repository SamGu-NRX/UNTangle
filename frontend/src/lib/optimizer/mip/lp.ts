/**
 * Minimal LP-format renderer (CPLEX LP dialect as parsed by HiGHS) for the
 * mip variant's models. The model in model.ts is expressed structurally
 * (named rows of (coefficient, column) terms); this module turns it into the
 * text the `highs` WASM solver consumes. Extra rows (no-good cuts, the tie
 * cap) are appended per solve so the base model text stays cacheable.
 */

/** One constraint row: sum(terms[i][0] * column terms[i][1]) `sense` rhs. */
export interface LpRow {
  readonly name: string;
  readonly terms: ReadonlyArray<readonly [number, number]>;
  readonly sense: "=" | "<=" | ">=";
  readonly rhs: number;
}

/** One decision variable with its objective coefficient. */
export interface LpColumn {
  readonly name: string;
  readonly objective: number;
}

export interface LpModelData {
  readonly columns: ReadonlyArray<LpColumn>;
  readonly rows: ReadonlyArray<LpRow>;
}

function formatTerm(coefficient: number, column: string, first: boolean): string {
  const abs = Math.abs(coefficient);
  const sign = coefficient < 0 ? "-" : "+";
  const value = abs === 1 ? column : `${abs} ${column}`;
  return first ? (coefficient < 0 ? `- ${value}` : value) : `${sign} ${value}`;
}

function formatNumber(value: number): string {
  // Plain decimal notation only: the HiGHS LP parser wants fixed-point
  // numbers, not JS exponent shorthand.
  return Number.isInteger(value) ? String(value) : value.toFixed(12);
}

/** Render the model (plus per-solve extra rows) as a complete LP program. */
export function renderLp(model: LpModelData, extraRows: ReadonlyArray<LpRow> = []): string {
  const names = model.columns.map((column) => column.name);

  const objectiveTerms: string[] = [];
  model.columns.forEach((column, index) => {
    if (column.objective !== 0) {
      objectiveTerms.push(formatTerm(column.objective, column.name, objectiveTerms.length === 0));
    }
  });
  // An all-zero objective still needs a (parseable) objective row.
  if (objectiveTerms.length === 0 && names.length > 0) objectiveTerms.push(`0 ${names[0]}`);

  const lines: string[] = ["Minimize", ` obj: ${objectiveTerms.join(" ")}`, "Subject To"];

  for (const row of [...model.rows, ...extraRows]) {
    if (row.terms.length === 0) continue;
    const sense = row.sense === "=" ? "=" : row.sense;
    const terms = row.terms
      .map(([coefficient, column], index) => formatTerm(coefficient, names[column] ?? `c${column}`, index === 0))
      .join(" ");
    lines.push(` ${row.name}: ${terms} ${sense} ${formatNumber(row.rhs)}`);
  }

  lines.push("Bounds");
  lines.push(" Binaries");
  for (let start = 0; start < names.length; start += 200) {
    lines.push(`  ${names.slice(start, start + 200).join(" ")}`);
  }
  lines.push(" End");
  return lines.join("\n");
}
