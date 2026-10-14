/**
 * Floor counts for UNT buildings, each checked against a UNT source. An entry
 * fills in where OpenStreetMap has no height or levels, and outranks
 * Overture's ML estimate (heights.ts); where OSM has its own levels, OSM still
 * wins.
 *
 * Source: UNT Risk Management's 2025 building emergency action plans, whose
 * labelled floor maps give the floors above ground (basements excluded).
 * Gathered in #57 by registry code and keyed here by the OSM outline each
 * code names. ENV and ENV SCI are one outline and one plan, so one entry.
 * Discovery Park (NTRP) is outside the map and has no entry; the Coliseum and
 * DATCU Stadium have no confirmed count above ground and are left out.
 *
 * A better fix for a building still missing here is building:levels in
 * OpenStreetMap: it corrects every map at once.
 */
import type { FallbackHeight } from "@/lib/campus/map-detail/heights";

export const untFallbackHeights: readonly FallbackHeight[] = [
  { osm: "way/256787052", name: "General Academic Building (GAB)", floors: 5, source: "https://riskmanagement.unt.edu/emergency/_images/beap_general_academic_building_2025.pdf", retrieved: "2026-10-13" },
  { osm: "way/256766443", name: "Willis Library (LIBR)", floors: 4, source: "https://riskmanagement.unt.edu/emergency/_images/beap_willis_library_2025.pdf", retrieved: "2026-10-13" },
  { osm: "way/518915908", name: "University Union (UU)", floors: 4, source: "https://riskmanagement.unt.edu/emergency/_images/beap_university_union_2025.pdf", retrieved: "2026-10-13" },
  { osm: "way/256787053", name: "Sage Hall (SAGE)", floors: 3, source: "https://riskmanagement.unt.edu/emergency/_images/beap_sage_hall_2025.pdf", retrieved: "2026-10-13" },
  { osm: "way/256877960", name: "Chilton Hall (CHIL)", floors: 3, source: "https://riskmanagement.unt.edu/emergency/_images/beap_chilton_hall_2025.pdf", retrieved: "2026-10-13" },
  { osm: "way/256787051", name: "Life Sciences Complex (LIFE)", floors: 5, source: "https://riskmanagement.unt.edu/emergency/_images/beap_life_science_complex_2025.pdf", retrieved: "2026-10-13" },
  { osm: "way/256877953", name: "Wooten Hall (WH)", floors: 3, source: "https://riskmanagement.unt.edu/emergency/_images/beap_wooten_hall_2025.pdf", retrieved: "2026-10-13" },
  { osm: "way/256780364", name: "Business Leadership Building (BLB)", floors: 3, source: "https://riskmanagement.unt.edu/emergency/_images/beap_business_leadership_building_2025.pdf", retrieved: "2026-10-13" },
  { osm: "way/256943683", name: "Curry Hall (CURY)", floors: 3, source: "https://riskmanagement.unt.edu/emergency/_images/beap_curry_hall_2025.pdf", retrieved: "2026-10-13" },
  { osm: "way/256943681", name: "Language Building (LANG)", floors: 4, source: "https://riskmanagement.unt.edu/emergency/_images/beap_language_building_2025.pdf", retrieved: "2026-10-13" },
  { osm: "way/256943682", name: "Auditorium Building (AUDB)", floors: 3, source: "https://riskmanagement.unt.edu/emergency/_images/beap_auditorium_english_building_2025.pdf", retrieved: "2026-10-13" },
  { osm: "way/256943680", name: "Hickory Hall (HKRY)", floors: 2, source: "https://riskmanagement.unt.edu/emergency/_images/beap_hickory_hall_2025.pdf", retrieved: "2026-10-13" },
  { osm: "way/260225246", name: "Marquis Hall (MARQ)", floors: 3, source: "https://riskmanagement.unt.edu/emergency/_images/beap_marquis_hall_2025.pdf", retrieved: "2026-10-13" },
  { osm: "way/260225245", name: "Terrill Hall (TH)", floors: 3, source: "https://riskmanagement.unt.edu/emergency/_images/beap_terrill_hall_2025.pdf", retrieved: "2026-10-13" },
  { osm: "way/256943684", name: "Physics Building (PHYS)", floors: 3, source: "https://riskmanagement.unt.edu/emergency/_images/beap_physics_building_2025.pdf", retrieved: "2026-10-13" },
  { osm: "way/196948628", name: "Environmental Education, Science & Technology (ENV SCI)", floors: 3, source: "https://riskmanagement.unt.edu/emergency/_images/beap_eesat_2025.pdf", retrieved: "2026-10-13" },
  { osm: "way/518915918", name: "Dance & Theatre Building (DATH)", floors: 1, source: "https://riskmanagement.unt.edu/emergency/_images/beap_dance_and_theater_arts_building_2025.pdf", retrieved: "2026-10-13" },
  { osm: "relation/19008654", name: "Music Building (MUSI)", floors: 3, source: "https://riskmanagement.unt.edu/emergency/_images/beap_music_building_2025.pdf", retrieved: "2026-10-13" },
  { osm: "way/197104937", name: "Murchison Performing Arts Center (PAC)", floors: 4, source: "https://riskmanagement.unt.edu/emergency/_images/beap_murchison_performing_arts_center_2025.pdf", retrieved: "2026-10-13" },
];
