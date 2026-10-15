import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { firstFittingSection, samplePicks, sampleRecord, weekOf, type GuestRecord, type GuestWeek, type Picks } from "./guest-plan";
import { samplePreferences, type Preferences } from "./preferences";

/**
 * The guest's plan for this session: the sample record, the picked sections
 * and the week preferences. Nothing is saved; closing the app starts over,
 * and every lens says the data is a sample.
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

export function PlanProvider({ children }: { children: ReactNode }) {
  const [picks, setPicks] = useState<Picks>(samplePicks);
  const [prefs, setPrefsState] = useState<Preferences>(samplePreferences);

  const add = useCallback(
    (code: string, sectionId?: string) => {
      const id = sectionId ?? firstFittingSection(code, picks)?.id;
      if (!id) return false;
      setPicks((current) => ({ ...current, [code]: id }));
      return true;
    },
    [picks],
  );
  const remove = useCallback((code: string) => {
    setPicks((current) => {
      const next = { ...current };
      delete next[code];
      return next;
    });
  }, []);
  const replace = useCallback((next: Picks) => setPicks({ ...next }), []);
  const setPrefs = useCallback((update: (prefs: Preferences) => Preferences) => setPrefsState(update), []);

  const value = useMemo<PlanStore>(
    () => ({
      record: sampleRecord,
      picks,
      planned: new Set(Object.keys(picks)),
      week: weekOf(picks),
      prefs,
      add,
      remove,
      replace,
      setPrefs,
    }),
    [picks, prefs, add, remove, replace, setPrefs],
  );
  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlan(): PlanStore {
  const store = useContext(PlanContext);
  if (!store) throw new Error("usePlan needs a PlanProvider above it (app/_layout.tsx).");
  return store;
}
