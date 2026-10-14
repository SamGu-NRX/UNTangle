import { useCallback, useRef } from "react";
import { useFocusEffect } from "expo-router";

/**
 * Reload the schedule when the screen regains focus: the student may have
 * signed in or changed the plan on the web since the last visit. The first
 * focus fires on mount, when the initial load already runs, so it is skipped.
 */
export function useScheduleReloadOnFocus(reload: () => void): void {
  const skipFirst = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (skipFirst.current) {
        skipFirst.current = false;
        return;
      }
      reload();
    }, [reload]),
  );
}
