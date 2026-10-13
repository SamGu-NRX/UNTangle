/**
 * Course colors for one schedule (DESIGN.md §7), after UT Registration Plus's
 * getUnusedColor: courses from one department cluster on neighbouring hues,
 * and a new department takes the hue farthest from those in use. Hues are the
 * six --c1…--c6 tokens.
 */

export type Hue = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * The hues in ring order: neighbours here read as related (moss, slate,
 * teal, ochre, clay, plum), and the ring wraps from plum back to moss.
 */
export const RING: readonly Hue[] = [1, 3, 6, 4, 2, 5];

export type ColorCourse = { id: string; department: string };

const position = (hue: Hue) => RING.indexOf(hue);

function ringDistance(a: Hue, b: Hue): number {
  const d = Math.abs(position(a) - position(b));
  return Math.min(d, RING.length - d);
}

/**
 * Assigns each course a hue. `previous` is the schedule's stored assignment:
 * a course already in it keeps its hue, so adding or removing a course never
 * recolors the others. New courses are colored in the order given:
 *
 * - a department already in the schedule takes the free hue nearest one of
 *   its hues on the ring, trying the next hue clockwise before the previous;
 * - a new department takes the free hue farthest from every hue in use (the
 *   first course of a schedule gets the first ring hue, moss);
 * - with all six in use, a course reuses its department's first hue, or for
 *   a new department the least-used hue, ties going to ring order.
 *
 * Ties always resolve in ring order, so the same input gives the same output.
 */
export function assignColors(
  courses: readonly ColorCourse[],
  previous: ReadonlyMap<string, Hue> = new Map(),
): Map<string, Hue> {
  const result = new Map<string, Hue>();
  const byDepartment = new Map<string, Hue[]>();
  const uses = new Map<Hue, number>();

  const take = (course: ColorCourse, hue: Hue) => {
    result.set(course.id, hue);
    byDepartment.set(course.department, [...(byDepartment.get(course.department) ?? []), hue]);
    uses.set(hue, (uses.get(hue) ?? 0) + 1);
  };

  for (const course of courses) {
    const kept = previous.get(course.id);
    if (kept !== undefined) take(course, kept);
  }

  for (const course of courses) {
    if (result.has(course.id)) continue;
    const free = RING.filter((hue) => !uses.has(hue));
    const own = byDepartment.get(course.department);
    take(course, own ? nearHue(own, free) : farHue(free, uses));
  }
  return result;
}

function nearHue(own: readonly Hue[], free: readonly Hue[]): Hue {
  if (free.length === 0) return own[0];
  for (let step = 1; step <= RING.length / 2; step += 1) {
    for (const direction of [1, -1]) {
      for (const hue of own) {
        const at = (((position(hue) + direction * step) % RING.length) + RING.length) % RING.length;
        if (free.includes(RING[at])) return RING[at];
      }
    }
  }
  return free[0];
}

function farHue(free: readonly Hue[], uses: ReadonlyMap<Hue, number>): Hue {
  const used = [...uses.keys()];
  if (free.length === 0) {
    return [...RING].sort((a, b) => (uses.get(a) ?? 0) - (uses.get(b) ?? 0) || position(a) - position(b))[0];
  }
  if (used.length === 0) return free[0];
  let best = free[0];
  let bestDistance = -1;
  for (const hue of free) {
    const distance = Math.min(...used.map((other) => ringDistance(hue, other)));
    if (distance > bestDistance) {
      best = hue;
      bestDistance = distance;
    }
  }
  return best;
}
