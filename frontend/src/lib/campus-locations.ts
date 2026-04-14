import type { CampusBuilding } from "@/lib/types";

export const untCampusCenter = { lat: 33.21165, lng: -97.1482 };

export const untCampusBounds = {
  north: 33.216,
  south: 33.204,
  east: -97.139,
  west: -97.156,
};

const dentonSuffix = "Denton, TX";

function address(value: string) {
  return `${value}, ${dentonSuffix}`;
}

// Names, mnemonics, building numbers, and addresses come from UNT Facilities.
// Coordinates are checked against UNT Names where available and OSM building
// footprints for the map pin center, so generated course seed coordinates never
// become the source of truth for campus pins.
export const campusBuildings: CampusBuilding[] = [
  {
    id: "art",
    name: "Art Building",
    shortName: "ART",
    mnemonic: "ART",
    buildingNumber: "153",
    address: address("1201 W. Mulberry St."),
    lat: 33.2131162,
    lng: -97.1452492,
    aliases: ["art", "art bldg", "art building"],
  },
  {
    id: "arta",
    name: "Art Annex",
    shortName: "ARTA",
    mnemonic: "ARTF",
    buildingNumber: "157",
    address: address("1001 W. Mulberry St."),
    lat: 33.21303,
    lng: -97.1445,
    aliases: ["arta", "artf", "art annex", "unt art annex"],
  },
  {
    id: "aud",
    name: "Auditorium Building",
    shortName: "AUD",
    mnemonic: "AUDB",
    buildingNumber: "102",
    address: address("1401 W. Hickory St."),
    lat: 33.2139537,
    lng: -97.1472998,
    aliases: ["aud", "audb", "auditorium", "auditorium building", "auditorium english building"],
  },
  {
    id: "blb",
    name: "Business Leadership Building",
    shortName: "BLB",
    mnemonic: "BLB",
    buildingNumber: "156",
    address: address("1307 W. Highland St."),
    lat: 33.2088704,
    lng: -97.1476988,
    aliases: ["blb", "business leadership", "business leadership bldg", "business leadership building"],
  },
  {
    id: "chem",
    name: "Chemistry Building",
    shortName: "CHEM",
    mnemonic: "CHEM",
    buildingNumber: "112",
    address: address("1508 W. Mulberry St."),
    lat: 33.2140405,
    lng: -97.1499791,
    aliases: ["chem", "chemistry", "chemistry bldg", "chemistry building"],
  },
  {
    id: "env",
    name: "Environmental Science Building",
    shortName: "ENV",
    mnemonic: "ENV",
    buildingNumber: "160",
    address: address("1704 W. Mulberry St."),
    lat: 33.2141641,
    lng: -97.1513851,
    aliases: [
      "env",
      "environmental science",
      "environmental science building",
      "environmental education science technology",
      "environmental education science and technology building",
      "environmental education science technology building",
      "eest",
    ],
  },
  {
    id: "gab",
    name: "General Academic Building",
    shortName: "GAB",
    mnemonic: "GAB",
    buildingNumber: "108",
    address: address("225 S. Avenue B"),
    lat: 33.2131868,
    lng: -97.1481479,
    aliases: ["gab", "general academic", "general academic bldg", "general academic building"],
  },
  {
    id: "gate",
    name: "Gateway Center",
    shortName: "GATE",
    mnemonic: "GATE",
    buildingNumber: "161",
    address: address("801 North Texas Blvd."),
    lat: 33.2077083,
    lng: -97.1542461,
    aliases: ["gate", "gateway", "gateway center"],
  },
  {
    id: "hick",
    name: "Hickory Hall",
    shortName: "HICK",
    mnemonic: "HKRY",
    buildingNumber: "109",
    address: address("1417 W. Hickory St."),
    lat: 33.2142378,
    lng: -97.147901,
    aliases: ["hick", "hkry", "hickory", "hickory hall"],
  },
  {
    id: "lang",
    name: "Language Building",
    shortName: "LANG",
    mnemonic: "LANG",
    buildingNumber: "148",
    address: address("108 Avenue A"),
    lat: 33.2140585,
    lng: -97.1466525,
    aliases: ["lang", "language", "language bldg", "language building"],
  },
  {
    id: "life",
    name: "Life Sciences Complex",
    shortName: "LIFE",
    mnemonic: "LIFE",
    buildingNumber: "141",
    address: address("1511 W. Sycamore St."),
    lat: 33.2121465,
    lng: -97.1490327,
    aliases: ["life", "life sciences", "life sciences complex"],
  },
  {
    id: "matt",
    name: "Matthews Hall",
    shortName: "MATT",
    mnemonic: "MATT",
    buildingNumber: "106",
    address: address("1300 W. Highland St."),
    lat: 33.2098832,
    lng: -97.1467183,
    aliases: ["matt", "matthews", "matthews hall"],
  },
  {
    id: "musi",
    name: "Music Building",
    shortName: "MUSI",
    mnemonic: "MUSI",
    buildingNumber: "127",
    address: address("415 S. Avenue C"),
    lat: 33.2106752,
    lng: -97.1500271,
    aliases: ["musi", "music", "music bldg", "music building"],
  },
  {
    id: "ntdp",
    name: "Discovery Park",
    shortName: "NTDP",
    mnemonic: "NTRP",
    buildingNumber: "190",
    address: address("3940 N. Elm St."),
    lat: 33.254322,
    lng: -97.152493,
    aliases: ["ntdp", "ntrp", "discovery park", "research park"],
    isOffCampus: true,
  },
  {
    id: "sage",
    name: "Sage Hall",
    shortName: "SAGE",
    mnemonic: "SAGE",
    buildingNumber: "104",
    address: address("1167 Union Circle"),
    lat: 33.2121066,
    lng: -97.1467423,
    aliases: ["sage", "sage hall"],
  },
  {
    id: "wh",
    name: "Wooten Hall",
    shortName: "WH",
    mnemonic: "WH",
    buildingNumber: "150",
    address: address("1121 Union Circle"),
    lat: 33.2098557,
    lng: -97.1456764,
    aliases: ["wh", "wooten", "wooten hall"],
  },
];

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export function normalizeLocationLabel(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(university of north texas|unt|denton|tx|texas)\b/g, " ")
    .replace(/\b(bldg|bld)\b/g, "building")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function stripRoomSuffix(value: string) {
  const tokens = value
    .replace(/\b(rm|room|rms|rooms)\b/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  while (tokens.length > 1 && /^[a-z]?\d+[a-z]?$/.test(tokens[tokens.length - 1])) {
    tokens.pop();
  }

  return tokens.join(" ");
}

function codeKeys(value: string) {
  const raw = value.toUpperCase();
  const parenthetical = [...raw.matchAll(/\(([A-Z0-9]{2,6})\)/g)].map((match) => match[1]);
  const leading = raw.match(/^\s*([A-Z]{2,6})\b/)?.[1];
  return unique([...parenthetical, leading ?? ""]).map(normalizeLocationLabel);
}

function aliasLocationKeys(value: string) {
  const withoutParenthetical = value.replace(/\([^)]*\)/g, " ");
  const normalized = normalizeLocationLabel(value);
  const normalizedWithoutParenthetical = normalizeLocationLabel(withoutParenthetical);

  return unique([
    normalized,
    stripRoomSuffix(normalized),
    normalizedWithoutParenthetical,
    stripRoomSuffix(normalizedWithoutParenthetical),
  ]);
}

