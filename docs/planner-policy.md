# UNTangle planner & data-handling policy

Decisions that bind how UNTangle handles planner state, authentication, and
third-party data. Each entry states the rule, why, and what would change it.
Grounded research with citations lives in the companion document
"UNTangle external-API and data-handling policy research" (workspace artifact).

## 1. Auth secrets

**Rule.** The server refuses to start in production without
`BETTER_AUTH_SECRET`; `auth.ts` throws at module load. The long-standing
in-repo development fallback remains only for non-production.
**Why.** A silent fallback secret in production lets anyone forge sessions.
**Build-phase note.** `next build` evaluates route modules with
`NODE_ENV=production`, so the guard is skipped when `NEXT_PHASE` is
`phase-production-build` — builds stay reproducible without secrets; serving
production traffic does not.
**Reverses if** the app moves to a platform that injects secrets after module
load — the check would need to move to first-request time.

## 2. UNT email domain enforcement

**Rule.** Account creation (`/sign-up/email`) requires an `@unt.edu` or
`@my.unt.edu` address, enforced **server-side** in the better-auth `before`
hook, matching the client-side check in `unt-auth.ts`. Sign-in is deliberately
not gated: any existing account keeps working.
**Why.** Client-only checks are trivially bypassed; server enforcement makes
the policy real. Gating sign-in too would lock out existing non-UNT accounts.
**Reverses if** UNTangle ever needs alumni or external collaborator accounts —
then the hook gains an allowlist rather than opening sign-in.

## 3. Planner payload handling (two layers)

**Rule.** `POST /api/planner` splits validation in two:

- *Structural* (rejects with **400** and a reason): body must be a JSON
  object; `courseStatuses` and `selectedSections` must be string→string maps;
  `optimization`/`activeDay` must be strings; `selectedMajor` string or null;
  `transcriptRecords` an array; `updatedAt` a string when present.
- *Semantic* (recovers silently in `normalizePlannerState`): unknown
  optimization keys or weekdays fall back to defaults; statuses for
  non-catalog courses and status values outside
  `completed|inProgress|notTaken` are dropped; transcript records that fail
  the `TranscriptCourseRecord` shape contract are dropped; `selectedMajor`
  must be a known major id or null.

**Why.** Structural errors mean the client is broken — fail loudly. Value
mistakes mean one bad field — keep the user's session alive and drop the junk
rather than 400 a save. Both layers run before persistence; the stored JSON is
always normalized, so `loadPlannerState` never replays untrusted shapes.
**Reverses if** the client ever legitimately stores non-catalog course data —
currently it cannot; the catalog is code-defined.

## 4. Academic-term chronology

**Rule.** Terms order chronologically via the shared comparator
`src/lib/term-chronology.ts`: parse "2025 Fall" and "Fall 2025" equally;
within a calendar year **Spring < Summer < Fall < Winter** (Winter is the
December intersession, so "Winter 2025" sorts between "Fall 2025" and
"Spring 2026"); unparseable terms (including the "Unknown term" and
"Needs review" sentinels) sort after all known terms, stable relative to each
other. Applies to `mergeTranscriptRecords` and transcript-import ordering.
**Why.** Lexicographic ordering put "Fall 2025" after "Spring 2026".
Display labels are never rewritten; only ordering changes.
**Reverses if** UNT relabels its intersession convention.

## 5. Map/transcript infrastructure limits

**Rule.** Server-side caches are bounded (LRU + TTL); failed or unresolved
provider results are never cached long-term (short TTL at most, so a good
result can replace them); keyed OpenRouteService calls are rate-limited per
IP with an in-memory limiter; cache keys and logs carry location strings and
coordinates only — no user-identifying data. Without `ORS_API_KEY` the local
resolution and approximate-route paths work exactly as before.
**Why.** The routes are unauthenticated, so memory and provider quota are the
abuse surface; user data in keys or logs would spread private data into
process memory needlessly.
**Reverses if** traffic justifies a shared cache store — the in-memory
boundaries are per-instance by design until then.

## 6. External services and private data

**Rule.** Transcript text leaves the browser only through the Puter
user-authorized path, redacted before send; the app treats third-party
retention as **unknown** and designs as if transcript text may be retained.
ORS is called server-side only (client-side ORS keys are barred by their
terms); attribution and quota facts are summarized in the research document.
Self-uploaded transcripts are treated as outside FERPA's education-records
scope, but minimization, no-retention-beyond-need, and no-sharing are
followed as product practice, not because FERPA compels it.
**Why.** Smallest defensible data surface; provider policies change, so the
app's posture does not depend on their retention promises.
**Reverses if** a signed school-official arrangement (FERPA
§ 99.31(a)(1)(i)(B)) or a provider with audited retention guarantees is
adopted.

## 7. Prerequisites outside the catalog (known case)

**Rule.** The catalog's prerequisite references include codes that are not
themselves catalog courses (123 references at audit time). The planner treats
them as unsatisfied evidence (course stays locked until the prerequisite
course is marked completed in the catalog). This is documented as a known
reconciliation case; **no catalog data is fabricated** to close the gap.
**Reverses if** the registrar's real prerequisite graph is imported — then
the referenced-but-uncataloged codes get real courses or get pruned.
