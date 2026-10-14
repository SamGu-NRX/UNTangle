/**
 * Provenance of the dataset the app ships today.
 *
 * The catalog text in `courses/*.json` is real UNT text scraped from catalog.unt.edu,
 * but every bundled section is synthetic: the schedule rows in `data/compD.csv` of the
 * retired backend (sunnyD1000/UNT-Schedule-Optimizer) describe exactly 15 campus buildings, carry no term, and are not a
 * record of any real UNT semester. Bundled sections must be presented as samples, never
 * as a real term's offerings.
 *
 * `activeDataset` describes the bundle currently wired into the app via
 * `frontend/src/lib/seed-data.ts`. When the generated bundle changes, this descriptor
 * must change with it — `frontend/tests/data/data-provenance.test.ts` recomputes the
 * bundle hash and fails if the descriptor has drifted. Candidate datasets built by
 * `tools/catalog-ingest/` carry their own descriptors under `data/catalog-candidate/`
 * and are never exported as `activeDataset`; promotion is a later, reviewed change that
 * swaps the bundle and updates this descriptor together.
 */

export type DatasetDescriptor = {
  kind: "synthetic-sample" | "term";
  label: string;
  term: string | null;
  source: string;
  retrievedAt: string | null;
  bundleSha256: string;
};

export const activeDataset: DatasetDescriptor = {
  kind: "synthetic-sample",
  label: "UNT catalog text with synthetic sample sections (no term)",
  term: null,
  source:
    "catalog.unt.edu course text in courses/*.json; sections derived from compD.csv in sunnyD1000/UNT-Schedule-Optimizer (synthetic, 15 buildings, no term)",
  retrievedAt: null,
  bundleSha256: "67f325f3ae9d0c592625fc962b0dc1b56d59e5f0c2a87a7c58bcefd365dcbcf5",
};
