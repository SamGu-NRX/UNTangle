/** Keyboard navigation over a list of options where some are disabled. */

export type NavOption = { label: string; disabled?: boolean };

/**
 * The next enabled index from `from` moving by `delta` (±1). Stops at the
 * ends (select listboxes do not wrap, per the APG select-only combobox).
 * Returns `from` when nothing enabled lies that way.
 */
export function stepEnabled(options: NavOption[], from: number, delta: 1 | -1): number {
  for (let i = from + delta; i >= 0 && i < options.length; i += delta) {
    if (!options[i].disabled) return i;
  }
  return from;
}

export function firstEnabled(options: NavOption[]): number {
  return options.findIndex((option) => !option.disabled);
}

export function lastEnabled(options: NavOption[]): number {
  for (let i = options.length - 1; i >= 0; i -= 1) {
    if (!options[i].disabled) return i;
  }
  return -1;
}

/**
 * Typeahead: the first enabled option after `from` (wrapping) whose label
 * starts with `query`, case-insensitive. Repeating one letter ("ss") cycles
 * through options starting with that letter. -1 when nothing matches.
 */
export function typeaheadMatch(options: NavOption[], query: string, from: number): number {
  const q = query.toLowerCase();
  if (!q) return -1;
  const repeated = q.length > 1 && [...q].every((ch) => ch === q[0]);
  const needle = repeated ? q[0] : q;
  // A growing query ("ok" after "o") should keep the current match if it
  // still fits; a single or repeated letter moves on to the next match.
  const start = needle.length > 1 ? from : from + 1;
  for (let step = 0; step < options.length; step += 1) {
    const i = (((start + step) % options.length) + options.length) % options.length;
    const option = options[i];
    if (!option.disabled && option.label.toLowerCase().startsWith(needle)) return i;
  }
  return -1;
}