function baseLocationKeys(value: string) {
  return unique([...aliasLocationKeys(value), ...codeKeys(value)]);
}

const aliasMap = new Map(
  campusBuildings.flatMap((building) =>
    unique([
      building.id,
      building.shortName,
      building.mnemonic ?? "",
      building.name,
      building.buildingNumber ?? "",
      ...(building.aliases ?? []),
    ]).flatMap((alias) => aliasLocationKeys(alias).map((key) => [key, building] as const)),
  ),
);

export function normalizeCampusLocationKey(value: string) {
  const building = resolveCampusBuilding(value);
  if (building) {
    return building.id;
  }

  const keys = baseLocationKeys(value);
  return keys[1] ?? keys[0] ?? "";
}

export function buildCampusGeocodeQuery(location: string) {
  const normalized = location.trim();
  const lower = normalized.toLowerCase();
  return lower.includes("unt") || lower.includes("university of north texas")
    ? normalized
    : `${normalized} University of North Texas Denton TX`;
}

export function isInsideUntBounds(location: { lat: number; lng: number }) {
  return (
    location.lat >= untCampusBounds.south &&
    location.lat <= untCampusBounds.north &&
    location.lng >= untCampusBounds.west &&
    location.lng <= untCampusBounds.east
  );
}

export function resolveCampusBuilding(location: string, buildingId?: string | null) {
  const idMatch = buildingId
    ? baseLocationKeys(buildingId)
        .map((key) => aliasMap.get(key))
        .find(Boolean)
    : undefined;

  if (idMatch) {
    return idMatch;
  }

  return (
    baseLocationKeys(location)
      .map((key) => aliasMap.get(key))
      .find(Boolean) ?? null
  );
}

export function resolveCampusLocation(location: string, buildingId?: string | null) {
  const building = resolveCampusBuilding(location, buildingId);
  if (!building || building.isOffCampus || !isInsideUntBounds(building)) {
    return null;
  }

  return building;
}
