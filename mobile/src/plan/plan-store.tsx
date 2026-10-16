import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { firstFittingSection, sampleRecord, weekOf, type GuestRecord, type GuestWeek, type Picks } from "./guest-plan";
import { planStorage } from "./plan-storage";
import type { Preferences } from "./preferences";
import { loadPlan, savePlan, withPicks, type GuestPlan } from "./saved-plan";

/**
 * The guest's plan: the sample record, the picked sections and the week
 * preferences. It is saved on this device after every change and read back
 * at launch (saved-plan.ts), so a reload or a restart keeps the student's
 * week. With nothing saved yet, it is the sample student's plan, and every
 * lens says the data is a sample.
 */
type PlanStore = {
  record: GuestRecord;
  picks: Picks;
  planned: ReadonlySet<string>;
  week: GuestWeek;
  prefs: Preferences;
  /** Adds a course on the given section, or on its first section that fits. False when none fits. */
  add: (code: string, sectionId?: string) => boolean;
  remove: (code: string) => void;
  /** Replaces every pick at once: Auto's "Use this" and its Undo. */
  replace: (picks: Picks) => void;
  setPrefs: (update: (prefs: Preferences) => Preferences) => void;
};

const PlanContext = createContext<PlanStore | null>(null);

function readSavedPlan(): GuestPlan {
  const { plan, problem } = loadPlan(planStorage);
  if (problem) console.warn(`[plan] ${problem}`);
  return plan;
}

export function PlanProvider({ children }: { children: ReactNode }) {
  const [plan, setPlan] = useState<GuestPlan>(readSavedPlan);
  // The plan as launch read it, which is never written back: with nothing
  // saved, the sample stays unsaved until the student changes something.
  const launched = useRef(plan);

  // The latest plan, updated in the same call that sets it, so two actions
  // before a re-render (an add, then an undo) each see the other's result and
  // a fit check never runs against a stale set.
  const planRef = useRef<GuestPlan>(plan);
  const commit = useCallback((next: GuestPlan) => {
    planRef.current = next;
    setPlan(next);
  }, []);

  useEffect(() => {
    if (plan === launched.current) return;
    try {
      savePlan(planStorage, plan);
    } catch (error) {
      console.warn(`[plan] Saving the plan on this device failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [plan]);

  const add = useCallback(
    (code: string, sectionId?: string) => {
      const current = planRef.current;
      const id = sectionId ?? firstFittingSection(code, current.picks)?.id;
      if (!id) return false;
      commit(withPicks(current, { ...current.picks, [code]: id }));
      return true;
    },
    [commit],
  );
  const remove = useCallback(
    (code: string) => {
      const next = { ...planRef.current.picks };
      delete next[code];
      commit(withPicks(planRef.current, next));
    },
    [commit],
  );
  const replace = useCallback((next: Picks) => commit(withPicks(planRef.current, { ...next })), [commit]);
  const setPrefs = useCallback(
    (update: (prefs: Preferences) => Preferences) => commit({ ...planRef.current, prefs: update(planRef.current.prefs) }),
    [commit],
  );

  const value = useMemo<PlanStore>(
    () => ({
      record: sampleRecord,
      picks: plan.picks,
      planned: new Set(Object.keys(plan.picks)),
      week: weekOf(plan.picks, plan.colors),
      prefs: plan.prefs,
      add,
      remove,
      replace,
      setPrefs,
    }),
    [plan, add, remove, replace, setPrefs],
  );
  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlan(): PlanStore {
  const store = useContext(PlanContext);
  if (!store) throw new Error("usePlan needs a PlanProvider above it (app/_layout.tsx).");
  return store;
}
