/**
 * Stated walking-speed model for campus route durations.
 *
 * - Base speed 1.4 m/s: the Highway Capacity Manual crosswalk design walking
 *   speed, as summarized in FHWA, "Chapter 2 — Capacity Analysis of Pedestrian
 *   and Bicycle Facilities"
 *   (https://www.fhwa.dot.gov/publications/research/safety/pedbike/98107/section2.cfm).
 * - Steps speed 0.6 m/s along the stair: chosen inside the range of published
 *   stair walking speeds (0.48–0.83 m/s) reported by "Individual Stair Ascent
 *   and Descent Walk Speeds Measured in a Korean High-Rise Building", Fire
 *   Technology (2013), https://link.springer.com/article/10.1007/s10694-013-0371-4.
 *   This is a stated assumption for a mixed campus population, not a UNT
 *   measurement.
 *
 * Every duration this library produces is distance divided by these speeds,
 * computed per walkway edge so steps edges are timed at the steps speed.
 * See tools/campus-geodata/README.md for the full statement.
 */

export const WALKING_SPEED_MPS = 1.4;
export const STEPS_SPEED_MPS = 0.6;

/**
 * A building anchor is connected to the walkway graph only if the nearest
 * graph node (in the largest connected component) is within this distance.
 * Matches evals/fixtures/METHOD.md's 250 m snap cap.
 */
export const SNAP_MAX_METERS = 250;
