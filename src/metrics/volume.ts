import {
  countsWarmups,
  muscleWeights,
  tierWeights,
  UNILATERAL_SET_COUNT_MULTIPLIER,
  type MuscleWeights,
  type TierWeights,
} from './definitions';
import type { CompetitionLift, Exercise, MuscleRole, PerformedSet, Tier } from '../model';

/**
 * Volume, counted in sets, along two weighted axes and one discrete one.
 *
 * There is no "counting mode". Every scheme people argue about — binary,
 * fractional, primary-only — is the same calculation with different weights, so
 * switching preset is the whole mechanism.
 *
 * Weighted totals never replace the discrete breakdown. `volumeByTier` and
 * `setsByTierForLift` always answer "6 comp sets, 2 high-spec, 3 accessory",
 * which is usually the more useful sentence; the weighted total is for when you
 * need one number to compare blocks with.
 */

const ROLES: readonly MuscleRole[] = ['primary', 'aux'];
const TIERS: readonly Tier[] = ['comp', 'high_spec', 'low_spec', 'acc'];

export interface CountedSet {
  set: PerformedSet;
  exercise: Exercise;
}

/** One logged set of a unilateral exercise is still one set — it was just done twice. */
function counts(s: CountedSet): number {
  return s.exercise.unilateral ? UNILATERAL_SET_COUNT_MULTIPLIER : 1;
}

/**
 * A set counts when it actually happened. `pending` never happened yet and
 * `skipped` deliberately did not, so the set's own state answers this — there
 * is no separate policy that could disagree with it.
 */
function eligible(s: CountedSet, warmups: boolean): boolean {
  if (s.set.state !== 'done') return false;
  return warmups || !s.set.is_warmup;
}

// --- by muscle ---------------------------------------------------------------

export function volumeByMuscle(
  sets: CountedSet[],
  weights: MuscleWeights = muscleWeights(),
): Map<string, number> {
  const out = new Map<string, number>();
  const warmups = countsWarmups('volume');
  for (const s of sets) {
    if (!eligible(s, warmups)) continue;
    const n = counts(s);
    for (const role of ROLES) {
      const w = weights[role];
      if (w === 0) continue;
      for (const muscle of s.exercise.muscles[role]) {
        out.set(muscle, (out.get(muscle) ?? 0) + n * w);
      }
    }
  }
  return out;
}

// --- by tier: discrete first, weighted second --------------------------------

/** Sets per specificity tier. The honest breakdown, with nothing weighted away. */
export function volumeByTier(sets: CountedSet[]): Map<Tier, number> {
  const out = new Map<Tier, number>();
  const warmups = countsWarmups('volume');
  for (const s of sets) {
    if (!eligible(s, warmups)) continue;
    out.set(s.exercise.tier, (out.get(s.exercise.tier) ?? 0) + counts(s));
  }
  return out;
}

/**
 * Sets per tier, per competition event — "for the squat: 6 comp, 2 high-spec, 3
 * accessory". The sentence you actually want when reviewing a block.
 */
export function setsByTierForLift(
  sets: CountedSet[],
): Map<CompetitionLift | 'none', Map<Tier, number>> {
  const out = new Map<CompetitionLift | 'none', Map<Tier, number>>();
  const warmups = countsWarmups('volume');
  for (const s of sets) {
    if (!eligible(s, warmups)) continue;
    const lift = s.exercise.base_lift ?? 'none';
    let inner = out.get(lift);
    if (!inner) {
      inner = new Map(TIERS.map((t) => [t, 0]));
      out.set(lift, inner);
    }
    inner.set(s.exercise.tier, (inner.get(s.exercise.tier) ?? 0) + counts(s));
  }
  return out;
}

/**
 * One number per event, with each tier contributing at its weight. Use it to
 * compare blocks; use `setsByTierForLift` to understand one.
 *
 * Volume never crosses events: a squat accessory is squat work regardless of how
 * much it transfers to the deadlift.
 */
export function eventVolume(
  sets: CountedSet[],
  weights: TierWeights = tierWeights(),
): Map<CompetitionLift | 'none', number> {
  const out = new Map<CompetitionLift | 'none', number>();
  const warmups = countsWarmups('volume');
  for (const s of sets) {
    if (!eligible(s, warmups)) continue;
    const w = weights[s.exercise.tier];
    if (w === 0) continue;
    const lift = s.exercise.base_lift ?? 'none';
    out.set(lift, (out.get(lift) ?? 0) + counts(s) * w);
  }
  return out;
}
