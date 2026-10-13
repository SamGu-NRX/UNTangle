import { campusBuildings } from "../campus-locations";
import type { Location } from "./model";

// campus/config.ts uses this same UNT catalogue. Only exact registered aliases
// are accepted, including WH, AUDB, HKRY, ARTF and NTDP. No fuzzy name matching.
const byCode = new Map(campusBuildings.flatMap(building =>
  [building.id, building.shortName, building.mnemonic, ...building.aliases ?? []]
    .filter((code): code is string => typeof code === "string" && /^[a-z0-9]+$/i.test(code))
    .map(code => [code.toUpperCase(), building] as const),
));

export function resolveRoom(room: string): Location {
  const trimmed = room.trim();
  if (/^UNT Internet Course$/i.test(trimmed)) {
    return { room, buildingCode: null, buildingId: null, buildingName: "Online", kind: "online", offCampus: false };
  }
  if (/^(?:|None|No Room|No Facility Assigned|TBA)$/i.test(trimmed)) {
    return { room, buildingCode: null, buildingId: null, buildingName: "Unassigned room", kind: "unassigned", offCampus: false };
  }
  const buildingCode = trimmed.split(/\s+/)[0].toUpperCase();
  // The catalogue names MGV Building P as mgvp; room P124 identifies that
  // building. Other MGV room letters have no verified mapping here.
  const lookupCode = /^MGV\s+P\d/i.test(trimmed) ? "MGVP" : buildingCode;
  const building = byCode.get(lookupCode);
  return {
    room, buildingCode, buildingId: building?.id ?? null,
    buildingName: building?.name ?? "Unknown building",
    kind: building ? "building" : "unknown", offCampus: building?.isOffCampus ?? false,
  };
}
