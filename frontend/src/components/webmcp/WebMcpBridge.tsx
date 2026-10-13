"use client";

import { useEffect, useRef, useState } from "react";
import { usePlanner } from "@/components/planner-provider";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { toast } from "@/components/ui/Toast";
import { createOptimizerWorker, OptimizerClient } from "@/lib/optimizer/worker/client";
import { toPlainRequest } from "@/lib/optimizer/worker/protocol";
import type { OptimizeRequest, OptimizeResult } from "@/lib/optimizer/types";
import { findModelContext, registerTools } from "@/lib/webmcp/register";
import { createTools, type PlannerPort } from "@/lib/webmcp/tools";

type Planner = ReturnType<typeof usePlanner>;

/** Each call gets its own worker, so a second build never orphans the first one's answer. */
function optimizeInWorker(request: OptimizeRequest): Promise<OptimizeResult> {
  return new Promise((resolve, reject) => {
    const client = new OptimizerClient(createOptimizerWorker, (reply) => {
      if (reply.phase === "error") reject(new Error(reply.message));
      else if (reply.settled) resolve(reply.result);
      else return;
      client.dispose();
    });
    client.run(toPlainRequest(request));
  });
}

function livePort(get: () => Planner): PlannerPort {
  return {
    plan: () => get().plannerState,
    preferences: () => get().schedulePreferences,
    epoch: () => get().planEpoch,
    optimize: optimizeInWorker,
    applySchedule: (byCourse, goal) => get().applySchedule(byCourse, goal),
    restoreSchedule: (snapshot) => get().restoreSchedule(snapshot),
    setSection: (courseCode, sectionId) => get().setSection(courseCode, sectionId),
    updateCoursePlan: (update) => get().updateCoursePlan(update),
    setSchedulePreferences: (update) => get().setSchedulePreferences(update),
  };
}

/**
 * Registers the tools once the plan and this student's preferences have
 * loaded, and asks the student before any write. Tools read the planner
 * through a ref, so they see every edit without re-registering: each
 * re-registration would fire `toolchange` at the agent and open a window in
 * which a call finds no tool.
 */
export function WebMcpBridge() {
  const planner = usePlanner();
  const live = useRef(planner);
  useEffect(() => {
    live.current = planner;
  });
  const [question, setQuestion] = useState<{ text: string; action: string } | null>(null);
  const [open, setOpen] = useState(false);
  const answer = useRef<((granted: boolean) => void) | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const ready = planner.preferencesReady;

  useEffect(() => {
    const modelContext = ready ? findModelContext() : null;
    if (!modelContext) return;
    const unregister = registerTools(modelContext, createTools(), {
      port: livePort(() => live.current),
      ask: (text, action, signal) =>
        new Promise<boolean>((resolve) => {
          const finish = (granted: boolean) => {
            if (answer.current !== finish) return;
            answer.current = null;
            setOpen(false);
            resolve(granted);
          };
          answer.current = finish;
          // The agent cancelled the call: the question no longer stands.
          signal?.addEventListener("abort", () => finish(false), { once: true });
          if (signal?.aborted) return finish(false);
          setQuestion({ text, action });
          setOpen(true);
        }),
      applied: (message, undo) =>
        toast({
          message,
          action: {
            label: "Undo",
            // A refused Undo stays until dismissed; the confirmation gets five seconds to be read.
            onClick: () =>
              toast(
                undo()
                  ? { message: "Restored your previous plan", duration: 5000 }
                  : { message: "Undo is off: your plan changed since then", tone: "error" },
              ),
          },
        }),
    });
    return () => {
      answer.current?.(false);
      unregister();
    };
  }, [ready]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? null : answer.current?.(false))}
      role="alertdialog"
      title="Your assistant wants to change your plan"
      description={question?.text}
      initialFocus={cancelRef}
      footer={
        <>
          <Button variant="ghost" ref={cancelRef} onClick={() => answer.current?.(false)}>
            Cancel
          </Button>
          <Button onClick={() => answer.current?.(true)}>{question?.action}</Button>
        </>
      }
    >
      {/* The body also spaces the question from the buttons: the dialog's footer has no top padding. */}
      <p style={{ margin: 0, color: "var(--ink-2)" }}>You can undo it afterwards.</p>
    </Dialog>
  );
}
