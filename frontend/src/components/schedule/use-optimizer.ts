"use client";

import { useCallback, useEffect, useReducer, useRef, useSyncExternalStore } from "react";
import { createOptimizerWorker, OptimizerClient } from "@/lib/optimizer/worker/client";
import type { PlainRequest } from "@/lib/optimizer/worker/protocol";
import { IDLE, runReducer } from "./run-state";

/** Optimizer runs in a worker; `state` follows the newest one only. */
export function useOptimizerRuns() {
  const [state, dispatch] = useReducer(runReducer, IDLE);
  const client = useRef<OptimizerClient | null>(null);

  useEffect(() => () => client.current?.dispose(), []);

  const run = useCallback((request: PlainRequest, inputKey: string) => {
    client.current ??= new OptimizerClient(createOptimizerWorker, (reply) => dispatch({ type: "reply", reply }));
    const id = client.current.run(request);
    dispatch({ type: "start", id, inputKey });
  }, []);

  // Closing the results also stops a search still refining them; nobody will see its answer.
  const close = useCallback(() => {
    client.current?.cancel();
    dispatch({ type: "close" });
  }, []);

  return { state, run, close };
}

/** Matches a media query; false on the server and during hydration. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
