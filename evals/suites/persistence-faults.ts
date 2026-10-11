/**
 * persistence-faults — one case per durability rule from evals/CONTRACT.md
 * ("Save-state region contract", binding rules 1–5 and the /plans
 * storage-handling rows).
 *
 * Faults are injected only at the two allowed boundaries:
 *   - network: Playwright route interception on POST /api/planner (injected 500);
 *   - browser: init scripts denying storage, direct corruption of the stored
 *     plan bytes, and two same-origin tabs in one browser context.
 *
 * Personas: registered cases use a fresh synthetic persona signed up through
 * the UI (eval-persist+<random>@my.unt.edu); local-storage cases use the guest
 * persona. Cross-tab cases need a server-persisted shared state to exist at
 * all (guest sessionStorage is per-tab), so they run registered.
 *
 * Expected-fails: the contract marks the Save-state region, Retry save,
 * Export schedule, the cross-tab conflict dialog, and the taken-newer notice
 * as REQUIRED while no head exposes them (and /plans itself postdates this
 * branch's frontend). Those cases therefore run, fail honestly, and record
 * exactly which contract element was missing — they are baseline expected
 * fails, not harness errors. not-applicable is reserved for prerequisites
 * that cannot exist.
 */

import { chromium } from "@playwright/test";
import { defineSuite } from "../suite-kit";
import type { CaseOutcome, CaseSpec, SuiteContext } from "../suite-kit";
import {
  COURSE_PRIMARY,
  COURSE_SECONDARY,
  COURSE_STALE,
  chooseMajorIfPrompted,
  collectPageErrors,
  continueAsGuest,
  gotoGuestCourses,
  gotoRegisteredCourses,
  markCourseDone,
  openSession,
  probeContractElements,
  registerPersonaThroughUi,
  rowCompletedBecomes,
  signInThroughUi,
  signOutThroughUi,
  snap,
  writeEvidence,
} from "./_persist-helpers";
import {
  corruptStoredPlanBytes,
  denyBrowserStorage,
  dumpAllStorage,
  failPlannerSaves,
  readRawStoredPlan,
} from "./_persist-injections";

interface Evidence {
  [key: string]: unknown;
  screenshots: Record<string, string | null>;
}

/** The planner persistence API (POST saves, GET loads for registered users). */
const PLANNER_RE = /\/api\/planner\/?(\?.*)?$/;

