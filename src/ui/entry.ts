import { fromKg, toKg } from '../metrics/load';
import type {
  Exercise,
  ExerciseInstance,
  IsoDate,
  LoadUnit,
  OneRmEntry,
  PerformedSet,
  Session,
} from '../model';
import { plateStep, type Prefs } from './prefs';
import { amountOf, formatSeconds, targetsOf, unitFor, unitOf } from './session';
import { resolveLoad, roundToPlate, stepLoad, suggestLoad, type Suggestion } from './suggest';

/**
 * What the screen offers for a set before it is lifted: the figures the entry
 * panel starts from, and the faint ones in an empty row. The brief's order is
 * the set's own numbers, then what its prescription asks (a percentage resolved
 * against the reference max of the session's date), then the suggested weight,
 * then the set before it. RPE is never offered: it is what the set felt like.
 */

export interface Prefill {
  /** kg, lb or pins; seconds for timed work. */
  amount: number | null;
  reps: number | null;
}

/** What resolving a set's numbers needs to know about the lifter and the day. */
export interface EntryContext {
  date: IsoDate;
  oneRms: OneRmEntry[];
  /** The unit the set is entered in. */
  unit: LoadUnit;
  /** The plate increment of that unit. */
  step: number;
  /** The suggested weight for this set, null where there is none (timed, pins, no history). */
  suggestion: Suggestion | null;
}

/**
 * The context for one set: its unit (its own, else today's, else the one this
 * exercise was last logged in: `unitFor`), that unit's plate step from the
 * lifter's settings, and the suggested weight from last time, in that unit.
 */
export function entryContext(input: {
  session: Session;
  instance: ExerciseInstance;
  set: PerformedSet;
  exercise: Exercise | undefined;
  sessions: Session[];
  oneRms: OneRmEntry[];
  prefs: Prefs;
  /** The unit the lifter picked for this exercise in this session. */
  chosen?: LoadUnit | null;
  /** The unit the entry panel was just switched to, over even the set's own. */
  unit?: LoadUnit | null;
}): EntryContext {
  const { session, instance, set, exercise } = input;
  const unit = input.unit ?? unitFor(input);
  const step = plateStep(input.prefs, unit);
  const suggestion = exercise
    ? suggestLoad({
        exercise,
        instance,
        set,
        sessions: input.sessions,
        except: session.id,
        unit,
      })
    : null;
  return {
    date: session.date,
    oneRms: input.oneRms,
    unit,
    step,
    suggestion: suggestion && suggestionIn(suggestion, unit, step),
  };
}

/**
 * A load as it reads in another unit, on that unit's plates. Kilograms and
 * pounds convert; a pin setting is no mass, so nothing converts to or from it.
 */
export function convertLoad(
  value: number,
  from: LoadUnit,
  to: LoadUnit,
  step: number,
): number | null {
  if (from === to) return value;
  const kg = toKg(value, from);
  const v = kg === null ? null : fromKg(kg, to);
  return v === null ? null : roundToPlate(v, step);
}

/**
 * The suggestion in the unit the set is entered in. It is reckoned from last
 * time, in last time's unit, which a lifter who switched units today no longer
 * uses: the weight is converted, and the reason names the unit its step was in.
 */
function suggestionIn(s: Suggestion, unit: LoadUnit, step: number): Suggestion | null {
  if (s.unit === unit) return s;
  const load = convertLoad(s.load, s.unit, unit, step);
  if (load === null || unit === 'pins') return null;
  // Not on the plates: the step is only said, never loaded.
  const delta = convertLoad(s.delta, s.unit, unit, 0.01) ?? 0;
  return { load, unit, delta, reason: s.reason.replace(/^\+([\d.]+)/, `+$1 ${s.unit}`) };
}

/** A set's number in the unit being entered: a load in another unit converted, a pin setting dropped. */
function amountIn(set: PerformedSet, ctx: EntryContext): number | null {
  const amount = amountOf(set);
  const unit = unitOf(set);
  return amount === null || unit === null ? amount : convertLoad(amount, unit, ctx.unit, ctx.step);
}

/** What the set's prescription asks to load, resolved to a number; null where it names none. */
export function targetAmount(
  instance: ExerciseInstance,
  set: PerformedSet,
  ctx: EntryContext,
): number | null {
  const p = instance.prescribed.find((x) => x.id === set.prescribed_id);
  const resolved = resolveLoad(p?.load, ctx);
  if (resolved.kind === 'weight') return resolved.value;
  if (resolved.kind === 'time') return resolved.seconds;
  return null;
}

export function entryPrefill(
  instance: ExerciseInstance,
  set: PerformedSet,
  ctx: EntryContext,
): Prefill {
  const p = instance.prescribed.find((x) => x.id === set.prescribed_id);
  const index = instance.performed.findIndex((s) => s.id === set.id);
  const before = instance.performed
    .slice(0, Math.max(index, 0))
    .reverse()
    .find((s) => amountOf(s) !== null || s.reps !== null);
  return {
    amount:
      amountIn(set, ctx) ??
      targetAmount(instance, set, ctx) ??
      ctx.suggestion?.load ??
      (before ? amountIn(before, ctx) : null),
    reps: set.reps ?? p?.reps?.[0] ?? before?.reps ?? null,
  };
}

/**
 * One tap of − or +. Weights move by the plate step, snapping onto its grid;
 * time moves by 5 s up to a minute and by 15 s beyond it, so a plank is not
 * tapped thirty times to reach a minute and a half.
 */
export function stepAmount(
  value: number,
  direction: 1 | -1,
  input: { measure: 'weight' | 'time'; step: number; min?: number },
): number {
  if (input.measure === 'weight') return stepLoad(value, input.step, direction, input.min ?? 0);
  const by = direction > 0 ? (value < 60 ? 5 : 15) : value > 60 ? 15 : 5;
  const next = value + direction * by;
  // Off the 5 s grid (typed 47), a step lands on it rather than carrying the offset on.
  const snapped = direction > 0 ? Math.ceil(next / 5) * 5 : Math.floor(next / 5) * 5;
  return Math.max(0, value % 5 === 0 ? next : snapped);
}

/**
 * The faint figures of an empty row, as the fields show them: the resolved
 * load or time, else the suggested weight, with the prescription's reps and RPE
 * as written (a range stays a range).
 */
export function rowTargets(
  instance: ExerciseInstance,
  set: PerformedSet,
  ctx: EntryContext,
  timed: boolean,
): { amount: string; reps: string; rpe: string } {
  const written = targetsOf(instance, set);
  const amount = targetAmount(instance, set, ctx) ?? ctx.suggestion?.load ?? null;
  return {
    amount: amount === null ? '' : timed ? formatSeconds(amount).replace(' s', '') : String(amount),
    reps: written.reps,
    rpe: written.rpe,
  };
}
