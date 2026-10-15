"use client";

import { useSyncExternalStore } from "react";
import type { StartPlace } from "@/lib/map-itinerary";

/**
 * Where the student starts their day, kept in this browser (not in the
 * saved plan, which travels between devices and schedules; where you sleep
 * doesn't change with the schedule).
 */
const STORAGE_KEY = "untangle.day-start.v1";

const listeners = new Set<() => void>();
let cached: { raw: string | null; value: StartPlace | null } = { raw: null, value: null };
/** Set when storage refused a write: the choice holds for this page's life instead. */
let unsaved: { value: StartPlace | null } | null = null;

function parse(raw: string | null): StartPlace | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Partial<StartPlace> | null;
    const point = value?.point;
    if (typeof value?.name === "string" && value.name && Number.isFinite(point?.lat) && Number.isFinite(point?.lng)) {
      return { name: value.name, point: { lat: point!.lat, lng: point!.lng } };
    }
  } catch {
    // Falls through: an unreadable entry is no starting point.
  }
  return null;
}

function read(): StartPlace | null {
  if (unsaved) return unsaved.value;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage blocked (private mode, policy): no saved starting point.
    return null;
  }
  if (raw !== cached.raw) cached = { raw, value: parse(raw) };
  return cached.value;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function setStartingPoint(place: StartPlace | null) {
  try {
    if (place) window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: place.name, point: place.point }));
    else window.localStorage.removeItem(STORAGE_KEY);
    unsaved = null;
  } catch {
    // Storage blocked or full: the choice lasts until the page reloads.
    unsaved = { value: place };
  }
  listeners.forEach((listener) => listener());
}

/** The saved starting point; null before hydration and when none is set. */
export function useStartingPoint(): StartPlace | null {
  return useSyncExternalStore(subscribe, read, () => null);
}
