/**
 * Pure state machine for planner session-expiry recovery.
 *
 * Pure module: no React, no fetch. The planner provider feeds it 401
 * outcomes and renders from the resulting state; offline tests pin the
 * copy and transitions.
 */

export type SessionRecoveryState = {
  /** Whether the session-expiry dialog is on screen. */
  dialogOpen: boolean;
  /** Banner copy shown after the dialog is dismissed ("" = no banner). */
  banner: string;
  /** Copy for the dialog body ("" when nothing is pending). */
  message: string;
  /** Whether a retry is in flight. */
  retrying: boolean;
};

export const initialSessionRecoveryState: SessionRecoveryState = {
  dialogOpen: false,
  banner: "",
  message: "",
  retrying: false,
};

export const COPY = {
  loadMessage:
    "Your session ended, so we couldn't refresh your plan. Your edits are still on this page.",
  saveMessage:
    "Your session ended before your plan could be saved. Your edits are safe — sign in and try again.",
  retryingMessage: "Saving your plan…",
  unreachableMessage:
    "We couldn't reach UNTangle just now. Check your connection and try again.",
  banner:
    "Session ended — your edits are saved on this device. Sign in again to sync your plan.",
  retry: "Try saving again",
  signIn: "Sign in",
  dismiss: "Keep editing",
} as const;

export type SessionRecoveryAction =
  | { type: "loadUnauthorized" }
  | { type: "saveUnauthorized" }
  | { type: "retryStart" }
  | { type: "retryUnauthorized" }
  | { type: "retrySucceeded" }
  | { type: "retryUnreachable" }
  | { type: "dismiss" };

export function sessionRecoveryReducer(
  state: SessionRecoveryState,
  action: SessionRecoveryAction,
): SessionRecoveryState {
  switch (action.type) {
    case "loadUnauthorized":
      return {
        ...state,
        dialogOpen: true,
        banner: "",
        message: COPY.loadMessage,
        retrying: false,
      };
    case "saveUnauthorized":
      return {
        ...state,
        dialogOpen: true,
        banner: "",
        message: COPY.saveMessage,
        retrying: false,
      };
    case "retryStart":
      return { ...state, retrying: true, message: COPY.retryingMessage };
    case "retryUnauthorized":
      return {
        ...state,
        dialogOpen: true,
        retrying: false,
        message: COPY.saveMessage,
      };
    case "retrySucceeded":
      return initialSessionRecoveryState;
    case "retryUnreachable":
      return {
        ...state,
        dialogOpen: true,
        retrying: false,
        message: COPY.unreachableMessage,
      };
    case "dismiss":
      return { ...initialSessionRecoveryState, banner: COPY.banner };
    default:
      return state;
  }
}

/** Autosave pauses while the dialog or banner is active: no 401 storm. */
export function shouldPauseAutosave(state: SessionRecoveryState): boolean {
  return state.dialogOpen || state.banner !== "";
}