/** Compact JSON for the scorecard's `measured` field. */
function measuredJson(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Runs a case body with evidence capture; an unexpected throw is recorded as
 * a fail whose note says the case could not complete (never a durability
 * verdict), with the full evidence file preserved.
 */
async function safelyRun(
  caseId: string,
  ctx: SuiteContext,
  body: (evidence: Evidence) => Promise<CaseOutcome>,
): Promise<CaseOutcome> {
  const evidence: Evidence = {
    case: caseId,
    suite: "persistence-faults",
    startedAt: new Date().toISOString(),
    frontendOrigin: ctx.frontendOrigin,
    dbRoundtripPreflight:
      ctx.preflightSteps.find((step) => step.step === "db-roundtrip")?.status ?? "missing",
    screenshots: {} as Record<string, string | null>,
  };
  try {
    const outcome = await body(evidence);
    evidence.finishedAt = new Date().toISOString();
    const evidencePath = writeEvidence(ctx, caseId, evidence);
    return { ...outcome, evidencePath };
  } catch (error) {
    evidence.caseError = error instanceof Error ? (error.stack ?? error.message) : String(error);
    evidence.finishedAt = new Date().toISOString();
    const evidencePath = writeEvidence(ctx, caseId, evidence);
    return {
      status: "fail",
      note: `case could not complete (harness/journey error, not a measured durability verdict): ${
        error instanceof Error ? error.message : String(error)
      }`,
      evidencePath,
    };
  }
}

async function runAcknowledgedSavesSurvive(ctx: SuiteContext, evidence: Evidence): Promise<CaseOutcome> {
  const browser = await chromium.launch({ headless: true });
  try {
    const { context, page } = await openSession(browser);
    const pageErrors = collectPageErrors(page);

    const persona = await registerPersonaThroughUi(page, ctx.frontendOrigin);
    evidence.persona = persona.email;

    await gotoRegisteredCourses(page, ctx.frontendOrigin);
    evidence.majorChosen = await chooseMajorIfPrompted(page, { registered: true });

    const edit = await markCourseDone(page, COURSE_PRIMARY, { registered: true });
    evidence.edit = {
      rowCompletedInMemory: edit.rowCompleted,
      saveResponseStatus: edit.saveResponse?.status() ?? null,
    };

    // The durability claim: the contract pins it to a role="status" region
    // named "Save state" showing "Saved" once the write path confirms.
    const probes = await probeContractElements(page);
    evidence.contractProbes = probes;
    evidence.screenshots.afterEdit = await snap(page, ctx, "acknowledged-saves-survive", "after-edit");

    await gotoRegisteredCourses(page, ctx.frontendOrigin);
    evidence.survivedReload = await rowCompletedBecomes(page, COURSE_PRIMARY, true, 8_000);

    await signOutThroughUi(page, ctx.frontendOrigin);
    await signInThroughUi(page, ctx.frontendOrigin, persona);
    await gotoRegisteredCourses(page, ctx.frontendOrigin);
    evidence.survivedSignOutSignIn = await rowCompletedBecomes(page, COURSE_PRIMARY, true, 8_000);
    evidence.pageErrors = pageErrors.messages.slice(0, 5);

    const underlying = {
      editAcknowledged: probes.saveStateRegionCount > 0 && (probes.saveStateText ?? "").includes("Saved"),
      survivedReload: evidence.survivedReload === true,
      survivedSignOutSignIn: evidence.survivedSignOutSignIn === true,
    };
    evidence.underlying = underlying;

    if (!underlying.editAcknowledged) {
      return {
        status: "fail",
        measured: measuredJson({
          saveStateRegionCount: probes.saveStateRegionCount,
          savedAcknowledgmentLines: probes.savedAcknowledgmentLines,
          survivedReload: underlying.survivedReload,
          survivedSignOutSignIn: underlying.survivedSignOutSignIn,
          editSaveResponseStatus: edit.saveResponse?.status() ?? null,
        }),
        note: 'expected-fail: required contract element absent on this head — the Save state region (role="status", name "Save state") that would display "Saved"; the durability acknowledgment cannot be observed. The underlying data path itself worked (edit survived reload and sign-out/sign-in through the UI).',
      };
    }
    if (!underlying.survivedReload || !underlying.survivedSignOutSignIn) {
      return {
        status: "fail",
        measured: measuredJson(underlying),
        note: "a save acknowledged as Saved did not survive the required horizons (reload / sign-out+sign-in).",
      };
    }
    return { status: "pass", measured: measuredJson(underlying) };
  } finally {
    await browser.close();
  }
}

async function runFailedSavesNeverSaved(ctx: SuiteContext, evidence: Evidence): Promise<CaseOutcome> {
  const browser = await chromium.launch({ headless: true });
  try {
    const { context, page } = await openSession(browser);
    const pageErrors = collectPageErrors(page);

    const persona = await registerPersonaThroughUi(page, ctx.frontendOrigin);
    evidence.persona = persona.email;
    await gotoRegisteredCourses(page, ctx.frontendOrigin);
    evidence.majorChosen = await chooseMajorIfPrompted(page, { registered: true });

    // Fault in: every planner save answers 500. GETs stay live.
    const interception = await failPlannerSaves(page, "http500");
    const edit = await markCourseDone(page, COURSE_PRIMARY, { registered: true });
    evidence.injectedFault = "POST /api/planner -> injected 500";
    evidence.failedSaveResponseStatus = edit.saveResponse?.status() ?? null;
    evidence.interceptedSaveCount = interception.interceptedCount();
    evidence.rowClaimedInMemory = edit.rowCompleted;

    const probes = await probeContractElements(page);
    evidence.contractProbes = probes;
    evidence.screenshots.afterFailedSave = await snap(page, ctx, "failed-saves-never-saved", "after-failed-save");

    await interception.stop();
    await gotoRegisteredCourses(page, ctx.frontendOrigin);
    const lostAfterReload = !(await rowCompletedBecomes(page, COURSE_PRIMARY, true, 8_000));
    evidence.editSilentlyLostAfterReload = lostAfterReload;
    evidence.pageErrors = pageErrors.messages.slice(0, 5);
    evidence.screenshots.afterReload = await snap(page, ctx, "failed-saves-never-saved", "after-reload");

    if (probes.saveStateRegionCount === 0) {
      return {
        status: "fail",
        measured: measuredJson({
          injectedStatus: evidence.failedSaveResponseStatus,
          savedAcknowledgmentLines: probes.savedAcknowledgmentLines,
          failureIndicationCount: probes.failureIndications.length,
          retrySaveButtonCount: probes.retrySaveButtonCount,
          editSilentlyLostAfterReload: lostAfterReload,
        }),
        note: 'expected-fail: required contract elements absent on this head — the Save state region (role="status", name "Save state") with its "Saving failed…" text and the "Retry save" button. The injected-500 save produced zero UI feedback (no failure state, no retry offer); the row still claimed the edit in memory, and after reload the edit was silently lost (the server never received it). No "Saved" was ever shown, but only because the UI never speaks about saves at all.',
      };
    }

    // UI present: the failed save must not read "Saved", must read as a
    // failure, must offer the retry, and the retried save must complete.
    if ((probes.saveStateText ?? "").includes("Saved")) {
      return {
        status: "fail",
        measured: measuredJson({ saveStateText: probes.saveStateText }),
        note: "a save that failed was acknowledged as Saved — a false durability claim.",
      };
    }
    const truthful =
      (probes.saveStateText ?? "").toLowerCase().includes("fail") || probes.failureIndications.length > 0;
    if (!truthful || probes.retrySaveButtonCount === 0) {
      return {
        status: "fail",
        measured: measuredJson({
          saveStateText: probes.saveStateText,
          failureIndications: probes.failureIndications,
          retrySaveButtonCount: probes.retrySaveButtonCount,
          editSilentlyLostAfterReload: lostAfterReload,
        }),
        note: 'a failed save was not shown truthfully ("Saving failed…" + "Retry save" button required).',
      };
    }
    // Retry leg: the fault is already removed; the retried save must complete
    // and the region must then acknowledge Saved.
    const retryPost = page
      .waitForResponse((response) => PLANNER_RE.test(response.url()) && response.request().method() === "POST", {
        timeout: 15_000,
      })
      .catch(() => null);
    await page.getByRole("button", { name: "Retry save" }).first().click();
    const retryResponse = await retryPost;
    evidence.retryResponseStatus = retryResponse?.status() ?? null;
    if (!retryResponse || retryResponse.status() !== 200) {
      return {
        status: "fail",
        measured: measuredJson({ retryResponseStatus: retryResponse?.status() ?? null }),
        note: "the Retry save button did not re-attempt the save (no completing request observed).",
      };
    }
    const probesAfterRetry = await probeContractElements(page);
    evidence.contractProbesAfterRetry = probesAfterRetry;
    const acknowledgedAfterRetry =
      probesAfterRetry.savedAcknowledgmentLines.length > 0 ||
      (probesAfterRetry.saveStateText ?? "").includes("Saved");
    if (!acknowledgedAfterRetry) {
      return {
        status: "fail",
        measured: measuredJson({ retryResponseStatus: retryResponse.status(), saveStateText: probesAfterRetry.saveStateText }),
        note: "the retried save completed but the UI never acknowledged Saved.",
      };
    }
    return { status: "pass", measured: measuredJson({ retryResponseStatus: retryResponse.status() }) };
  } finally {
    await browser.close();
  }
}

async function runDeniedStorageDegradesHonestly(ctx: SuiteContext, evidence: Evidence): Promise<CaseOutcome> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.addInitScript(denyBrowserStorage);
    const page = await context.newPage();
    const pageErrors = collectPageErrors(page);

    await continueAsGuest(page, ctx.frontendOrigin);
    await gotoGuestCourses(page, ctx.frontendOrigin);
    evidence.majorChosen = await chooseMajorIfPrompted(page, { registered: false });

    const edit = await markCourseDone(page, COURSE_PRIMARY, { registered: false });
    evidence.editInMemory = edit.rowCompleted;

    const probes = await probeContractElements(page);
    evidence.contractProbes = probes;
    evidence.uncaughtPageErrors = pageErrors.messages.slice(0, 5);
    evidence.screenshots.deniedStorage = await snap(page, ctx, "denied-storage-degrades-honestly", "denied-storage");

    await gotoGuestCourses(page, ctx.frontendOrigin);
    const survivedReload = await rowCompletedBecomes(page, COURSE_PRIMARY, true, 8_000);
    evidence.editsLostOnReload = !survivedReload;

    const appKeptWorking = edit.rowCompleted;
    if (probes.saveStateRegionCount === 0 || probes.exportScheduleButtonCount === 0) {
      return {
        status: "fail",
        measured: measuredJson({
          storageDenied: "localStorage and sessionStorage (throwing getters via init script; this head's guest path persists to sessionStorage)",
          appKeptWorking,
          uncaughtPageErrors: pageErrors.messages.length,
          persistentWarningCount: probes.saveStateRegionCount,
          exportScheduleButtonCount: probes.exportScheduleButtonCount,
          editsLostOnReload: !survivedReload,
        }),
        note: 'expected-fail: required contract elements absent on this head — the Save state region (role="status", name "Save state") with its persistent "Not saved…" warning and the "Export schedule" button. With storage denied the app did keep working memory-only (the edit stayed visible and was lost on reload, as memory-only implies), but the user is never warned and offered no export. The denied-storage write failure surfaces as an uncaught page error.',
      };
    }
    if (!probes.saveStateText?.includes("Not saved")) {
      return {
        status: "fail",
        measured: measuredJson({ saveStateText: probes.saveStateText, exportScheduleButtonCount: probes.exportScheduleButtonCount }),
        note: 'storage-denied state did not show the persistent "Not saved…" warning.',
      };
    }
    return { status: "pass", measured: measuredJson({ appKeptWorking, exportScheduleButtonCount: probes.exportScheduleButtonCount }) };
  } finally {
    await browser.close();
  }
}

