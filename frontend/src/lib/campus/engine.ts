import type { LatLng } from "@/lib/campus/geo";
import type { CampusRouteGeometry } from "@/lib/campus/graph";

export type CampusEngine = {
  routeBetweenPoints: (a: LatLng, b: LatLng) => CampusRouteGeometry | null;
  anchorFor: (buildingId: string) => LatLng | null;
};

/** Cache the first selection, including concurrent callers during loading. */
export function createCampusEngineRegistry(loaders: Record<string, () => Promise<CampusEngine>>) {
  const engines = new Map<string, Promise<CampusEngine>>();
  return (campusId: string): Promise<CampusEngine> => {
    if (!Object.hasOwn(loaders, campusId)) {
      throw new Error(
        `No walking engine for campus "${campusId}". Build its geodata and register it in lib/campus/engine.ts.`,
      );
    }
    let engine = engines.get(campusId);
    if (!engine) {
      engine = loaders[campusId]();
      engines.set(campusId, engine);
    }
    return engine;
  };
}

export const campusEngine = createCampusEngineRegistry({
  "ut-austin": async () => {
    const [{ default: dataset }, { default: matrix }, { createDatasetGraph }] = await Promise.all([
      import("./data/ut-austin/campus-map.json"),
      import("./data/ut-austin/walking-times.json"),
      import("./graph"),
    ]);
    const graph = createDatasetGraph(dataset);
    const anchors = new Map(Object.entries(matrix.anchors));
    return {
      routeBetweenPoints: graph.routeBetweenPoints,
      anchorFor: (id) => {
        const a = anchors.get(id.toLowerCase());
        return a ? { lat: a.anchor[0], lng: a.anchor[1] } : null;
      },
    };
  },
  "unt-denton": async () => {
    const [{ routeBetweenPoints }, { buildingAnchor }] = await Promise.all([
      import("./graph"),
      import("./walking-times"),
    ]);
    return {
      routeBetweenPoints,
      anchorFor: (buildingId) => buildingAnchor(buildingId)?.anchor ?? null,
    };
  },
});
