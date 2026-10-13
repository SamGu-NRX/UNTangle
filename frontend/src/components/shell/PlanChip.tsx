"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { usePlanner } from "@/components/planner-provider";
import { ChevronDown } from "@/components/ui/icons";
import { Menu, type MenuEntry } from "@/components/ui/Menu";
import { toast } from "@/components/ui/Toast";
import { createSavedPlanStore } from "@/lib/saved-plans/store";
import type { SavedPlanSnapshot } from "@/lib/plan-library/snapshot-types";
import { chipStatusLabel, chipTone, planName } from "./plan-status";

const RECENT_LIMIT = 3;

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * The plan menu's entries. "Save a copy" is disabled until the plan has
 * loaded, and its handler refuses on its own too, so no path can copy the
 * seed defaults that stand in for the plan before then.
 */
export function planMenuEntries(input: {
  planLoaded: boolean;
  saveFailed: boolean;
  isRegistered: boolean;
  recent: Array<Pick<SavedPlanSnapshot, "planId" | "name" | "snapshotTakenAt">>;
  onCopy: () => void;
  onRetry: () => void;
}): MenuEntry[] {
  const { planLoaded, saveFailed, isRegistered, recent, onCopy, onRetry } = input;
  return [
    ...(saveFailed ? [{ id: "retry", label: "Try saving again", onSelect: onRetry } satisfies MenuEntry] : []),
    {
      id: "copy",
      label: "Save a copy",
      disabled: !planLoaded,
      onSelect: () => {
        if (planLoaded) onCopy();
      },
    },
    ...(recent.length
      ? ([
          { kind: "label", id: "recent-label", label: "Saved plans" },
          ...recent.map(
            (plan): MenuEntry => ({
              id: `plan-${plan.planId}`,
              label: plan.name,
              meta: shortDate(plan.snapshotTakenAt),
              href: "/plans",
            }),
          ),
        ] satisfies MenuEntry[])
      : []),
    { kind: "separator", id: "sep-library" },
    { id: "library", label: "Open library", meta: "›", href: "/plans" },
    ...(!isRegistered
      ? ([{ id: "sign-in", label: "Sign in to keep it on every device", href: "/auth" }] satisfies MenuEntry[])
      : []),
  ];
}

/**
 * The plan in the top bar: name, a save-state dot and caret. It replaces
 * the full-width "Saving… / Saved" bar (DESIGN.md §8). Its menu holds the
 * save detail, a retry when saving failed, "Save a copy", recent saved
 * plans and the way into the library.
 */
export function PlanChip() {
  const { saveState, isRegistered, isAuthPending, hydrated, retrySave, plannerState } = usePlanner();
  // Until the stored plan (and, for a signed-in student, the server copy) has
  // loaded, plannerState holds the seed defaults; a copy then would save
  // those instead of the student's plan.
  const planLoaded = hydrated && !isAuthPending;
  const router = useRouter();
  const [recent, setRecent] = useState<SavedPlanSnapshot[]>([]);

  const name = planName(isRegistered);
  const tone = hydrated ? chipTone(saveState.status) : "saving";
  const status = hydrated ? chipStatusLabel(saveState.status, saveState.label) : "";

  const loadRecent = () => {
    const read = createSavedPlanStore().list();
    if (!read.ok) {
      setRecent([]);
      return;
    }
    setRecent(
      read.doc.plans
        .filter((plan) => !plan.archivedAt)
        .sort((a, b) => b.snapshotTakenAt.localeCompare(a.snapshotTakenAt))
        .slice(0, RECENT_LIMIT),
    );
  };

  const saveCopy = () => {
    if (!planLoaded) return;
    const result = createSavedPlanStore().savePlan({ state: plannerState });
    if (result.ok) {
      toast({
        message: `Saved “${result.value.name}” to your library.`,
        action: { label: "Open", onClick: () => router.push("/plans") },
      });
    } else {
      toast({ message: result.failure.message, tone: "error" });
    }
  };

  const detail =
    saveState.detail ??
    (saveState.status === "saved"
      ? isRegistered
        ? "Saved to your account."
        : "Saved in this browser only."
      : null);

  const items = planMenuEntries({
    planLoaded,
    saveFailed: saveState.status === "failed",
    isRegistered,
    recent,
    onCopy: saveCopy,
    onRetry: retrySave,
  });

  return (
    <Menu
      label={name}
      align="end"
      header={detail ? <span>{detail}</span> : undefined}
      items={items}
      trigger={(props) => (
        <button
          {...props}
          type="button"
          className="shell-planchip"
          data-tone={tone}
          onClick={() => {
            if (!props["aria-expanded"]) loadRecent();
            props.onClick();
          }}
          onKeyDown={(event) => {
            if (!props["aria-expanded"] && ["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) loadRecent();
            props.onKeyDown(event);
          }}
        >
          <span className="shell-planchip__dot" aria-hidden="true" />
          <span className="shell-planchip__name">{name}</span>
          {status ? (
            <span className="shell-planchip__status">
              <span className="sr-only-v2">, </span>
              {status}
            </span>
          ) : null}
          <ChevronDown size={14} className="shell-planchip__caret" />
        </button>
      )}
    />
  );
}
