import type { ExerciseInstance, LoadUnit, PerformedSet } from '../model';
import { amountOf } from './session';

/**
 * What the entry panel starts from for a set, field by field: the set's own
 * numbers, else what its prescription asks for, else the set before it. Never
 * the RPE, which is what the set turns out to feel like.
 *
 * The brief's full order also puts a percentage target (resolved against the
 * reference max) and the suggested weight before the previous set; those come
 * with the modules that compute them.
 */
export interface Prefill {
  /** kg, lb or pins; seconds for timed work. */
  amount: number | null;
  reps: number | null;
}

export function entryPrefill(instance: ExerciseInstance, set: PerformedSet): Prefill {
  const target = prescribedFor(instance, set);
  const index = instance.performed.findIndex((s) => s.id === set.id);
  const before = instance.performed
    .slice(0, Math.max(index, 0))
    .reverse()
    .find((s) => amountOf(s) !== null || s.reps !== null);
  return {
    amount: amountOf(set) ?? target.amount ?? (before ? amountOf(before) : null),
    reps: set.reps ?? target.reps ?? before?.reps ?? null,
  };
}

/** The low end of what the set's prescription asks for, where it names a number. */
function prescribedFor(instance: ExerciseInstance, set: PerformedSet): Prefill {
  const p = instance.prescribed.find((x) => x.id === set.prescribed_id);
  if (!p) return { amount: null, reps: null };
  let amount: number | null = null;
  if (p.load.kind === 'time') amount = p.load.seconds[0];
  else if (p.load.kind === 'distance') amount = p.load.meters[0];
  else if (p.load.weight.mode === 'absolute') amount = p.load.weight.kg[0];
  else if (p.load.weight.mode === 'bw_plus') amount = p.load.weight.added_kg[0];
  return { amount, reps: p.reps?.[0] ?? null };
}

/**
 * How far − and + step the load: the smallest pair of plates usually at hand.
 * Settings will make it the lifter's choice (kg 1.25 / 2.5 / 5, lb 2.5 / 5 / 10).
 */
export function plateStep(unit: LoadUnit): number {
  if (unit === 'lb') return 5;
  if (unit === 'pins') return 1;
  return 2.5;
}
