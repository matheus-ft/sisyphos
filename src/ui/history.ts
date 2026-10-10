import type { Exercise, Id, IsoDate, PerformedSet, Session } from '../model';
import {
  addDays,
  dateOf,
  dayAndMonth,
  daysInMonth,
  MONTH_NAMES,
  weekStart,
} from '../metrics/dates';
import { setE1rm } from '../metrics/e1rm';
import { compareSessions } from '../metrics/flatten';
import { weightKg } from '../metrics/load';
import { amountOf, formatSet } from './session';

/**
 * What the History screen shows, as pure functions over the sessions: the list
 * by week, with its filter by exercise, and the month calendar.
 */

// --- the list ---------------------------------------------------------------------

export interface BestSet {
  set: PerformedSet;
  /** `formatSet`'s text for it, e.g. "140 × 5 @ 8". */
  text: string;
  /** Null for a set the chart and Epley cannot price: pins, timed work, high reps. */
  e1rm: number | null;
}

export interface HistoryRow {
  session: Session;
  /** Filled in ahead and not started. */
  planned: boolean;
  /** Sets still waiting for numbers; the row is marked when above zero. */
  pendingSets: number;
  /** With a filter on: that exercise's best set that day, else null. */
  best: BestSet | null;
}

export interface WeekCounts {
  sessions: number;
  planned: number;
  /** Done working sets, of the filtered exercise when there is a filter. */
  sets: number;
  /** Sessions holding at least one pending set. */
  pending: number;
}

export interface HistoryWeek {
  /** The Monday. */
  start: IsoDate;
  /** "Week of 28 September". */
  label: string;
  rows: HistoryRow[];
  counts: WeekCounts;
}

function doneWorking(session: Session, exerciseId?: string): PerformedSet[] {
  return session.exercises
    .filter((e) => exerciseId === undefined || e.exercise_id === exerciseId)
    .flatMap((e) => e.performed.filter((s) => s.state === 'done' && !s.is_warmup));
}

/**
 * The best of a session's done working sets of one exercise: the highest e1RM,
 * and where no set has one, the heaviest (or longest), then the most reps. A
 * set with an e1RM outranks one without, since a set the estimate can price is
 * a measured effort and the other is not.
 */
export function bestSetOf(
  session: Session,
  exercise: Exercise,
  bodyweightAt?: (date: IsoDate) => number | null,
): BestSet | null {
  // A bodyweight-plus set needs the lifter's weight: the session's, else the weigh-in then.
  const bodyweight = session.bodyweight_kg ?? bodyweightAt?.(session.date) ?? null;
  let best: { set: PerformedSet; e1rm: number | null } | null = null;
  const amount = (s: PerformedSet) => weightKg(s.load) ?? amountOf(s) ?? 0;
  const beats = (a: PerformedSet, ae: number | null, b: PerformedSet, be: number | null) => {
    if (ae !== null && be !== null) return ae > be;
    if (ae !== null || be !== null) return ae !== null;
    return amount(a) > amount(b) || (amount(a) === amount(b) && (a.reps ?? 0) > (b.reps ?? 0));
  };
  for (const set of doneWorking(session, exercise.id)) {
    const e1rm = setE1rm(set, exercise, bodyweight);
    if (!best || beats(set, e1rm, best.set, best.e1rm)) best = { set, e1rm };
  }
  return best && { ...best, text: formatSet(best.set, exercise) };
}

const pendingOf = (session: Session): number =>
  session.exercises.reduce(
    (n, e) => n + e.performed.filter((s) => s.state === 'pending').length,
    0,
  );

/**
 * Sessions grouped by week, newest first, both weeks and the sessions in them.
 * With `exerciseId`, only sessions holding that exercise are listed, and each
 * row carries that exercise's best set.
 */
