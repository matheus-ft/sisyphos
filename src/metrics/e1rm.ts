import type { CompetitionLift, Exercise, Id, IsoDate, PerformedSet, Session } from '../model';
import { addDays, addMonths } from './dates';
import { flattenSets } from './flatten';
import { effectiveLoadKg } from './load';
import { e1rm as chartE1rm } from './rpe-chart';

/**
 * Estimated one-rep max of a set, and what the progress screens draw from it.
 * Computed where shown and never saved: a stored estimate would outlive the
 * chart that produced it.
 */

/**
 * Epley is only trusted this far. Past 12 reps the formula still returns a
 * number, and it looks as real as one the chart would give, which is exactly why
 * it is withheld (the RPE chart's own ceiling is the same 12).
 */
export const EPLEY_MAX_REPS = 12;

export function epley(weightKg: number, reps: number): number {
  return weightKg * (1 + reps / 30);
}

/**
 * The e1RM of one set, in kg, or null when the set cannot speak to one: not
 * done, a warm-up (ramp-up weights say nothing about a max), a timed set, a pin
 * setting, or more reps than either method covers.
 *
 * The chart wins when the set has an RPE it covers, since it prices effort;
 * otherwise Epley, which assumes the set was taken to failure and so reads low
 * for a set that was not.
 */
export function setE1rm(
  set: PerformedSet,
  exercise: Exercise,
  bodyweightKg: number | null,
): number | null {
  if (set.state !== 'done' || set.is_warmup) return null;
  if (set.reps === null || set.reps < 1) return null;

  // Effective load is null for pins, timed work and a bodyweight lift with no bodyweight.
  const load = effectiveLoadKg(set, exercise, bodyweightKg);
  if (load === null || load <= 0) return null;

  if (set.rpe !== null) {
    const fromChart = chartE1rm(load, set.rpe, set.reps);
    if (fromChart !== null) return fromChart;
  }
  return set.reps <= EPLEY_MAX_REPS ? epley(load, set.reps) : null;
}

export interface E1rmPoint {
  date: IsoDate;
  e1rm: number;
  session_id: Id;
  exercise_instance_id: Id;
  set_id: Id;
  /** The best e1RM this exercise has had on any earlier day. */
  record: boolean;
}

export interface E1rmOptions {
  /** Inclusive bounds on the dates returned; the record flag still reads the whole history. */
  from?: IsoDate | null;
  to?: IsoDate | null;
  /** A bodyweight for a session that did not record one, for bodyweight-plus lifts. */
  bodyweightAt?: (date: IsoDate) => number | null;
}

function bodyweightOf(session: Session, options: E1rmOptions): number | null {
  return session.bodyweight_kg ?? options.bodyweightAt?.(session.date) ?? null;
}

/**
 * The best e1RM of an exercise on each day it was trained, oldest first.
 *
 * A record day is one whose best beats every earlier day's, judged over the
 * whole history so that narrowing the range never turns the first visible point
 * into a record. The first day an exercise was ever trained is not one: it has
 * nothing to beat, and gilding it would mark every lift's debut.
 */
export function e1rmSeries(
  sessions: readonly Session[],
  exercise: Exercise,
  options: E1rmOptions = {},
): E1rmPoint[] {
  const best = new Map<IsoDate, Omit<E1rmPoint, 'record'>>();
  // Handing flattenSets only this exercise leaves out every other one.
  for (const { session, instance, set } of flattenSets(sessions, [exercise])) {
    const value = setE1rm(set, exercise, bodyweightOf(session, options));
    if (value === null) continue;
    const held = best.get(session.date);
    if (!held || value > held.e1rm) {
      best.set(session.date, {
        date: session.date,
        e1rm: value,
        session_id: session.id,
        exercise_instance_id: instance.id,
        set_id: set.id,
      });
    }
  }

  const days = [...best.values()].sort((a, b) => a.date.localeCompare(b.date));
  let highest = -Infinity;
  const points = days.map((day, i): E1rmPoint => {
    const record = i > 0 && day.e1rm > highest;
    highest = Math.max(highest, day.e1rm);
    return { ...day, record };
  });
  return points.filter(
    (p) => (!options.from || p.date >= options.from) && (!options.to || p.date <= options.to),
  );
}

/** The ranges the Strength screen offers. */
export type StrengthRange = '3M' | '6M' | '1Y' | 'all';

/** The first date a range shows, counting back from `today`; null for all of it. */
export function rangeStart(range: StrengthRange, today: IsoDate): IsoDate | null {
  if (range === 'all') return null;
  return addMonths(today, range === '3M' ? -3 : range === '6M' ? -6 : -12);
}

export interface RecentBest {
  e1rm: number;
  date: IsoDate;
  exercise_id: string;
  session_id: Id;
  set_id: Id;
}

/** How far back a reference max is suggested from. */
export const RECENT_WEEKS = 8;

/**
 * The best e1RM of a competition lift over the last `weeks` weeks ending
 * `today`, offered beside the reference max as a suggestion and never written
 * by itself. Only comp-tier exercises of the event count: a paused or
 * close-grip variation is trained lighter, and would suggest a max the
 * competition lift cannot match. Sumo and conventional deadlifts both compete
 * as the deadlift, so either may supply it.
 */
export function bestRecentE1rm(
  sessions: readonly Session[],
  library: readonly Exercise[],
  lift: CompetitionLift,
  today: IsoDate,
  options: { weeks?: number; bodyweightAt?: (date: IsoDate) => number | null } = {},
): RecentBest | null {
  const from = addDays(today, -((options.weeks ?? RECENT_WEEKS) * 7 - 1));
  const comp = library.filter((e) => e.base_lift === lift && e.tier === 'comp');
  let best: RecentBest | null = null;
  for (const exercise of comp) {
    for (const point of e1rmSeries(sessions, exercise, {
      from,
      to: today,
      bodyweightAt: options.bodyweightAt,
    })) {
      if (!best || point.e1rm > best.e1rm) {
        best = {
          e1rm: point.e1rm,
          date: point.date,
          exercise_id: exercise.id,
          session_id: point.session_id,
          set_id: point.set_id,
        };
      }
    }
  }
  return best;
}
