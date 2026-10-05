import { toKg } from '../metrics/load';
import type { Id, PerformedSet, Session } from '../model';
import { roundToPlate } from './suggest';
import type { NewId } from './session';

/**
 * The warm-up ladder suggested toward an exercise's first working weight. The
 * lifter adds all of it, one rung, or hides it; nothing here is saved until they
 * do, and a logged warm-up never counts for RPE, volume or records.
 */

/** The empty bar, which is where a ladder starts and below which there is none. */
export const BAR = { kg: 20, lb: 45 } as const;

/** Reps for the bar and for 40, 60 and 80% of the working weight: falling as the weight rises. */
const BAR_REPS = 8;
const RUNGS: ReadonlyArray<{ fraction: number; reps: number }> = [
  { fraction: 0.4, reps: 5 },
  { fraction: 0.6, reps: 3 },
  { fraction: 0.8, reps: 2 },
];

export interface WarmupRung {
  load: number;
  reps: number;
}

/**
 * The rungs toward `working`, lightest first, in `unit`. Each percentage is
 * rounded to the plates, and a rung is dropped when that lands on the bar or on
 * the rung before it, so a light weight gets a short ladder (40 kg is the bar,
 * 25 and 32.5) and one at or below the bar gets none: there is nothing lighter
 * to warm up with. External loads only; bodyweight and timed work warm up in
 * their own way, which the screen leaves alone.
 */
export function warmupLadder(working: number, unit: 'kg' | 'lb', step: number): WarmupRung[] {
  const bar = BAR[unit];
  if (!(working > bar)) return [];
  const rungs: WarmupRung[] = [{ load: bar, reps: BAR_REPS }];
  for (const { fraction, reps } of RUNGS) {
    const load = roundToPlate(working * fraction, step);
    if (load > rungs[rungs.length - 1].load && load < working) rungs.push({ load, reps });
  }
  return rungs;
}

/**
 * The ladder as sets the screen can add: warm-ups with their numbers filled and
 * still pending, which Done completes (a set is done by `editSet`, never by
 * being born with its numbers).
 */
export function warmupSets(
  working: number,
  unit: 'kg' | 'lb',
  step: number,
  newId: NewId,
): PerformedSet[] {
  return warmupLadder(working, unit, step).map((rung) => ({
    id: newId(),
    prescribed_id: null,
    state: 'pending',
    reps: rung.reps,
    rpe: null,
    load: { kind: 'weight', value: rung.load, unit },
    is_warmup: true,
    notes: null,
  }));
}

/**
 * Puts warm-ups into an exercise ahead of its first working set: a fresh
 * exercise holds one blank working set, and the ladder belongs before it. Rungs
 * come in one at a time as often as all at once, so each goes in by its load,
 * ahead of the first pending warm-up heavier than it, and the warm-ups still to
 * do climb from light to heavy whatever order they were added in. Those already
 * done stay where they are: they are behind the lifter.
 */
export function insertWarmups(session: Session, instanceId: Id, sets: PerformedSet[]): Session {
  return {
    ...session,
    exercises: session.exercises.map((e) =>
      e.id === instanceId ? { ...e, performed: sets.reduce(placeWarmup, e.performed) } : e,
    ),
  };
}

function placeWarmup(performed: PerformedSet[], set: PerformedSet): PerformedSet[] {
  const firstWorking = performed.findIndex((s) => !s.is_warmup);
  const end = firstWorking < 0 ? performed.length : firstWorking;
  const kg = kgOf(set);
  const heavier =
    kg === null
      ? -1
      : performed
          .slice(0, end)
          .findIndex((s) => s.state === 'pending' && (kgOf(s) ?? -Infinity) > kg);
  const at = heavier < 0 ? end : heavier;
  return [...performed.slice(0, at), set, ...performed.slice(at)];
}

/** A pin setting or a blank set has no weight to order by. */
function kgOf(set: PerformedSet): number | null {
  return set.load?.kind === 'weight' ? toKg(set.load.value, set.load.unit) : null;
}
