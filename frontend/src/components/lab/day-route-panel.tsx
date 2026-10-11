"use client";

import { usePlanner } from "@/components/planner-provider";
import { useDayLegs } from "@/components/lab/use-day-legs";
import { summarizeDayLegs } from "@/lib/lab/leg-routing";
import { dayLegNotice, formatMeters, formatWalkingMinutes, pickLongestLeg } from "@/lib/lab/leg-format";
import { LegMap } from "@/components/lab/leg-map";

export function DayRoutePanel() {
  const { routeStops, plannerState } = usePlanner();
  const activeDay = plannerState.activeDay;
  const stops = routeStops[activeDay] ?? [];
  const { legs, state: panelState, recheck } = useDayLegs(stops);

  const summary = summarizeDayLegs(legs);
  const longest = pickLongestLeg(legs);
  const notice = dayLegNotice(summary);

  return (
    <div className="lab-route">
      <div className="lab-route__head">
        <h2 className="font-display">Walking route — {activeDay}</h2>
        <button type="button" className="lab-route__reload" onClick={recheck}>
          Recheck route
        </button>
      </div>

      {stops.length === 0 && <p className="lab-route__empty">No classes on {activeDay} — nothing to walk.</p>}
      {stops.length === 1 && <p className="lab-route__empty">One class on {activeDay} — no walking legs yet.</p>}

      {panelState === "loading" && (
        <p className="lab-route__status" role="status">
          Checking today&rsquo;s route…
        </p>
      )}

      {panelState === "error" && (
        <p className="lab-route__status" role="status">
          The route service did not answer. Distances below are straight-line estimates; no walking
          times are shown.
        </p>
      )}

      {panelState === "ready" && legs.length > 0 && (
        <>
          <LegMap legs={legs} />
          <dl className="lab-route__summary">
            <div>
              <dt>Total distance</dt>
              <dd>
                {formatMeters(summary.totalDistanceMeters)}
                {summary.approximateLegs > 0 ? " (approximate)" : ""}
              </dd>
            </div>
            <div>
              <dt>Walking time</dt>
              <dd>
                {summary.knownWalkingSeconds !== null
                  ? formatWalkingMinutes(summary.knownWalkingSeconds)
                  : "unavailable — distances only"}
              </dd>
            </div>
          </dl>
          {notice && (
            <p className="lab-route__notice" role="note">
              {notice}
            </p>
          )}
          {longest && (
            <p className="lab-route__longest">
              Longest walk: {longest.from.shortName} → {longest.to.shortName},{" "}
              {formatMeters(longest.distanceMeters)}
              {longest.status === "approximate" ? " (approximate)" : ""}
            </p>
          )}
          <ol className="lab-route__legs">
            {legs.map((leg, index) => (
              <li key={index} className={"lab-route__leg lab-route__leg--" + leg.status}>
                <span className="lab-route__leg-label">
                  {leg.from.shortName} → {leg.to.shortName}
                </span>
                {leg.status === "same-building" && (
                  <span className="lab-route__leg-detail">Same building — no walk needed</span>
                )}
                {leg.status === "unresolved" && (
                  <span className="lab-route__leg-detail">Location unresolved — no route shown</span>
                )}
                {(leg.status === "walking" || leg.status === "approximate") && (
                  <span className="lab-route__leg-detail">
                    {formatMeters(leg.distanceMeters)}
                    {leg.status === "approximate" ? " (approx.)" : ""}
                    {leg.durationSeconds !== null
                      ? " · " + formatWalkingMinutes(leg.durationSeconds)
                      : " · no walking time"}
                  </span>
                )}
                {leg.source === "ors" && (
                  <span className="lab-route__leg-source">Route © OpenStreetMap contributors via ORS</span>
                )}
                {leg.source === "campus-network" && (
                  <span className="lab-route__leg-source">Campus walking network</span>
                )}
                {leg.source === "fallback" && (
                  <span className="lab-route__leg-source">Straight-line estimate</span>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
