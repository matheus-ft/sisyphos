import raw from './definitions.json';
import type { MuscleRole, Tier } from '../model';

/**
 * Typed view over config/metrics.json.
 *
 * Every setting here is read at call time, so if it exists in the JSON it
 * changes behaviour. Three kinds of thing were deliberately kept out:
 *
 *   derivable   the highest rep count e1RM can speak to is a property of the
 *               chart, not a preference — see MAX_CHART_REPS
 *   settled     one set per side is two sides' worth of tonnage and one set.
 *               There is no second sane answer, so it is a constant below
 *   already determined  a set's state says whether it counts. Restating that as
 *               a null policy would let the two disagree
 */

export type MuscleWeights = Record<MuscleRole, number>;
export type TierWeights = Record<Tier, number>;

/** Metrics that can be asked to include ramp-up sets. */
export type WarmupScope = 'volume' | 'tonnage' | 'stress' | 'records';

/**
 * One logged set of a unilateral exercise is one set, performed twice — so it
 * moved twice the tonnage and it is still one set. Not configurable because
 * there is no defensible alternative.
 */
export const UNILATERAL_TONNAGE_MULTIPLIER = 2;
export const UNILATERAL_SET_COUNT_MULTIPLIER = 1;

/**
 * Records are tracked from 1 to 10 reps. Above that a "best ever" is really a
 * conditioning result, and the RPE chart cannot price it anyway.
 */
export const RECORD_MAX_REPS = 10;

export interface MetricsConfig {
  version: number;
  muscleWeightPresets: Record<string, MuscleWeights>;
  activeMuscleWeights: string;
  tierWeightPresets: Record<string, TierWeights>;
  activeTierWeights: string;
  warmupsCountedIn: WarmupScope[];
  bodyweight: {
    requiredForLoadTypes: string[];
    hintMaxAgeDays: number;
    whenMissing: 'skip_set_and_warn' | 'skip_set' | 'use_latest_known';
  };
  tonnage: { tierWeights: string; bodyweightIncluded: boolean };
}

function pick<T extends Record<string, number>>(
  presets: unknown,
  keys: readonly string[],
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [name, p] of Object.entries(presets as Record<string, Record<string, number>>)) {
    const v = {} as Record<string, number>;
    for (const k of keys) v[k] = p[k];
    out[name] = v as T;
  }
  return out;
}

export const CONFIG: MetricsConfig = {
  version: raw.version,
  muscleWeightPresets: pick<MuscleWeights>(raw.weights.muscle_roles.presets, ['primary', 'aux']),
  activeMuscleWeights: raw.weights.muscle_roles.active,
  tierWeightPresets: pick<TierWeights>(raw.weights.tiers.presets, [
    'comp',
    'high_spec',
    'low_spec',
    'acc',
  ]),
  activeTierWeights: raw.weights.tiers.active,
  warmupsCountedIn: raw.warmups.counted_in as WarmupScope[],
  bodyweight: {
    requiredForLoadTypes: raw.bodyweight.required_for_load_types,
    hintMaxAgeDays: raw.bodyweight.hint_max_age_days,
    whenMissing: raw.bodyweight.when_missing as MetricsConfig['bodyweight']['whenMissing'],
  },
  tonnage: {
    tierWeights: raw.tonnage.tier_weights,
    bodyweightIncluded: raw.tonnage.bodyweight_included,
  },
};

export function muscleWeights(preset = CONFIG.activeMuscleWeights): MuscleWeights {
  const w = CONFIG.muscleWeightPresets[preset];
  if (!w) throw new Error(`Unknown muscle weight preset "${preset}"`);
  return w;
}

export function tierWeights(preset = CONFIG.activeTierWeights): TierWeights {
  const w = CONFIG.tierWeightPresets[preset];
  if (!w) throw new Error(`Unknown tier weight preset "${preset}"`);
  return w;
}

/** Does this metric count ramp-up sets? */
export function countsWarmups(scope: WarmupScope): boolean {
  return CONFIG.warmupsCountedIn.includes(scope);
}

export const MUSCLE_PRESET_NAMES = Object.keys(CONFIG.muscleWeightPresets);
export const TIER_PRESET_NAMES = Object.keys(CONFIG.tierWeightPresets);
