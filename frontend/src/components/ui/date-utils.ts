/**
 * Calendar-date arithmetic on ISO strings ("2027-01-20"). Dates are civil
 * days with no time or zone, so all arithmetic runs in UTC and never meets
 * a daylight-saving shift.
 */

export type ISODate = string;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Builds an ISO date, or null when the day does not exist (Feb 30). */
export function makeDate(year: number, month: number, day: number): ISODate | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function parts(iso: ISODate): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day };
}

function toUTC(iso: ISODate): Date {
  const { year, month, day } = parts(iso);
  return new Date(Date.UTC(year, month - 1, day));
}

function fromUTC(d: Date): ISODate {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function isISODate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return Boolean(m && makeDate(Number(m[1]), Number(m[2]), Number(m[3])));
}

export function addDays(iso: ISODate, days: number): ISODate {
  const d = toUTC(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUTC(d);
}

/** Moves by whole months, clamping the day (Jan 31 + 1 month = Feb 28). */
export function addMonths(iso: ISODate, months: number): ISODate {
  const { year, month, day } = parts(iso);
  const index = year * 12 + (month - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return makeDate(y, m, Math.min(day, last))!;
}

/** Day of week, 0 = Sunday. */
export function weekday(iso: ISODate): number {
  return toUTC(iso).getUTCDay();
}

export function compareDates(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** "Jan 20, 2027". */
export function formatDate(iso: ISODate): string {
  const { year, month, day } = parts(iso);
  return `${MONTH_LABELS[month - 1]} ${day}, ${year}`;
}

/** "January 2027". */
export function formatMonth(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/** "Wednesday, January 20, 2027", for screen readers. */
export function formatLong(iso: ISODate): string {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const { year, month, day } = parts(iso);
  return `${days[weekday(iso)]}, ${MONTH_NAMES[month - 1]} ${day}, ${year}`;
}

/** Today in the user's own time zone. */
export function todayISO(now: Date = new Date()): ISODate {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function expandYear(y: number): number {
  // Two-digit years are this century: "1/20/27" is 2027.
  return y < 100 ? 2000 + y : y;
}

/**
 * Reads what a person types into a date field. Accepts US month-first
 * numbers ("1/20/27", "01-20-2027"), ISO ("2027-01-20") and month names
 * ("Jan 20, 2027", "January 20 2027", "20 Jan 2027"). A missing year takes
 * `defaultYear`. Returns null for anything else or for a day that does not
 * exist; it never guesses between day-first and month-first.
 */
export function parseDateText(text: string, defaultYear: number): ISODate | null {
  const t = text.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (!t) return null;

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return makeDate(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(t);
  if (m) return makeDate(m[3] ? expandYear(Number(m[3])) : defaultYear, Number(m[1]), Number(m[2]));

  const monthOf = (word: string) => {
    const index = MONTHS.indexOf(word.slice(0, 3));
    return index >= 0 && MONTH_NAMES[index].toLowerCase().startsWith(word) ? index + 1 : 0;
  };

  m = /^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{2}|\d{4}))?$/.exec(t);
  if (m && monthOf(m[1])) return makeDate(m[3] ? expandYear(Number(m[3])) : defaultYear, monthOf(m[1]), Number(m[2]));

  m = /^(\d{1,2}) ([a-z]+)\.?(?: (\d{2}|\d{4}))?$/.exec(t);
  if (m && monthOf(m[2])) return makeDate(m[3] ? expandYear(Number(m[3])) : defaultYear, monthOf(m[2]), Number(m[1]));

  return null;
}

/**
 * The six Sunday-first weeks shown for a month: always 42 days, so the
 * picker keeps one height from month to month.
 */
export function monthGrid(year: number, month: number): Array<{ iso: ISODate; inMonth: boolean }> {
  const first = makeDate(year, month, 1)!;
  const start = addDays(first, -weekday(first));
  return Array.from({ length: 42 }, (_, i) => {
    const iso = addDays(start, i);
    return { iso, inMonth: parts(iso).month === month };
  });
}
