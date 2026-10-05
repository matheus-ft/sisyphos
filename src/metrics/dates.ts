import type { IsoDate } from '../model';

/**
 * Calendar arithmetic on `YYYY-MM-DD` strings, the key all analysis groups by.
 * Done in UTC on purpose: a local-time `Date` skips or repeats an hour across a
 * DST change, and a date that was already a plain calendar day must not move.
 */

const DAY_MS = 86_400_000;

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** The week as the calendar shows it, and as weeks are cut: Monday first. */
export const WEEKDAYS_MONDAY_FIRST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function utcOf(date: IsoDate): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function isoOf(ms: number): IsoDate {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return isoOf(utcOf(date) + days * DAY_MS);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((utcOf(to) - utcOf(from)) / DAY_MS);
}

/** 0 for Monday through 6 for Sunday. */
export function weekdayIndex(date: IsoDate): number {
  return (new Date(utcOf(date)).getUTCDay() + 6) % 7;
}

/** The Monday of the week holding `date`. */
export function weekStart(date: IsoDate): IsoDate {
  return addDays(date, -weekdayIndex(date));
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `date` moved by whole months; a day the target month lacks lands on its last day. */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return dateOf(year, month, Math.min(d, daysInMonth(year, month)));
}

export function dateOf(year: number, month: number, day: number): IsoDate {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** "28 September": a day as the history headings write it. */
export function dayAndMonth(date: IsoDate): string {
  const [, m, d] = date.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1]}`;
}
