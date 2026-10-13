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

// Names, mnemonics, building numbers, and addresses come from UNT Facilities
// (facilities.unt.edu/resources/building-information.html). Coordinates for the
// original 16 entries were checked against UNT Names and OSM building
// footprints; the entries added 2026-10-11 use the official UNT GIS
// Building_Cartographic_Shape layer (LON/LAT, WGS84). Registrar building-code
// research (facilities registry, registrar Learning Spaces inventory, GIS
// HISTORY) confirmed the mnemonics and the code conflicts documented below.
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
    id: "ath1",
    name: "Air Force ROTC Building",
    shortName: "ATH1",
    mnemonic: "ATH1",
    buildingNumber: "305",
    address: address("712 North Texas Blvd."),
    lat: 33.2076379,
    lng: -97.1565785,
    aliases: ["ath1", "ath", "afrotc", "air force rotc", "air force rotc building"],
    // A block west of untCampusBounds, on North Texas Blvd: outside the walkway
    // graph and the routing bounds, so it is excluded from route resolution.
    isOffCampus: true,
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
    id: "bain",
    name: "Bain Hall",
    shortName: "BAIN",
    mnemonic: "BAIN",
    buildingNumber: "122",
    address: address("1820 W. Highland St."),
    lat: 33.2096924,
    lng: -97.152477,
    aliases: ["bain", "bain hall"],
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
    id: "chil",
    name: "Chilton Hall",
    shortName: "CHIL",
    mnemonic: "CHIL",
    buildingNumber: "126",
    address: address("410 S. Avenue C"),
    lat: 33.2110353,
    lng: -97.1513335,
    aliases: ["chil", "chilton", "chilton hall"],
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
    id: "col",
    name: "Coliseum",
    shortName: "COL",
    mnemonic: "COL",
    buildingNumber: "154",
    address: address("601 North Texas Blvd."),
    lat: 33.2086577,
    lng: -97.1541414,
    aliases: ["col", "coliseum"],
  },
  {
    id: "cury",
    name: "Curry Hall",
    shortName: "CURY",
    mnemonic: "CURY",
    buildingNumber: "107",
    address: address("200 Avenue A"),
    lat: 33.2135195,
    lng: -97.1466553,
    aliases: ["cury", "curry", "curry hall"],
  },
  {
    id: "dath",
    name: "Dance and Theatre Building",
    shortName: "DATH",
    mnemonic: "DATH",
    buildingNumber: "159",
    address: address("300 Bernard St."),
    lat: 33.212103,
    lng: -97.1416788,
    aliases: ["dath", "dance and theatre", "dance and theatre building", "dance and theater", "dance theater"],
  },
  {
    id: "essc",
    name: "Eagle Student Services Center",
    shortName: "ESSC",
    mnemonic: "ESSC",
    buildingNumber: "113",
    address: address("1147 Union Circle"),
    lat: 33.2103345,
    lng: -97.1479731,
    aliases: ["essc", "eagle student services", "eagle student services center"],
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
      // The classroom system schedules this building as "ESB" and UNT pages
      // commonly call it "EESAT" (facilities mnemonic is ENV) — all map here.
      "esb",
      "eesat",
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
    id: "musa",
    name: "Music Annex",
    shortName: "MUSA",
    mnemonic: "MUSA",
    buildingNumber: "115",
    address: address("1630 W. Highland St."),
    lat: 33.2097157,
    lng: -97.1499891,
    aliases: ["musa", "music annex", "music annex building"],
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
    id: "pac",
    name: "Performing Arts Center",
    shortName: "PAC",
    mnemonic: "PAC",
    buildingNumber: "129",
    address: address("2100 N. I-35E"),
    lat: 33.2063395,
    lng: -97.1550339,
    // Named for Lucille "Lupe" Murchison; the classroom system misspells it
    // "Murchinson" — both resolve here.
    aliases: ["pac", "mpac", "murchison", "murchison performing arts center", "murchinson performing arts center", "performing arts center"],
  },
  {
    id: "peb",
    name: "Physical Education Building",
    shortName: "PEB",
    mnemonic: "PEB",
    buildingNumber: "117",
    address: address("1921 Chestnut St."),
    lat: 33.210908,
    lng: -97.1529673,
    aliases: ["peb", "physical education", "physical education building"],
  },
  {
    id: "phys",
    name: "Physics Building",
    shortName: "PHYS",
    mnemonic: "PHYS",
    buildingNumber: "119",
    address: address("210 Avenue A"),
    lat: 33.2130886,
    lng: -97.1466173,
    aliases: ["phys", "physics", "physics building", "physics bldg"],
  },
  {
    id: "rtfp",
    name: "Radio, TV, Film & Performing Arts Building",
    shortName: "RTFP",
    mnemonic: "RTFP",
    buildingNumber: "140",
    address: address("1179 Union Circle"),
    lat: 33.2120796,
    lng: -97.1456902,
    aliases: ["rtfp", "radio tv film and performing arts", "radio tv film and performing arts building"],
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
    aliases: ["sage", "sage hall", "business administration building"],
  },
  {
    id: "symr",
    name: "Sycamore Hall",
    shortName: "SYMR",
    mnemonic: "SYMR",
    buildingNumber: "111",
    address: address("307 S. Avenue B"),
    lat: 33.2121076,
    lng: -97.1479211,
    aliases: ["symr", "sycamore", "sycamore hall", "information sciences building"],
  },
  {
    id: "th",
    name: "Terrill Hall",
    shortName: "TH",
    mnemonic: "TH",
    buildingNumber: "131",
    address: address("1611 W. Mulberry St."),
    lat: 33.2131906,
    lng: -97.1495662,
    aliases: ["th", "terrill", "terrill hall"],
  },
  {
    id: "uu",
    name: "University Union",
    shortName: "UU",
    mnemonic: "UU",
    buildingNumber: "155",
    address: address("1155 Union Circle"),
    lat: 33.210906,
    lng: -97.14735,
    aliases: ["uu", "union", "university union", "student union"],
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
  {
    id: "mgvp",
    name: "MGV Building P",
    shortName: "MGVP",
    mnemonic: "MGVP",
    buildingNumber: "464",
    address: address("1500 S. Bonnie Brae St."),
    lat: 33.201171,
    lng: -97.1619982,
    aliases: ["mgvp", "mgv building p", "mean green village p"],
    // Mean Green Village athletics zone, south of untCampusBounds and outside
    // the walkway graph: excluded from route resolution.
    isOffCampus: true,
  },
  // Added 2026-10-13 for rooms in vsb's Spring 2027 file (MGYM, WSC2, PACX,
  // SPHS) that mapped to no building. Names and pins are the OSM building
  // outlines in the campus kit's Overpass snapshot (tools/campus-geodata/raw),
  // pin = outline centroid; way ids are noted. No UNT Facilities building
  // number was checked for these.
  {
    id: "mgym",
    name: "Ken Bahnsen Gym",
    shortName: "MGYM",
    lat: 33.209963,
    lng: -97.153642,
    // OSM way 141910348.
    aliases: ["mgym", "bahnsen gym", "ken bahnsen gym", "mens gym"],
  },
  {
    id: "wsc2",
    name: "Welch Street Complex 2",
    shortName: "WSC2",
    address: address("425 S. Welch St."),
    lat: 33.210719,
    lng: -97.143987,
    // OSM way 518920094.
    aliases: ["wsc2", "welch street complex 2"],
  },
  {
    id: "pacx",
    name: "Performing Arts Center Annex",
    shortName: "PACX",
    lat: 33.206496,
    lng: -97.155783,
    // OSM way 293803909.
    aliases: ["pacx", "performing arts center annex"],
  },
  {
    id: "sphs",
    name: "Speech & Hearing Clinic",
    shortName: "SPHS",
    address: address("907 W. Sycamore St."),
    lat: 33.212294,
    lng: -97.142003,
    // OSM way 293804600.
    aliases: ["sphs", "speech and hearing clinic"],
  },
];

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export const untNameCleanupWords = ["university of north texas", "unt", "denton", "tx", "texas"];

