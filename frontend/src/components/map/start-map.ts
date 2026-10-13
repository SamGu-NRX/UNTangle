/**
 * Start the map, or say why it couldn't start. MapLibre's constructor throws
 * when the browser has no WebGL (disabled, blocklisted GPU, some VMs); the
 * page must keep its itinerary instead of failing as a whole.
 */
export type MapStart<T> = { ok: true; map: T } | { ok: false; reason: string };

export function startMap<T>(create: () => T): MapStart<T> {
  try {
    return { ok: true, map: create() };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
