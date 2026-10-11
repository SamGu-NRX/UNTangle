import { describe, expect, test } from "bun:test";
import {
  COPY,
  initialSessionRecoveryState,
  sessionRecoveryReducer,
  shouldPauseAutosave,
} from "@/lib/session-recovery";
import type {
  SessionRecoveryAction,
  SessionRecoveryState,
} from "@/lib/session-recovery";

function run(
  actions: SessionRecoveryAction[],
  state: SessionRecoveryState = initialSessionRecoveryState,
): SessionRecoveryState {
  return actions.reduce(sessionRecoveryReducer, state);
}

describe("session recovery reducer", () => {
  test("a save 401 opens the dialog with edits-preserved copy", () => {
    const state = run([{ type: "saveUnauthorized" }]);
    expect(state.dialogOpen).toBe(true);
    expect(state.banner).toBe("");
    expect(state.message).toBe(COPY.saveMessage);
    expect(state.message).toContain("edits are safe");
  });

  test("a load 401 opens the dialog with refresh-failure copy", () => {
    const state = run([{ type: "loadUnauthorized" }]);
    expect(state.dialogOpen).toBe(true);
    expect(state.message).toBe(COPY.loadMessage);
    expect(state.message).toContain("couldn't refresh");
  });

  test("retryStart shows in-flight copy", () => {
    const state = run([
      { type: "saveUnauthorized" },
      { type: "retryStart" },
    ]);
    expect(state.retrying).toBe(true);
    expect(state.message).toBe(COPY.retryingMessage);
  });

  test("a retry 401 returns to the dialog with save copy", () => {
    const state = run([
      { type: "saveUnauthorized" },
      { type: "retryStart" },
      { type: "retryUnauthorized" },
    ]);
    expect(state.dialogOpen).toBe(true);
    expect(state.retrying).toBe(false);
    expect(state.message).toBe(COPY.saveMessage);
  });

  test("retrySucceeded clears dialog, banner, and message", () => {
    const state = run([
      { type: "saveUnauthorized" },
      { type: "retryStart" },
      { type: "retrySucceeded" },
    ]);
    expect(state.dialogOpen).toBe(false);
    expect(state.banner).toBe("");
    expect(state.message).toBe("");
    expect(state.retrying).toBe(false);
  });

  test("a network failure during retry keeps the dialog with offline copy", () => {
    const state = run([
      { type: "saveUnauthorized" },
      { type: "retryStart" },
      { type: "retryUnreachable" },
    ]);
    expect(state.dialogOpen).toBe(true);
    expect(state.retrying).toBe(false);
    expect(state.message).toBe(COPY.unreachableMessage);
  });

  test("dismiss closes the dialog and leaves a banner so the pause is not silent", () => {
    const state = run([{ type: "saveUnauthorized" }, { type: "dismiss" }]);
    expect(state.dialogOpen).toBe(false);
    expect(state.banner).toBe(COPY.banner);
  });

  test("a later retry success clears the dismissed banner", () => {
    const state = run([
      { type: "saveUnauthorized" },
      { type: "dismiss" },
      { type: "retryStart" },
      { type: "retrySucceeded" },
    ]);
    expect(state.banner).toBe("");
    expect(state.dialogOpen).toBe(false);
  });

  test("a fresh 401 after dismissal reopens the dialog without the banner", () => {
    const state = run([
      { type: "saveUnauthorized" },
      { type: "dismiss" },
      { type: "loadUnauthorized" },
    ]);
    expect(state.dialogOpen).toBe(true);
    expect(state.banner).toBe("");
    expect(state.message).toBe(COPY.loadMessage);
  });
});

describe("shouldPauseAutosave", () => {
  test("does not pause when recovery is idle", () => {
    expect(shouldPauseAutosave(initialSessionRecoveryState)).toBe(false);
  });

  test("pauses while the dialog is open", () => {
    expect(shouldPauseAutosave(run([{ type: "saveUnauthorized" }]))).toBe(true);
  });

  test("pauses after dismissal while the banner is up", () => {
    expect(shouldPauseAutosave(run([{ type: "dismiss" }]))).toBe(true);
  });
});
