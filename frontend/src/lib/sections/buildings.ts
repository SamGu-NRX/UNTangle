import { campusBuildings } from "../campus-locations";
import type { Location } from "./model";

type Building = (typeof campusBuildings)[number];

// Exact catalogue codes only (id, short name, mnemonic, one-word aliases); no fuzzy
// matching. Two buildings claiming one code would make lookups depend on list order.
const byCode = new Map<string, Building>();
for (const building of campusBuildings) {
  const names = [building.id, building.shortName, building.mnemonic, ...(building.aliases ?? [])];
  const codes = names
    .filter((name): name is string => name !== undefined && /^[a-z0-9]+$/i.test(name))
    .map(name => name.toUpperCase());
  for (const code of new Set(codes)) {
    const owner = byCode.get(code);
    if (owner) throw new Error(`Building code ${code} names both ${owner.id} and ${building.id}`);
    byCode.set(code, building);
  }
}

const unplaced = { buildingCode: null, buildingId: null, offCampus: false };

export function resolveRoom(room: string): Location {
  const trimmed = room.trim();
  if (/^UNT Internet Course$/i.test(trimmed)) {
    return { room, ...unplaced, buildingName: "Online", kind: "online" };
  }
  if (/^(?:|None|No Room|No Facility Assigned|TBA)$/i.test(trimmed)) {
    return { room, ...unplaced, buildingName: "Unassigned room", kind: "unassigned" };
  }
  const buildingCode = trimmed.split(/\s+/)[0].toUpperCase();
  const building = byCode.get(buildingCode);
  return {
    room,
    buildingCode,
    buildingId: building?.id ?? null,
    buildingName: building?.name ?? "Unknown building",
    kind: building ? "building" : "unknown",
    offCampus: building?.isOffCampus ?? false,
  };
}
