import { fromKg, toKg } from '../metrics/load';
import {
  type CompetitionLift,
  type Exercise,
  type ExerciseInstance,
  type Id,
  type IsoDate,
  type Interval,
  type LoadPrescription,
  type LoadUnit,
  type OneRmEntry,
  type PerformedSet,
  type PrescribedSet,
  type Session,
} from '../model';
import { lastInstance, measureOf } from './session';

/**
 * The numbers the session screen offers before a set is lifted: plate rounding
 * and stepping, a prescription resolved to a load, and the suggested weight.
 * All pure; none of them is ever saved.
 */

// --- plates -------------------------------------------------------------------------

/** Float noise from `n * step` (1.25 * 3, kg from lb) cleaned to what a plate can be. */
function clean(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/**
 * The nearest multiple of `step`, halves away from zero (assisted loads are
 * negative, and 2.5 should not round differently from -2.5). A step that is not
 * positive leaves the value alone.
 */
export function roundToPlate(value: number, step: number): number {
  if (!Number.isFinite(value) || !(step > 0)) return value;
  const n = Math.round(Math.abs(value) / step + 1e-9);
  return clean(Math.sign(value) * n * step);
}

/**
 * One step up or down, onto the grid of `step`: a load already on the grid moves
 * by a step, one off it (typed 101 on a 2.5 grid) snaps to the next grid load in
 * that direction. Never below `min`, which is zero unless the exercise is
 * bodyweight-plus, where a negative load is assistance.
 */
export function stepLoad(value: number, step: number, direction: 1 | -1, min = 0): number {
  if (!Number.isFinite(value) || !(step > 0)) return value;
  const q = value / step;
  const near = Math.round(q);
  const onGrid = Math.abs(q - near) < 1e-9;
  const n = onGrid ? near + direction : direction > 0 ? Math.ceil(q) : Math.floor(q);
  return Math.max(min, clean(n * step));
}

// --- prescriptions ------------------------------------------------------------------

/**
 * The reference max in force on a date: the latest entry for the lift dated on
 * or before it. A session planned or logged for a date resolves against the max
 * of that date, so raising the max later never rewrites what it asked for. Of
 * two entries on one day the later in the list wins.
 */
export function oneRmInForce(
  entries: OneRmEntry[],
  lift: CompetitionLift,
  date: IsoDate,
): OneRmEntry | null {
  let found: OneRmEntry | null = null;
  for (const e of entries) {
    if (e.lift === lift && e.date <= date && (found === null || e.date >= found.date)) found = e;
  }
  return found;
}

export interface ResolveContext {
  /** The session's date, which picks the reference max. */
  date: IsoDate;
  oneRms: OneRmEntry[];
  /** The unit the set is entered in. */
  unit: LoadUnit;
  /** The plate increment of that unit. */
  step: number;
}

/**
 * What a prescription asks the lifter to load, or why it names no load.
 * `value` pre-fills the set and is the interval's low bound (the one
 * `targetAmount` in template.ts also reads); `high` is the top of a range.
 * `added` marks a bodyweight-plus load, which adds to bodyweight rather than
 * being the whole load.
 */
export type ResolvedLoad =
  | { kind: 'weight'; value: number; high: number | null; unit: 'kg' | 'lb'; added: boolean }
  | { kind: 'time'; seconds: number; high: number | null }
  | {
      kind: 'none';
      /**
       * `rpe_driven` and `open` name no number by design. `no_max` is a
       * percentage with no reference max in force yet. `pins` and `distance`
       * have nothing to convert to.
       */
      why: 'rpe_driven' | 'open' | 'no_max' | 'pins' | 'distance';
    };

/** The ends of an interval, either of which may be open; null when both are. */
function ends(i: Interval): { low: number; high: number | null } | null {
  const [lo, hi] = i;
  if (lo === null && hi === null) return null;
  if (lo === null) return { low: hi as number, high: null };
  return { low: lo, high: hi === null || hi === lo ? null : hi };
}

export function resolveLoad(
  prescription: LoadPrescription | null | undefined,
  ctx: ResolveContext,
): ResolvedLoad {
  if (!prescription) return { kind: 'none', why: 'open' };
  if (prescription.kind === 'distance') return { kind: 'none', why: 'distance' };
  if (prescription.kind === 'time') {
    const e = ends(prescription.seconds);
    return e ? { kind: 'time', seconds: e.low, high: e.high } : { kind: 'none', why: 'open' };
  }

  const w = prescription.weight;
  if (w.mode === 'rpe_driven') return { kind: 'none', why: 'rpe_driven' };
  // A prescription is in kilograms and a pin setting has no kilograms.
  if (ctx.unit === 'pins') return { kind: 'none', why: 'pins' };
  const unit = ctx.unit;

  // The lifter's own kilograms stay as written; only the unit change, which
  // invents digits, and a percentage, which does so by nature, round to plates.
  const show = (kg: number, round: boolean): number => {
    const v = fromKg(kg, unit) as number;
    return round || unit !== 'kg' ? roundToPlate(v, ctx.step) : v;
  };
  const weight = (low: number, high: number | null, round: boolean, added: boolean) =>
    ({
      kind: 'weight',
      value: show(low, round),
      high: high === null ? null : show(high, round),
      unit,
      added,
    }) as const;

  if (w.mode === 'absolute' || w.mode === 'bw_plus') {
    const e = ends(w.mode === 'absolute' ? w.kg : w.added_kg);
    if (!e) return { kind: 'none', why: 'open' };
    return weight(e.low, e.high, false, w.mode === 'bw_plus');
  }

  const e = ends(w.pct);
  if (!e) return { kind: 'none', why: 'open' };
  const max = oneRmInForce(ctx.oneRms, w.lift, ctx.date);
  if (!max) return { kind: 'none', why: 'no_max' };
  return weight(
    max.weight_kg * e.low,
    e.high === null ? null : max.weight_kg * e.high,
    true,
    false,
  );
}

// --- suggested weight ---------------------------------------------------------------

export interface Suggestion {
  load: number;
  unit: 'kg' | 'lb';
  /** Added to last time's weight; zero when it stays the same. */
  delta: number;
  /** "+2.5: last @7.5 for a target of 8", for under the placeholder. */
  reason: string;
}

/** The RPE a prescribed set aims at: the top of a range, which is as hard as the plan allows. */
export function targetRpeOf(prescribed: PrescribedSet | null | undefined): number | null {
  const rpe = prescribed?.rpe;
  if (!rpe) return null;
  return rpe[1] ?? rpe[0];
}

type Lifted = PerformedSet & {
  load: { kind: 'weight'; value: number; unit: 'kg' | 'lb' };
  rpe: number;
};

/** A done working set measured in a mass, the kind a weight can be suggested from. */
function isLoadedWork(set: PerformedSet): set is Lifted {
  return (
    set.state === 'done' &&
    !set.is_warmup &&
    set.load?.kind === 'weight' &&
    set.load.unit !== 'pins' &&
    set.rpe !== null
  );
}

/**
 * Which set of last time stands for this one: the working set at the same
 * position (the third working set now answers to the third then), and the top
 * set when last time had fewer. The top set is the heaviest, the later of equals,
 * since that is the one that went hardest.
 */
export function lastComparable(last: ExerciseInstance, workingIndex: number): PerformedSet | null {
  const sets = last.performed.filter(isLoadedWork);
  if (sets.length === 0) return null;
  if (workingIndex < sets.length) return sets[workingIndex];
  const kg = (s: Lifted) => toKg(s.load.value, s.load.unit) ?? 0;
  return sets.reduce((top, s) => (kg(s) >= kg(top) ? s : top));
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/**
 * The progression rule on its own: from a set done last time and the RPE it
 * should have been, the weight to try. 2 or more under the target adds 5 kg
 * (10 lb), anything from at the target to under 2 below adds 2.5 kg (5 lb), and
 * over it stays. 1.5 under falls in the middle band: the rule names only the
 * ends, and the smaller step is the safer reading.
 *
 * Not rounded to plates: last time's weight was loaded, so adding a fixed step
 * to it is loadable on the plates that loaded it.
 */
export function progress(last: PerformedSet, targetRpe: number | null): Suggestion | null {
  if (!isLoadedWork(last)) return null;
  const { load, rpe: lastRpe } = last;
  const target = targetRpe ?? lastRpe;
  const under = target - lastRpe;
  const [big, small] = load.unit === 'kg' ? [5, 2.5] : [10, 5];
  const delta = under >= 2 ? big : under >= 0 ? small : 0;
  const lead = delta > 0 ? `+${fmt(delta)}` : 'same';
  const why =
    targetRpe === null
      ? `last @${fmt(lastRpe)}, no target`
      : `last @${fmt(lastRpe)} for a target of ${fmt(target)}`;
  return { load: clean(load.value + delta), unit: load.unit, delta, reason: `${lead}: ${why}` };
}

/**
 * The suggested weight for `set`, an empty one of `instance`, from the last
 * other session that did this exercise. Null when there is nothing to go on, and
 * never for timed sets, pin settings (on either side) or warm-ups, whose
 * numbers follow from the working weight instead.
 */
export function suggestLoad(input: {
  exercise: Exercise;
  instance: ExerciseInstance;
  set: PerformedSet;
  sessions: Session[];
  /** The session being logged, which is not "last time". */
  except: Id;
  /** The unit the set is entered in now, if it has one. */
  unit?: LoadUnit | null;
}): Suggestion | null {
  const { exercise, instance, set } = input;
  if (measureOf(exercise) === 'time' || set.is_warmup || input.unit === 'pins') return null;
  const workingIndex = instance.performed
    .filter((s) => !s.is_warmup)
    .findIndex((s) => s.id === set.id);
  if (workingIndex < 0) return null;
  const last = lastInstance(exercise.id, input.sessions, input.except);
  if (!last) return null;
  const comparable = lastComparable(last, workingIndex);
  if (!comparable) return null;
  const prescribed = instance.prescribed.find((p) => p.id === set.prescribed_id);
  return progress(comparable, targetRpeOf(prescribed));
}
