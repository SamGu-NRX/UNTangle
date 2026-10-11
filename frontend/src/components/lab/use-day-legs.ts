"use client";

import { useEffect, useState } from "react";
import { fetchDayLegs } from "@/lib/lab/leg-routing";
import type { LabLeg } from "@/lib/lab/leg-routing";
import type { MapStop } from "@/lib/types";

type LegState = "loading" | "ready" | "error";

/** Fetches per-pair legs for one day's stops, with a manual recheck key. */
export function useDayLegs(stops: MapStop[]): { legs: LabLeg[]; state: LegState; recheck: () => void } {
  const [legs, setLegs] = useState<LabLeg[]>([]);
  const [state, setState] = useState<LegState>("loading");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (stops.length < 2) {
      setLegs([]);
      setState("ready");
      return;
    }
    let alive = true;
    setState("loading");
    fetchDayLegs(stops)
      .then((result) => {
        if (!alive) return;
        setLegs(result.legs);
        setState("ready");
      })
      .catch(() => {
        if (!alive) return;
        setLegs([]);
        setState("error");
      });
    return () => {
      alive = false;
    };
  }, [stops, reloadKey]);

  return { legs, state, recheck: () => setReloadKey((key) => key + 1) };
}
