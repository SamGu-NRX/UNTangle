/**
 * The credit line on a narrow map: MapLibre shows it expanded on load and
 * folds it behind its (i) button only when the map is dragged. OpenStreetMap's
 * attribution guideline also allows folding on the first click or zoom
 * (osmfoundation.org/wiki/Licence/Attribution_Guidelines, "Interactive
 * maps"), so any first pointer press or wheel on the map folds it, and the
 * (i) button still opens it. Wide maps keep the full line (MapLibre's own
 * rule: compact at 640 px or narrower).
 */
import type { Map as MapLibreMap } from "maplibre-gl";

export function foldAttributionOnFirstInteraction(map: MapLibreMap): () => void {
  const surface = map.getCanvasContainer();
  const fold = () => {
    map.getContainer().querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show")?.classList.remove("maplibregl-compact-show");
    stop();
  };
  const stop = () => {
    surface.removeEventListener("pointerdown", fold);
    surface.removeEventListener("wheel", fold);
  };
  surface.addEventListener("pointerdown", fold, { passive: true });
  surface.addEventListener("wheel", fold, { passive: true });
  return stop;
}
