# Optimizer auto-evaluation: real-student scenarios

Every scenario is a typed student (major, completed courses, next-term picks) with real
Spring 2027 options from `scenarios/fixtures/spring-2027-trimmed.json`. Each runs through
`buildOptimizeRequest` + `optimize` and is checked against the independent reference solver
(`frontend/tests/optimizer/reference.ts`): exact optimal cost (gap 0), the top-k cost
sequence, the diversity rule, constraint validity, and — for infeasible students — a
minimal explanation whose suggestions resolve exactly as claimed.

Re-run: `bun --no-env-file tests/optimizer/scenarios/run.ts`.

**Verdict: all scenarios pass**

Engine time across feasible scenarios: median 1ms, p95 9ms (top-k = 3, 5000ms budget per scenario).

| Scenario | Courses | Combos | Engine | Best cost | Ref best | Gap | Engine ms | Ref ms | Result |
|---|---|---|---|---|---|---|---|---|---|
| cs-freshman-job-blocks | 4 | 22,848 | optimal | 31200 | 31200 | 0 | 14 | 123 | ✅ |
| cs-sophomore-no-friday | 4 | 252 | optimal | 97200 | 97200 | 0 | 3 | 4 | ✅ |
| cs-junior-late-start | 4 | 124 | optimal | 56400 | 56400 | 0 | 3 | 2 | ✅ |
| cs-senior-capstone-locks | 4 | 3 | optimal | 168000 | 168000 | 0 | 1 | 0 | ✅ |
| cs-commuter-fewer-days | 5 | 3 | optimal | 43200 | 43200 | 0 | 1 | 0 | ✅ |
| cs-transfer-compact | 4 | 15,300 | optimal | 31200 | 31200 | 0 | 3 | 92 | ✅ |
| cs-clash-infeasible | 4 | 18 | infeasible | — | — | — | 6 | 0 | ✅ |
| cs-maxcredits-infeasible | 4 | 26,112 | infeasible | — | — | — | 19 | 92 | ✅ |
| cs-excluded-one-section | 4 | 252 | optimal | 97200 | 97200 | 0 | 1 | 2 | ✅ |
| cs-locked-async-rides-along | 4 | 56 | optimal | 57600 | 57600 | 0 | 1 | 1 | ✅ |
| ce-freshman-foundation | 4 | 2,016 | optimal | 76800 | 76800 | 0 | 2 | 12 | ✅ |
| ce-sophomore-no-evening | 4 | 105 | optimal | 55200 | 55200 | 0 | 1 | 1 | ✅ |
| ce-junior-commute | 4 | 180 | optimal | 26264 | 26264 | 0 | 1 | 6 | ✅ |
| math-freshman-calculus | 4 | 15,840 | optimal | 69280 | 69280 | 0 | 3 | 128 | ✅ |
| math-sophomore-mornings | 4 | 1,960 | optimal | 76200 | 76200 | 0 | 2 | 19 | ✅ |
| math-junior-cross-subject | 4 | 120 | optimal | 61200 | 61200 | 0 | 1 | 1 | ✅ |
| math-busi-core-late-start | 4 | 1,152 | optimal | 20400 | 20400 | 0 | 1 | 4 | ✅ |
| biol-freshman-intro-labs | 4 | 27,324 | optimal | 39600 | 39600 | 0 | 9 | 166 | ✅ |
| biol-sophomore-job-tuesdays | 4 | 96 | optimal | 55080 | 55080 | 0 | 1 | 1 | ✅ |
| biol-junior-no-mornings | 4 | 1,728 | optimal | 164080 | 164080 | 0 | 1 | 7 | ✅ |
| biol-freshman-friday-off | 4 | 22,770 | optimal | 25200 | 25200 | 0 | 1 | 109 | ✅ |
| busi-freshman-core | 4 | 1,152 | optimal | 20400 | 20400 | 0 | 1 | 7 | ✅ |
| busi-span-8week-stack | 4 | 12,096 | optimal | 24000 | 24000 | 0 | 2 | 47 | ✅ |
| busi-mwf-job | 4 | 2,232 | optimal | 84600 | 84600 | 0 | 4 | 9 | ✅ |
| busi-evening-heavy | 4 | 39,168 | optimal | 94600 | 94600 | 0 | 2 | 313 | ✅ |
| cs-walking-buffer | 4 | 80 | optimal | 39600 | 39600 | 0 | 1 | 1 | ✅ |
| cs-missing-lock-rides-along | 4 | 28 | optimal | 36000 | 36000 | 0 | 1 | 1 | ✅ |

