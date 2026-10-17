"use client";

import type { LabLeg } from "@/lib/lab/leg-routing";

type Point = { lat: number; lng: number };

function positionsOf(leg: LabLeg): Point[] {
  if (leg.geometry.length >= 2) {
    return leg.geometry;
  }
  const { from, to } = leg;
  if (
    typeof from.lat === "number" && typeof from.lng === "number" &&
    typeof to.lat === "number" && typeof to.lng === "number"
  ) {
    return [
      { lat: from.lat, lng: from.lng },
      { lat: to.lat, lng: to.lng },
    ];
  }
  return [];
}

const WIDTH = 640;
const HEIGHT = 380;
const PAD = 28;

/** A static, source-honest sketch of the day's legs. No tiles, no panning — the
 * per-leg list below carries the detail; this shows shape and gaps. */
export function LegMap({ legs, showLabels = false }: { legs: LabLeg[]; showLabels?: boolean }) {
  const segments = legs
    .filter((leg) => leg.status === "walking" || leg.status === "approximate")
    .map((leg) => ({ leg, points: positionsOf(leg) }));
  const dots = segments
    .flatMap(({ points }) => (points.length >= 2 ? [points[0], points[points.length - 1]] : []));
  const all = segments.flatMap(({ points }) => points);

  if (all.length < 2 || dots.length === 0) {
    return null;
  }

  const lats = all.map((point) => point.lat);
  const lngs = all.map((point) => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const spanLat = maxLat - minLat || 0.0001;
  const spanLng = maxLng - minLng || 0.0001;
  const px = (lng: number) => PAD + ((lng - minLng) / spanLng) * (WIDTH - PAD * 2);
  const py = (lat: number) => HEIGHT - PAD - ((lat - minLat) / spanLat) * (HEIGHT - PAD * 2);

  return (
    <svg
      className="lab-map"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={`Sketch of the day's walking route: ${legs.length} legs. Distances and times are listed below the map.`}
    >
      {segments.map(({ leg, points }, index) =>
        points.length >= 2 ? (
          <polyline
            key={index}
            className={"lab-map__leg lab-map__leg--" + leg.status}
            points={points.map((point) => `${px(point.lng).toFixed(1)},${py(point.lat).toFixed(1)}`).join(" ")}
            fill="none"
          />
        ) : null,
      )}
      {showLabels &&
        segments.map(({ leg, points }, index) => {
          if (points.length < 2) return null;
          const head = { name: leg.from.shortName, point: points[0] };
          const tail = index === segments.length - 1 ? { name: leg.to.shortName, point: points[points.length - 1] } : null;
          return [head, tail];
        })
          .flat()
          .filter((entry): entry is { name: string; point: Point } => entry !== null)
          .map((entry, index) => (
            <text
              key={"label-" + index}
              className="lab-map__label"
              x={px(entry.point.lng).toFixed(1)}
              y={(py(entry.point.lat) - 9).toFixed(1)}
              textAnchor="middle"
            >
              {entry.name}
            </text>
          ))}
      {dots.map((point, index) => (
        <circle
          key={"dot-" + index}
          className="lab-map__dot"
          cx={px(point.lng).toFixed(1)}
          cy={py(point.lat).toFixed(1)}
          r={4}
        />
      ))}
    </svg>
  );
}
