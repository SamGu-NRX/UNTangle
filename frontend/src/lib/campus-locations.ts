import type { CampusBuilding } from "@/lib/types";

export const untCampusCenter = { lat: 33.210042, lng: -97.145061 };

export const untCampusBounds = {
  north: 33.216,
  south: 33.204,
  east: -97.139,
  west: -97.154,
};

export const campusBuildings: CampusBuilding[] = [
  {
    id: "gab",
    name: "General Academic Building",
    shortName: "GAB",
    lat: 33.210783,
    lng: -97.146668,
    aliases: ["gab", "general academic building", "gen academic building"],
  },
  {
    id: "wh",
    name: "Wooten Hall",
    shortName: "WH",
    lat: 33.208907,
    lng: -97.146777,
    aliases: ["wh", "wooten", "wooten hall"],
  },
  {
    id: "sage",
    name: "Sage Hall",
    shortName: "SAGE",
    lat: 33.212188,
    lng: -97.149834,
    aliases: ["sage", "sage hall"],
  },
  {
    id: "sci",
    name: "Science Research Building",
    shortName: "SCI",
    lat: 33.208298,
    lng: -97.149315,
    aliases: ["sci", "science research", "science research building"],
  },
  {
    id: "union",
    name: "UNT Union",
    shortName: "UNION",
    lat: 33.210042,
    lng: -97.145061,
    aliases: ["union", "unt union", "university union"],
  },
  {
    id: "willis",
    name: "Willis Library",
    shortName: "WILLIS",
    lat: 33.209414,
    lng: -97.143878,
    aliases: ["willis", "willis library"],
  },
  {
    id: "music",
    name: "Music Annex",
    shortName: "MUSX",
    lat: 33.208353,
    lng: -97.14356,
    aliases: ["musx", "music annex"],
  },
];

const aliasMap = new Map(
  campusBuildings.flatMap((building) =>
    [building.id, building.shortName, building.name, ...(building.aliases ?? [])].map((alias) => [
      normalizeLocationLabel(alias),
      building,
    ] as const),
  ),
);

export function normalizeLocationLabel(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(university of north texas|unt|denton|tx|texas)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function buildCampusGeocodeQuery(location: string) {
  const normalized = location.trim();
  const lower = normalized.toLowerCase();
  return lower.includes("unt") || lower.includes("university of north texas")
    ? normalized
    : `${normalized} University of North Texas Denton TX`;
}

export function resolveCampusLocation(location: string, buildingId?: string | null) {
  const idMatch = buildingId ? aliasMap.get(normalizeLocationLabel(buildingId)) : undefined;
  if (idMatch) {
    return idMatch;
  }

  return aliasMap.get(normalizeLocationLabel(location)) ?? null;
}