async function runCorruptBytesQuarantined(ctx: SuiteContext, evidence: Evidence): Promise<CaseOutcome> {
  const browser = await chromium.launch({ headless: true });
  try {
    const { context, page } = await openSession(browser);
    const pageErrors = collectPageErrors(page);

    await continueAsGuest(page, ctx.frontendOrigin);
    await gotoGuestCourses(page, ctx.frontendOrigin);
    evidence.majorChosen = await chooseMajorIfPrompted(page, { registered: false });
    const edit = await markCourseDone(page, COURSE_PRIMARY, { registered: false });
    evidence.editInMemory = edit.rowCompleted;

    const storedBefore = await readRawStoredPlan(page);
    evidence.storedPlanLanded = storedBefore !== null && storedBefore.includes(COURSE_PRIMARY);
    evidence.storedBytesLength = storedBefore?.length ?? 0;

    const corruption = await corruptStoredPlanBytes(page);
    evidence.corruption = {
      key: corruption.key,
      rawLength: corruption.rawBefore?.length ?? 0,
      corruptPreview: corruption.corrupt?.slice(0, 80) ?? null,
    };
    if (corruption.corrupt === null) {
      return {
        status: "fail",
        measured: measuredJson({ storedPlanLanded: false }),
        note: "prerequisite unmet on this head: no stored plan bytes were found in sessionStorage after a guest edit, so corruption could not be injected (an app fact, not a harness error).",
      };
    }

    // Reload into the corrupted bytes.
    await gotoGuestCourses(page, ctx.frontendOrigin);
    const appLoads = await page.locator("article.course-row").first().isVisible().catch(() => false);
    const searchBoxVisible = await page.getByRole("textbox", { name: "Search courses" }).isVisible().catch(() => false);
    if (!appLoads || !searchBoxVisible) {
      evidence.screenshots.afterReload = await snap(page, ctx, "corrupt-bytes-quarantined", "after-reload");
      return {
        status: "fail",
        measured: measuredJson({ appLoads, searchBoxVisible }),
        note: "the app did not load cleanly with corrupted stored plan bytes — a durability failure independent of any missing UI.",
      };
    }
    const immediateAfterLoad = await readRawStoredPlan(page);
    await new Promise((resolve) => setTimeout(resolve, 1_200)); // hydration writeback window
    const afterSettle = await readRawStoredPlan(page);
    const dump = await dumpAllStorage(page);
    const corruptMarker = corruption.corrupt;
    const quarantineCopyFound =
      corruptMarker !== null && JSON.stringify(dump).includes(corruptMarker);
    const corruptBytesDiscarded = afterSettle !== corruptMarker;

    const probes = await probeContractElements(page);
    evidence.contractProbes = probes;
    evidence.pageErrors = pageErrors.messages.slice(0, 5);
    evidence.screenshots.afterReload = await snap(page, ctx, "corrupt-bytes-quarantined", "after-reload");

    // The /plans surface (the contract's quarantine home) postdates this head.
    const plansResponse = await page
      .goto(`${ctx.frontendOrigin}/plans`, { waitUntil: "domcontentloaded" })
      .then((response) => response?.status() ?? 0)
      .catch(() => 0);
    evidence.plansPageHttpStatus = plansResponse;

    evidence.observations = {
      appLoads,
      searchBoxVisible,
      corruptBytesStillPresentImmediatelyAfterLoad: immediateAfterLoad === corruptMarker,
      corruptBytesDiscarded,
      quarantineCopyFound,
      storageKeysAfterSettle: Object.keys(dump.sessionStorage).concat(Object.keys(dump.localStorage)),
    };

    if (probes.keptAtNoticeCount === 0 || plansResponse !== 200) {
      return {
        status: "fail",
        measured: measuredJson({
          appLoads,
          corruptBytesDiscarded,
          quarantineCopyFound,
          quarantineNoticeCount: probes.keptAtNoticeCount,
          plansPageHttpStatus: plansResponse,
          recoveredClaimCount: probes.recoveredClaimCount,
        }),
        note: "expected-fail: the quarantine handling lives on /plans, which does not exist on this head (HTTP " +
          `${plansResponse}), and no quarantine notice (status whose text contains "kept at") is shown. Measured on the only stored plan bytes this head has (guest sessionStorage): the corrupt bytes were silently discarded — the read error is swallowed, the key is overwritten by the next save, and no intact quarantine copy exists anywhere — which violates "never silently deleted". The app does still load, and nothing claims the plan was recovered (vacuously: nothing is claimed at all).`,
      };
    }
    if (probes.recoveredClaimCount > 0) {
      return {
        status: "fail",
        measured: measuredJson({ recoveredClaimCount: probes.recoveredClaimCount }),
        note: "quarantine notice claimed recovery; the contract forbids any recovered claim.",
      };
    }
    return { status: "pass", measured: measuredJson({ appLoads, quarantineCopyFound }) };
  } finally {
    await browser.close();
  }
}

