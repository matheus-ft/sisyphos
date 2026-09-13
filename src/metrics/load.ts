import { UNILATERAL_TONNAGE_MULTIPLIER } from './definitions';
import {
  isConvertible,
  type Exercise,
  type Load,
  type LoadUnit,
  type PerformedSet,
} from '../model';

const LB_PER_KG = 2.2046226218;

/**
 * Canonical kilograms from whatever unit was entered.
 *
 * Null for `pins`, which is a stack position rather than a mass. There is no
 * conversion to invent, and returning null here is what keeps a pin setting from
 * ever being added into a kilogram total.
 */
export function toKg(value: number, unit: LoadUnit): number | null {
  if (!isConvertible(unit)) return null;
  return unit === 'kg' ? value : value / LB_PER_KG;
}

/** The weight in a load, in kg, or null when it was not measured as a mass. */
export function weightKg(load: Load | null): number | null {
  if (!load || load.kind !== 'weight') return null;
  return toKg(load.value, load.unit);
}

/**
 * Effective load moved by one set, in kg.
 *
 * Null means the set cannot contribute to load-based metrics, and the reasons
 * are distinct: a pin setting is not a mass, and a bodyweight set with no
 * bodyweight on record is missing data rather than zero.
 */
export function effectiveLoadKg(
  set: PerformedSet,
  exercise: Exercise,
  bodyweightKg: number | null,
): number | null {
  if (exercise.load_type === 'none') return null;

  const entered = weightKg(set.load);
  if (entered === null) return null;
  if (exercise.load_type === 'external') return entered;

  // bw_plus: bodyweight carries the load and the entered number adjusts it.
  // Negative means assisted.
  if (bodyweightKg === null) return null;
  return bodyweightKg + entered;
}

/**
 * Tonnage for one set. A unilateral set moved twice what was logged, because it
 * was performed on both sides — there is no second sane answer, so the
 * multiplier is a constant rather than a setting.
 */
export function setTonnageKg(
  set: PerformedSet,
  exercise: Exercise,
  bodyweightKg: number | null,
  unilateralMultiplier = UNILATERAL_TONNAGE_MULTIPLIER,
): number | null {
  const load = effectiveLoadKg(set, exercise, bodyweightKg);
  if (load === null || set.reps === null) return null;
  return load * set.reps * (exercise.unilateral ? unilateralMultiplier : 1);
}
