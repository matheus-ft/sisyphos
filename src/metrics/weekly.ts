import type { Exercise, Id, IsoDate, Muscle, PerformedSet, Session } from '../model';
import { addDays, weekStart } from './dates';
import { muscleWeights, type MuscleWeights } from './definitions';
import { flattenSets } from './flatten';
import { volumeByMuscle, type CountedSet } from './volume';

/**
 * Weekly volume per muscle, for the body on the Progress screen.
 *
 * Weeks start on Monday, in the lifter's own calendar: a session's `date` is
 * already that, so nothing here touches a time zone.
 */

/** What the body can show: the week so far, or the last four weeks. */
export type VolumeWindow = 'this_week' | 'last_4_weeks';

const WEEKS: Record<VolumeWindow, number> = { this_week: 1, last_4_weeks: 4 };

/**
 * The dates a window covers, inclusive.
 *
 * "This week" is Monday to Sunday of the week holding `today`. "Last 4 weeks" is
 * the 28 days ending today rather than four Monday-weeks, because the latter
 * would hold barely three weeks of training on a Tuesday and shade the body as
 * if the lifter had been idle.
 */
export function windowBounds(window: VolumeWindow, today: IsoDate): { from: IsoDate; to: IsoDate } {
  if (window === 'this_week') {
    const from = weekStart(today);
    return { from, to: addDays(from, 6) };
  }
  return { from: addDays(today, -27), to: today };
}

/** 0 is untrained; 4 is the heaviest shade. */
export type ShadeLevel = 0 | 1 | 2 | 3 | 4;

/** Weekly weighted sets at which each shade begins: 1-4 sets is level 1, 5-9 level 2, and so on. */
const SHADE_FROM = [5, 10, 15] as const;

/**
 * The shade for a muscle's weighted sets. Anything above zero is at least level
 * 1, so a muscle that was trained never looks untouched; half-sets from aux
 * counting can land between thresholds (4.5 is level 1, not 2).
 *
 * Over four weeks the total is divided by four first, so a shade means the same
 * weekly dose in both windows: 20 sets across four weeks is 5 a week, level 2.
 */
export function shadeLevel(weightedSets: number, weeks = 1): ShadeLevel {
  const perWeek = weightedSets / weeks;
  if (perWeek <= 0) return 0;
  if (perWeek < SHADE_FROM[0]) return 1;
  if (perWeek < SHADE_FROM[1]) return 2;
  if (perWeek < SHADE_FROM[2]) return 3;
  return 4;
}

function setsInWindow(
  sessions: readonly Session[],
  library: readonly Exercise[],
  window: VolumeWindow,
  today: IsoDate,
) {
  const { from, to } = windowBounds(window, today);
  return flattenSets(
    sessions.filter((s) => s.date >= from && s.date <= to),
    library,
  );
}

export interface MuscleVolume {
  muscle: Muscle;
  /** Weighted sets under the active preset: an aux muscle's set counts as its weight, not as one. */
  sets: number;
  level: ShadeLevel;
}

/**
 * Every muscle with its weighted sets in the window, most worked first. Muscles
 * with none are listed too (level 0): the figure needs to paint them as rested.
 * Ties keep the order of `muscles`, so the list does not shuffle between renders.
 */
export function weeklyVolume(
  sessions: readonly Session[],
  library: readonly Exercise[],
  muscles: readonly Muscle[],
  window: VolumeWindow,
  today: IsoDate,
  weights: MuscleWeights = muscleWeights(),
): MuscleVolume[] {
  const counted: CountedSet[] = setsInWindow(sessions, library, window, today).map(
    ({ set, exercise }) => ({ set, exercise }),
  );
  const totals = volumeByMuscle(counted, weights);
  return muscles
    .map((muscle) => {
      const sets = totals.get(muscle.id) ?? 0;
      return { muscle, sets, level: shadeLevel(sets, WEEKS[window]) };
    })
    .sort((a, b) => b.sets - a.sets);
}

export interface MuscleSet {
  date: IsoDate;
  session_id: Id;
  exercise_id: string;
  exercise_instance_id: Id;
  set: PerformedSet;
  /** What the set added to the muscle's total: 1, or the aux weight. */
  counted: number;
}

/**
 * The sets behind one muscle's number, newest first, for the detail that opens
 * when the muscle is tapped. They add up to that muscle's `sets` in
 * `weeklyVolume`: each set is asked what it contributes through the same
 * `volumeByMuscle`, so the warm-up and unilateral rules cannot drift apart.
 */
export function setsBehindMuscle(
  sessions: readonly Session[],
  library: readonly Exercise[],
  muscleId: string,
  window: VolumeWindow,
  today: IsoDate,
  weights: MuscleWeights = muscleWeights(),
): MuscleSet[] {
  const out: MuscleSet[] = [];
  for (const { session, instance, set, exercise } of setsInWindow(
    sessions,
    library,
    window,
    today,
  )) {
    const counted = volumeByMuscle([{ set, exercise }], weights).get(muscleId) ?? 0;
    if (counted > 0) {
      out.push({
        date: session.date,
        session_id: session.id,
        exercise_id: exercise.id,
        exercise_instance_id: instance.id,
        set,
        counted,
      });
    }
  }
  // Days newest first; the sort is stable, so within a day the sets stay in the order lifted.
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
