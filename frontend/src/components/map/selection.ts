/** What the map and the itinerary both highlight: one class stop, one walking leg, or nothing. */
export type MapSelection = { kind: "stop"; key: string } | { kind: "leg"; key: string } | null;
