"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePlanner } from "@/components/planner-provider";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { dismissToast, toast } from "@/components/ui/Toast";
import { createOptimizerWorker, OptimizerClient } from "@/lib/optimizer/worker/client";
import { toPlainRequest } from "@/lib/optimizer/worker/protocol";
import type { OptimizeRequest, OptimizeResult } from "@/lib/optimizer/types";
import { findModelContext, registerTools } from "@/lib/webmcp/register";
import { createTools, type PlannerPort } from "@/lib/webmcp/tools";

type Planner = ReturnType<typeof usePlanner>;

/** Each search gets its own worker, terminated when the search ends or `signal` aborts. */
function optimizeInWorker(request: OptimizeRequest, signal: AbortSignal): Promise<OptimizeResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const client = new OptimizerClient(createOptimizerWorker, (reply) => {
      if (reply.phase === "error") finish(() => reject(new Error(reply.message)));
      else if (reply.settled) finish(() => resolve(reply.result));
    });
    const finish = (settle: () => void) => {
      client.dispose();
      signal.removeEventListener("abort", onAbort);
      settle();
    };
    const onAbort = () => finish(() => reject(signal.reason));
    signal.addEventListener("abort", onAbort);
    client.run(toPlainRequest(request));
  });
}

function livePort(get: () => Planner, afterRender: (resolve: () => void) => void): PlannerPort {
  return {
    plan: () => get().plannerState,
    preferences: () => get().schedulePreferences,
    epoch: () => get().planEpoch,
    // A write that changes nothing renders nothing; the timeout keeps the call from waiting on it forever.
    committed: () =>
      new Promise((resolve) => {
        afterRender(resolve);
        window.setTimeout(resolve, 1000);
      }),
    optimize: optimizeInWorker,
    applySchedule: (byCourse, goal) => get().applySchedule(byCourse, goal),
    restoreSchedule: (snapshot) => get().restoreSchedule(snapshot),
    setSection: (courseCode, sectionId) => get().setSection(courseCode, sectionId),
    updateCoursePlan: (update) => get().updateCoursePlan(update),
    setSchedulePreferences: (update) => get().setSchedulePreferences(update),
  };
}

/**
 * The planner as of the last render, and calls waiting for the next one.
 * Tools read it through the port, so they see every edit without
 * re-registering: each re-registration would fire `toolchange` at the agent
 * and open a moment in which a call finds no tool.
 */
function plannerSource(initial: Planner) {
  let planner = initial;
  const waiting: Array<() => void> = [];
  return {
    port: livePort(() => planner, (resolve) => waiting.push(resolve)),
    rendered(next: Planner) {
      planner = next;
      waiting.splice(0).forEach((resolve) => resolve());
    },
  };
}

export function WebMcpBridge() {
  const planner = usePlanner();
  const [source] = useState(() => plannerSource(planner));
  useEffect(() => source.rendered(planner));
  return <WebMcpSession ready={planner.preferencesReady} port={source.port} />;
}

type Question = { id: number; text: string; action: string };

/**
 * Registers the tools while `ready` and asks the student before any write.
 * `ready` is the planner's preferencesReady, which turns false the moment
 * the signed-in identity changes, so one registration never spans two
 * students. Ending a registration answers its open question with no,
 * dismisses its Undo toasts, and makes any Undo it handed out do nothing.
 */
export function WebMcpSession({ ready, port }: { ready: boolean; port: PlannerPort }) {
  const [shown, setShown] = useState<Question | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const pending = useRef<{ id: number; resolve: (granted: boolean) => void } | null>(null);
  const asked = useRef(0);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  /** Answers question `id` only, so controls left from an earlier question cannot answer a later one. */
  const answer = useCallback((id: number, granted: boolean) => {
    const current = pending.current;
    if (current?.id !== id) return;
    pending.current = null;
    setOpenId(null);
    current.resolve(granted);
  }, []);

  useEffect(() => {
    const modelContext = ready ? findModelContext() : null;
    if (!modelContext) return;
    let active = true;
    const toasts: number[] = [];
    const unregister = registerTools(modelContext, createTools(), {
      port,
      ask: (text, action, signal) =>
        new Promise<boolean>((resolve, reject) => {
          // registerTools lets one write wait at a time; a second question here is a bug, not a queue.
          if (pending.current) return reject(new Error("WebMCP asked a second question while one was open"));
          if (signal.aborted) return resolve(false);
          const id = ++asked.current;
          pending.current = { id, resolve };
          signal.addEventListener("abort", () => answer(id, false), { once: true });
          setShown({ id, text, action });
          setOpenId(id);
        }),
      applied: (message, undo) => {
        const onClick = () => {
          if (!active) return;
          toast(
            undo()
              ? { message: "Restored your previous plan", duration: 5000 }
              : // A refused Undo stays until dismissed.
                { message: "Undo is off: your plan changed since then", tone: "error" },
          );
        };
        toasts.push(toast({ message, action: { label: "Undo", onClick } }));
      },
    });
    return () => {
      active = false;
      toasts.forEach((id) => dismissToast(id));
      if (pending.current) answer(pending.current.id, false);
      unregister();
    };
  }, [answer, port, ready]);

  if (!shown) return null;
  const open = openId === shown.id;
  return (
    <Dialog
      // A fresh dialog per question, so focus starts on its Cancel.
      key={shown.id}
      open={open}
      onOpenChange={(next) => (next ? null : answer(shown.id, false))}
      role="alertdialog"
      title="Your assistant wants to change your plan"
      description={shown.text}
      initialFocus={cancelRef}
      footer={
        <>
          <Button variant="ghost" ref={cancelRef} disabled={!open} onClick={() => answer(shown.id, false)}>
            Cancel
          </Button>
          <Button disabled={!open} onClick={() => answer(shown.id, true)}>
            {shown.action}
          </Button>
        </>
      }
    >
      {/* The body also spaces the question from the buttons: the dialog's footer has no top padding. */}
      <p style={{ margin: 0, color: "var(--ink-2)" }}>You can undo it afterwards.</p>
    </Dialog>
  );
}