export function normalizeLocationLabel(value: string, cleanupWords: readonly string[] = untNameCleanupWords) {
  const escaped = cleanupWords.map(word => word
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(escaped.length ? new RegExp(`\\b(${escaped.join("|")})\\b`, "g") : /$^/, " ")
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

function codeKeys(value: string, cleanupWords: readonly string[] = untNameCleanupWords) {
  const raw = value.toUpperCase();
  const parenthetical = [...raw.matchAll(/\(([A-Z0-9]{2,6})\)/g)].map((match) => match[1]);
  const leading = raw.match(/^\s*([A-Z]{2,6})\b/)?.[1];
  return unique([...parenthetical, leading ?? ""]).map(value => normalizeLocationLabel(value, cleanupWords));
}

function aliasLocationKeys(value: string, cleanupWords: readonly string[] = untNameCleanupWords) {
  const withoutParenthetical = value.replace(/\([^)]*\)/g, " ");
  const normalized = normalizeLocationLabel(value, cleanupWords);
  const normalizedWithoutParenthetical = normalizeLocationLabel(withoutParenthetical, cleanupWords);

  return unique([
    normalized,
    stripRoomSuffix(normalized),
    normalizedWithoutParenthetical,
    stripRoomSuffix(normalizedWithoutParenthetical),
  ]);
}

function baseLocationKeys(value: string, cleanupWords: readonly string[] = untNameCleanupWords) {
  return unique([...aliasLocationKeys(value, cleanupWords), ...codeKeys(value, cleanupWords)]);
}

export function normalizeCampusLocationKey(value: string) {
  const building = resolveCampusBuilding(value);
  if (building) {
    return building.id;
  }

  const keys = baseLocationKeys(value);
  return keys[1] ?? keys[0] ?? "";
}

/**
 * How a campus's name is added to a free-text geocoding query: the suffix to
 * append, unless the text already names the school by one of its names.
 */
export type GeocodeContext = { suffix: string; names: readonly string[] };

export const untGeocodeContext: GeocodeContext = {
  suffix: "University of North Texas Denton TX",
  names: ["unt", "university of north texas"],
};

export function geocodeQuery(location: string, context: GeocodeContext) {
  const normalized = location.trim();
  const lower = normalized.toLowerCase();
  return context.names.some((name) => lower.includes(name)) ? normalized : `${normalized} ${context.suffix}`;
}

/** UNT's query, for the planner's stop metadata. Map code passes the active campus's context. */
export function buildCampusGeocodeQuery(location: string) {
  return geocodeQuery(location, untGeocodeContext);
}

export function isInsideBounds(
  location: { lat: number; lng: number },
  bounds: { north: number; south: number; east: number; west: number },
) {
  return (
    location.lat >= bounds.south &&
    location.lat <= bounds.north &&
    location.lng >= bounds.west &&
    location.lng <= bounds.east
  );
}

export function isInsideUntBounds(location: { lat: number; lng: number }) {
  return isInsideBounds(location, untCampusBounds);
}

type Bounds = { north: number; south: number; east: number; west: number };

/** Building lookup for one campus: its own registry, aliases and routing bounds. */
export type CampusResolver = {
  /** The registry building a free-text location (or id) names, on campus or off. */
  resolveBuilding: (location: string, buildingId?: string | null) => CampusBuilding | null;
  /** The building, only if it is on campus and inside the campus's routing bounds. */
  resolveLocation: (location: string, buildingId?: string | null) => CampusBuilding | null;
};

export function createCampusResolver(buildings: readonly CampusBuilding[], bounds: Bounds, cleanupWords: readonly string[] = []): CampusResolver {
  const byId = new Map(buildings.map(building => [building.id, building]));
  const aliasMap = new Map(
    buildings.flatMap((building) =>
      unique([
        building.shortName,
        building.mnemonic ?? "",
        building.name,
        building.buildingNumber ?? "",
        ...(building.aliases ?? []),
      ]).flatMap((alias) => aliasLocationKeys(alias, cleanupWords).map((key) => [key, building] as const)),
    ),
  );

  const resolveBuilding = (location: string, buildingId?: string | null) => {
    // Canonical IDs such as osm-123 must never lose their numeric token as a room suffix.
    const idMatch = byId.get(buildingId ?? "") ?? byId.get(location);
    if (idMatch) {
      return idMatch;
    }
    return (
      baseLocationKeys(location, cleanupWords)
        .map((key) => aliasMap.get(key))
        .find(Boolean) ?? null
    );
  };

  const resolveLocation = (location: string, buildingId?: string | null) => {
    const building = resolveBuilding(location, buildingId);
    if (!building || building.isOffCampus || !isInsideBounds(building, bounds)) {
      return null;
    }
    return building;
  };

  return { resolveBuilding, resolveLocation };
}

/** UNT Denton's resolver, for code that is UNT-specific (the planner, the walking matrix). */
const untResolver = createCampusResolver(campusBuildings, untCampusBounds, untNameCleanupWords);

export function resolveCampusBuilding(location: string, buildingId?: string | null) {
  return untResolver.resolveBuilding(location, buildingId);
}

export function resolveCampusLocation(location: string, buildingId?: string | null) {
  return untResolver.resolveLocation(location, buildingId);
}