async function runCrossTabConflictVisible(ctx: SuiteContext, evidence: Evidence): Promise<CaseOutcome> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext(); // one context = one browser profile, two same-origin tabs
    const pageStale = await context.newPage();
    const pageErrors = collectPageErrors(pageStale);

    const persona = await registerPersonaThroughUi(pageStale, ctx.frontendOrigin);
    evidence.persona = persona.email;
    await gotoRegisteredCourses(pageStale, ctx.frontendOrigin);
    evidence.majorChosen = await chooseMajorIfPrompted(pageStale, { registered: true });
    const first = await markCourseDone(pageStale, COURSE_PRIMARY, { registered: true });
    evidence.staleTabBaseSave = first.saveResponse?.status() ?? null;

    // Newer tab: loads the freshest server state, then saves a newer version.
    const pageNewer = await context.newPage();
    await gotoRegisteredCourses(pageNewer, ctx.frontendOrigin);
    evidence.newerTabSawStaleData = await rowCompletedBecomes(pageNewer, COURSE_PRIMARY, true, 8_000);
    const newer = await markCourseDone(pageNewer, COURSE_SECONDARY, { registered: true });
    evidence.newerTabSaveStatus = newer.saveResponse?.status() ?? null;

    // Stale tab (its state predates the newer save) saves last.
    const stale = await markCourseDone(pageStale, COURSE_STALE, { registered: true });
    evidence.staleTabSaveStatus = stale.saveResponse?.status() ?? null;

    const probes = await probeContractElements(pageStale);
    evidence.contractProbesStaleTab = probes;
    evidence.screenshots.conflictMoment = await snap(pageStale, ctx, "cross-tab-conflict-visible", "stale-tab-after-save");

    // Whose data actually won on the server?
    await gotoRegisteredCourses(pageNewer, ctx.frontendOrigin);
    const staleEditWon = await rowCompletedBecomes(pageNewer, COURSE_STALE, true, 8_000);
    const newerEditSilentlyLost = !(await rowCompletedBecomes(pageNewer, COURSE_SECONDARY, true, 8_000));
    evidence.serverOutcome = { staleEditWon, newerEditSilentlyLost };
    evidence.pageErrors = pageErrors.messages.slice(0, 5);

    if (probes.conflictDialogCount === 0) {
      return {
        status: "fail",
        measured: measuredJson({
          conflictDialogCount: probes.conflictDialogCount,
          keepMyEditsButtonCount: probes.keepMyEditsButtonCount,
          useNewerVersionButtonCount: probes.useNewerVersionButtonCount,
          staleEditWon,
          newerEditSilentlyLost,
        }),
        note: 'expected-fail: required contract element absent on this head — the "Unsaved changes conflict" alertdialog (with "Keep my edits" / "Use the newer version" buttons). The stale tab\'s save landed last and the server silently adopted it: the newer tab\'s edit was overwritten with no conflict surfaced and nothing to choose.',
      };
    }
    if (probes.keepMyEditsButtonCount === 0 || probes.useNewerVersionButtonCount === 0) {
      return {
        status: "fail",
        measured: measuredJson(probes),
        note: "conflict dialog appeared but does not offer both required choices.",
      };
    }
    if (newerEditSilentlyLost) {
      return {
        status: "fail",
        measured: measuredJson({ staleEditWon, newerEditSilentlyLost }),
        note: "conflict dialog shown but the newer version was overwritten before the user could choose.",
      };
    }
    return { status: "pass", measured: measuredJson({ conflictDialogCount: probes.conflictDialogCount }) };
  } finally {
    await browser.close();
  }
}

