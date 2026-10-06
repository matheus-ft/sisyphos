import type { IsoDate, ProgramLabel, Session } from '../model';

/**
 * Dates and durations as the screens write them (the design's Copy): "Sunday
 * 4 October", "4 Oct", "THU", "52 min". In British English whatever the
 * phone's locale, since the copy around them is.
 */

const LOCALE = 'en-GB';

/** Noon, so no time zone moves an ISO date to the day before or after. */
function noon(date: IsoDate): Date {
  return new Date(`${date}T12:00:00`);
}

/** "Sunday 4 October". */
export function longDate(date: IsoDate): string {
  return noon(date).toLocaleDateString(LOCALE, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

/** "4 Oct". */
export function shortDate(date: IsoDate): string {
  return noon(date).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short' });
}

/** "Sunday". */
export function weekday(date: IsoDate): string {
  return noon(date).toLocaleDateString(LOCALE, { weekday: 'long' });
}

/** "SUN", for the day block of a row. */
export function weekdayShort(date: IsoDate): string {
  return noon(date).toLocaleDateString(LOCALE, { weekday: 'short' }).toUpperCase();
}

/** The day of the month, for the day block of a row. */
export function dayOfMonth(date: IsoDate): number {
  return noon(date).getDate();
}

/** The Monday on or before `date`: the key of its week. */
export function weekOf(date: IsoDate): IsoDate {
  const d = noon(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "28 September", for "Week of 28 September". */
export function dayAndMonth(date: IsoDate): string {
  return noon(date).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long' });
}

/**
 * Whole minutes a session ran, or runs until `now`; null for one planned, or
 * logged after the fact, whose clock time says nothing.
 */
export function sessionMinutes(session: Session, now: number = Date.now()): number | null {
  if (session.started_at === null || session.time_precision === 'date_only') return null;
  const end = session.ended_at ? Date.parse(session.ended_at) : now;
  return Math.max(0, Math.floor((end - Date.parse(session.started_at)) / 60_000));
}

/** "52 min", "1 h 5 min". */
export function formatMinutes(minutes: number): string {
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Done working sets: what "15 sets" counts. Warm-ups are not the work. */
export function workingSets(session: Session): number {
  return session.exercises.reduce(
    (n, e) => n + e.performed.filter((s) => s.state === 'done' && !s.is_warmup).length,
    0,
  );
}

/** "Rebuild · block 2 · week 3 · day 1 · Sun", dropping what is empty; null when all is. */
export function programLabel(label: ProgramLabel): string | null {
  const day = label.weekday?.trim();
  const parts = [
    label.name,
    label.block !== null ? `block ${label.block}` : null,
    label.week !== null ? `week ${label.week}` : null,
    label.day !== null ? `day ${label.day}` : null,
    day ? day.charAt(0).toUpperCase() + day.slice(1, 3).toLowerCase() : null,
  ].filter((p): p is string => p !== null && p !== '');
  return parts.length ? parts.join(' · ') : null;
}