export function historyWeeks(
  sessions: readonly Session[],
  library: readonly Exercise[],
  filter: { exerciseId?: string; bodyweightAt?: (date: IsoDate) => number | null } = {},
): HistoryWeek[] {
  const exercise = filter.exerciseId
    ? (library.find((e) => e.id === filter.exerciseId) ?? null)
    : null;
  const weeks = new Map<IsoDate, HistoryRow[]>();

  for (const session of [...sessions].sort(compareSessions).reverse()) {
    if (filter.exerciseId && !session.exercises.some((e) => e.exercise_id === filter.exerciseId))
      continue;
    const row: HistoryRow = {
      session,
      planned: session.started_at === null && session.ended_at === null,
      pendingSets: pendingOf(session),
      best: exercise ? bestSetOf(session, exercise, filter.bodyweightAt) : null,
    };
    const start = weekStart(session.date);
    weeks.set(start, [...(weeks.get(start) ?? []), row]);
  }

  return [...weeks.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([start, rows]) => ({
      start,
      label: `Week of ${dayAndMonth(start)}`,
      rows,
      counts: {
        sessions: rows.length,
        planned: rows.filter((r) => r.planned).length,
        sets: rows.reduce((n, r) => n + doneWorking(r.session, filter.exerciseId).length, 0),
        pending: rows.filter((r) => r.pendingSets > 0).length,
      },
    }));
}

// --- the calendar -----------------------------------------------------------------

export interface CalendarDay {
  date: IsoDate;
  /** Day of the month, 1 to 31. */
  day: number;
  /** False for the leading and trailing days that fill the first and last week. */
  inMonth: boolean;
  /** Sessions that happened, for the disc. */
  sessions: Id[];
  /** Sessions planned and not started, for the dashed ring. */
  planned: Id[];
  /** A record was set (`recordDays`), for the dot. */
  record: boolean;
  today: boolean;
}

export interface CalendarMonth {
  year: number;
  /** 1 to 12. */
  month: number;
  /** "October 2026". */
  title: string;
  /** Whole weeks, Monday first, each of seven days. */
  weeks: CalendarDay[][];
}

export function monthGrid(
  year: number,
  month: number,
  sessions: readonly Session[],
  options: { today: IsoDate; recordDays?: ReadonlySet<IsoDate> },
): CalendarMonth {
  const happened = new Map<IsoDate, Id[]>();
  const planned = new Map<IsoDate, Id[]>();
  for (const session of [...sessions].sort(compareSessions)) {
    const isPlanned = session.started_at === null && session.ended_at === null;
    const into = isPlanned ? planned : happened;
    into.set(session.date, [...(into.get(session.date) ?? []), session.id]);
  }

  const first = dateOf(year, month, 1);
  const last = dateOf(year, month, daysInMonth(year, month));
  const weeks: CalendarDay[][] = [];
  for (let start = weekStart(first); start <= last; start = addDays(start, 7)) {
    weeks.push(
      Array.from({ length: 7 }, (_, i): CalendarDay => {
        const date = addDays(start, i);
        return {
          date,
          day: Number(date.slice(8)),
          inMonth: date >= first && date <= last,
          sessions: happened.get(date) ?? [],
          planned: planned.get(date) ?? [],
          record: options.recordDays?.has(date) ?? false,
          today: date === options.today,
        };
      }),
    );
  }
  return { year, month, title: `${MONTH_NAMES[month - 1]} ${year}`, weeks };
}

/** The month `by` months from this one, across year ends. */
export function shiftMonth(
  at: { year: number; month: number },
  by: number,
): { year: number; month: number } {
  const index = at.year * 12 + (at.month - 1) + by;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** The month a date falls in. */
export function monthOf(date: IsoDate): { year: number; month: number } {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

/** The weekday heads over a month grid, Monday first. */
export const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

/** A range of days that may be picked; an end left out is open. */
export interface DayRange {
  min?: IsoDate;
  max?: IsoDate;
}

/** Whether a day lies within the range, ends included. */
export function inRange(date: IsoDate, range: DayRange): boolean {
  return (
    (range.min === undefined || date >= range.min) && (range.max === undefined || date <= range.max)
  );
}

/** Whether the month `by` months from `at` holds a day in the range, so that a picker can stop at its edge. */
export function canShiftMonth(
  at: { year: number; month: number },
  by: number,
  range: DayRange,
): boolean {
  const next = shiftMonth(at, by);
  const first = dateOf(next.year, next.month, 1);
  const last = dateOf(next.year, next.month, daysInMonth(next.year, next.month));
  return (
    (range.min === undefined || last >= range.min) &&
    (range.max === undefined || first <= range.max)
  );
}