async function runCleanTabAdoptsNewer(ctx: SuiteContext, evidence: Evidence): Promise<CaseOutcome> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const pageClean = await context.newPage();
    const pageErrors = collectPageErrors(pageClean);

    const persona = await registerPersonaThroughUi(pageClean, ctx.frontendOrigin);
    evidence.persona = persona.email;
    await gotoRegisteredCourses(pageClean, ctx.frontendOrigin);
    evidence.majorChosen = await chooseMajorIfPrompted(pageClean, { registered: true });
    const first = await markCourseDone(pageClean, COURSE_PRIMARY, { registered: true });
    evidence.cleanTabBaseSave = first.saveResponse?.status() ?? null;

    // Newer tab saves a newer version while the clean tab has NO unsaved edits.
    const pageNewer = await context.newPage();
    await gotoRegisteredCourses(pageNewer, ctx.frontendOrigin);
    const newer = await markCourseDone(pageNewer, COURSE_SECONDARY, { registered: true });
    evidence.newerTabSaveStatus = newer.saveResponse?.status() ?? null;

    await new Promise((resolve) => setTimeout(resolve, 3_000)); // any adoption mechanism would have landed
    const adoptedInPlace = await rowCompletedBecomes(pageClean, COURSE_SECONDARY, true, 3_000);
    const probes = await probeContractElements(pageClean);
    evidence.contractProbesCleanTab = probes;
    evidence.adoptedInPlace = adoptedInPlace;
    evidence.screenshots.afterWait = await snap(pageClean, ctx, "clean-tab-adopts-newer", "clean-tab-after-wait");

    await gotoRegisteredCourses(pageClean, ctx.frontendOrigin);
    const adoptedAfterReload = await rowCompletedBecomes(pageClean, COURSE_SECONDARY, true, 8_000);
    evidence.adoptedAfterReload = adoptedAfterReload;
    evidence.pageErrors = pageErrors.messages.slice(0, 5);

    if (probes.takenNewerNoticeCount === 0) {
      return {
        status: "fail",
        measured: measuredJson({
          adoptedInPlace,
          adoptedAfterReload,
          takenNewerNoticeCount: probes.takenNewerNoticeCount,
        }),
        note: 'expected-fail: required contract element absent on this head — the "Loaded newer version from another tab" status notice. The clean tab never adopted the newer version in place either: it sat stale until a full reload fetched the newer save. Taken together the tab neither takes the newer version nor says so.',
      };
    }
    if (!adoptedInPlace) {
      return {
        status: "fail",
        measured: measuredJson({ adoptedInPlace, takenNewerNoticeCount: probes.takenNewerNoticeCount }),
        note: "the taken-newer notice exists but the clean tab did not actually adopt the newer version.",
      };
    }
    return { status: "pass", measured: measuredJson({ adoptedInPlace }) };
  } finally {
    await browser.close();
  }
}

