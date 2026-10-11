# selftest — prove the eval harness can fail

Bun tests that exercise the real runner (`evals/run.ts`, spawned as a bounded
subprocess) against throwaway fixtures. They prove the harness's failure
contract, not the app's behavior:

| file | proves |
| --- | --- |
| `runner-args.test.ts` | bad args are refused with **exit 2** (missing `--target-sha`, short SHA, no args, unknown `--suite`) — no stack, no scorecard |
| `runner-case-accounting.test.ts` | case outcomes are accounted honestly: green run **exit 0**, a failing case **exit 1** (returned fail, thrown case, crashed `describe()`), with the case record, summary line, and a validator-clean scorecard |
| `runner-infra-exit3.test.ts` | a preflight/stack step failure is an honest **exit 3**: scorecard still written, `infrastructure.brokenStep` names the broken step, every declared case is `not-applicable` with the honest not-run note |
| `planted-failure.test.ts` | a deliberately planted data defect is **caught**: one mutated byte in a fixture dataset flips the same (byte-identical) detector from pass to fail — the mirror of the optimizer/data suites' planted descriptor-hash-mismatch proof |

Run:

```sh
cd evals
bun install          # once; the real runner imports pg at module load
bun test selftest/
```

Full-suite check (includes the pre-existing `suites/optdata-lib.test.ts`):

```sh
cd evals && bun test
```

## How the fixtures work

- **Fake target** — a temp directory holding only `evals/CONTRACT.md` (the
  runner's only hard requirement), deliberately NOT a git repo.
- **Stubbed harness copy** — a full `cp` of `evals/` into the fixture root
  whose `stack.ts` is replaced by a healthy stub (`helpers.ts`'s
  `STUB_STACK_TS`). The copied `run.ts` is byte-identical to the real one, so
  the accounting logic under test is real while no Postgres, backend,
  frontend build, or browser is ever booted.
- **Real stack sabotage** — `runner-infra-exit3.test.ts` uses the real,
  unstubbed harness: the non-git fake target makes the real `submodule-backend`
  preflight step fail within seconds, exercising the identical
  `step()` → `StackBootError` → infra-scorecard code path the broken-Postgres
  exit-3 reference went through, at the earliest breakable step.
- Every fixture lives in a unique `mkdtemp` dir and is removed after the run.

## Observations for the harness owner (not fixed here)

Code-reading while writing these tests surfaced two latent paths this suite
does not exercise (reaching either requires booting the real backend or an
unwritable `--out`; fixing either is a design call above this suite's scope):

1. **Raw (non-step) preflight errors can never emit their infra scorecard.**
   In `run.ts`'s catch, a non-`StackBootError` gets `brokenStep: "(unknown
   step)"` and `stackSteps: []` — but `validateScorecard` requires a
   non-empty `stack` array, so `writeScorecard` throws and the runner crashes
   with exit 1 and no scorecard, instead of the documented exit 3. Today the
   only cheaply reachable raw error is the `pgdata` guard in `stack.ts`
   (expensive to reach: it sits behind the backend install/build steps); out-dir
   errors crash earlier, in `writeOutputs`' own `mkdirSync`.
2. **An unwritable `--out` misreports as a case failure.** When a path
   component of `--out` is a file, `writeOutputs` throws `ENOTDIR` and the
   runner exits 1 ("case failures") with no scorecard — a usage-shaped error
   reported with the case-failure exit code.

## Scope

Only this directory was added; no evals core file changed. The selftest files
follow the existing `suites/` convention of sitting outside
`evals/tsconfig.json`'s include set; they are strict-typechecked with the
same compiler options (`bun x tsc --noEmit --strict ... selftest/*.ts`).
