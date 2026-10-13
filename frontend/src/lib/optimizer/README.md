# Schedule optimizer — round 1

Round 1 compares three schedule optimizers against one shared benchmark and recommends a
winner to the optimizer council. The current optimizer is `recommendSections` in
`../planner.ts` (an exhaustive depth-first enumeration with a conflict check, single best
result, walking term in miles, no time windows, days off, alternatives, infeasibility
explanations, or time bound). This round does **not** change the planner or the UI; the
winner gets wired in by the integration task.

## Layout

- `types.ts` — the frozen request/result contract (`optimize`, `OptimizeRequest`,
  `OptimizeResult`), including the local walking-time types. Integration replaces the
  local walking-time declarations with the shared import from
  `@/lib/campus/walking-times.ts`.
- `bench/` — the benchmark: seeded instance generator, brute-force exact reference
  (ground truth on enumerable instances), an independent hard-constraint checker that
  shares no code with any variant, the IIS reference, the runner, and committed results.
- `bnb/`, `mip/`, `lns/` — the three variants (one sub-thread each):
  - **bnb** — exact branch-and-bound with admissible bounds, conflict precomputation,
    k-best search;
  - **mip** — mixed-integer program solved by an open-source WASM solver (HiGHS), k-best
    via no-good cuts;
  - **lns** — constraint propagation plus large-neighborhood search for big instances.

Tests live in `../../../tests/optimizer/`.

## Contract in one paragraph

`optimize(req)` is async so a WASM solver can initialize (`initMs` is reported
separately from `searchMs`). The request carries its own data (sections with meetings in
minutes after midnight and building ids), the requested course codes, locks, exclusions,
hard constraints (earliest start, latest end, days off, max credits, blocked time ranges,
minimum transfer time between buildings), explicit soft weights in stated units (gap
minutes, walking seconds, early-start minutes, late-end minutes, days on campus, rating
points, GPA points, unknown-walking pairs), `k`, a millisecond time budget, and a
`WalkingTimeFn`. An unknown walking time is never free: it counts as a separate penalty
and is reported in the breakdown. Results return a status (`optimal` needs a completed
proof; a search that ran out of time is `timeout`; `infeasible` requires proof) with up
to `k` schedules scored in those units, a defined diversity measure, and deterministic
tie-breaking by sorted section ids. Infeasible results carry an irreducible infeasible
subset: courses and constraints that cannot all hold, where removing any single member
makes the rest feasible.

## Data honesty

The bundled catalog's 2,704 sections (656 courses, 15 buildings) are synthetic samples,
not a real term's offerings. The benchmark also generates harder synthetic instances.
No private user data is used anywhere.

## Milestones

1. **M1 — contract + benchmark**: `types.ts`, generator, brute-force reference,
   independent checker, IIS reference, runner, strict tests. This milestone.
2. **M2 — three variants** on the frozen contract, each with zero hard-constraint
   violations and brute-force agreement on enumerable instances.
3. **M3 — comparison**: every variant through the benchmark on identical seeds; raw
   results and a comparison table committed; winner recommended with graftable ideas.
