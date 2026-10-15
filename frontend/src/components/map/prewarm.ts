/**
 * Compiles the street-zoom layers' shaders while the map is idle, instead of
 * during the first flight to a class.
 *
 * WebGL compiles a layer's shader program the first time the layer draws.
 * The campus detail's extrusions, tree and entrance circles and bold labels
 * first draw at street zoom, so without this their compile lands inside the
 * first 500 ms stop flight; profiling showed that flight's longest frames
 * waiting in getProgramParameter (link status). This renders one frame at a
 * street-zoom camera and one back at the real camera, synchronously in one
 * task, so the browser never presents the first frame.
 */
import type { Map as MapLibreMap } from "maplibre-gl";

const WARM_ZOOM = 17.8;
const WARM_PITCH = 45;

export function prewarmStreetZoom(map: MapLibreMap) {
  if (map.isMoving()) return;
  const camera = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
  map.jumpTo({ zoom: WARM_ZOOM, pitch: WARM_PITCH });
  map.redraw();
  map.jumpTo(camera);
  map.redraw();
}