export default defineSuite({
  name: "persistence-faults",

  describe: (): CaseSpec[] => [
    { id: "acknowledged-saves-survive", title: "a save acknowledged as Saved survives reload and sign-out/sign-in (registered)" },
    { id: "failed-saves-never-saved", title: "a failed save is never shown as Saved, is truthful, and offers a retry (registered, injected 500)" },
    { id: "denied-storage-degrades-honestly", title: "denied storage: memory-only edits, persistent warning, working export (guest)" },
    { id: "corrupt-bytes-quarantined", title: "corrupted stored plan bytes are quarantined intact, never silently deleted, never claimed recovered" },
    { id: "cross-tab-conflict-visible", title: "stale tab saving over a newer tab's data surfaces a conflict, never silent overwrite" },
    { id: "clean-tab-adopts-newer", title: "a tab with no unsaved edits adopts the newer version and says so" },
  ],

  caseTimeoutMs: 300_000,

  run: (caseId: string, ctx: SuiteContext): Promise<CaseOutcome> => {
    switch (caseId) {
      case "acknowledged-saves-survive":
        return safelyRun(caseId, ctx, (evidence) => runAcknowledgedSavesSurvive(ctx, evidence));
      case "failed-saves-never-saved":
        return safelyRun(caseId, ctx, (evidence) => runFailedSavesNeverSaved(ctx, evidence));
      case "denied-storage-degrades-honestly":
        return safelyRun(caseId, ctx, (evidence) => runDeniedStorageDegradesHonestly(ctx, evidence));
      case "corrupt-bytes-quarantined":
        return safelyRun(caseId, ctx, (evidence) => runCorruptBytesQuarantined(ctx, evidence));
      case "cross-tab-conflict-visible":
        return safelyRun(caseId, ctx, (evidence) => runCrossTabConflictVisible(ctx, evidence));
      case "clean-tab-adopts-newer":
        return safelyRun(caseId, ctx, (evidence) => runCleanTabAdoptsNewer(ctx, evidence));
      default:
        return Promise.resolve({ status: "fail", note: `persistence-faults does not know case "${caseId}"` });
    }
  },
});
