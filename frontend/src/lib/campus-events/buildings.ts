/**
 * Maps an event's location text to a campus catalogue building, exactly.
 *
 * The rule is deliberately narrow: the whole location string, or the part
 * before its first comma, must equal one of the catalogue's names, short
 * names, mnemonics, or aliases, case-insensitively with whitespace
 * collapsed. "Pohl Recreation Center, Soccer Gym" matches Pohl Recreation
 * Center because the leading segment is an exact alias; a location like
 * "Business Leadership Building 070" does not match, because appending a
 * room to a name is a guess, and a wrong building id is worse than raw
 * text the Day view can show as-is.
 */

import { campusBuildings } from "@/lib/campus-locations";

/** Lowercase, trim, and collapse internal whitespace so only text differs. */
function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

type BuildingName = { id: string; normalized: string };

const byName = new Map<string, string>();
for (const building of campusBuildings) {
  const names = [building.name, building.shortName, building.mnemonic, ...(building.aliases ?? [])];
  for (const name of names) {
    if (name === undefined) continue;
    const normalized = normalizeName(name);
    const owner = byName.get(normalized);
    if (owner !== undefined && owner !== building.id) {
      throw new Error(`Building name ${normalized} names both ${owner} and ${building.id}`);
    }
    byName.set(normalized, building.id);
  }
}

/** Catalogue names as an array, longest first, so callers can surface what would match. */
const knownNames: BuildingName[] = [...byName.keys()]
  .map(normalized => ({ normalized, id: byName.get(normalized) as string }))
  .sort((a, b) => b.normalized.length - a.normalized.length);

/** True when the text (whole, or before its first comma) names a catalogue building. */
export function resolveEventBuilding(location: string): string | null {
  const candidates = [normalizeName(location)];
  const commaIndex = location.indexOf(",");
  if (commaIndex > 0) candidates.push(normalizeName(location.slice(0, commaIndex)));
  for (const candidate of candidates) {
    if (candidate === "") continue;
    const id = byName.get(candidate);
    if (id !== undefined) return id;
  }
  return null;
}

/** Every normalized catalogue name that is a prefix-boundary match for testing and diagnostics. */
export function knownBuildingNames(): readonly BuildingName[] {
  return knownNames;
}
