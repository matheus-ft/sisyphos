import type { LoadUnit } from './primitives';

/**
 * The taxonomy: what `config/muscles.csv` and `config/exercises.csv` contain.
 *
 * These describe exercises in general, not any particular session. A logged set
 * references an `Exercise` by id and carries none of this, so changing how an
 * exercise is classified changes every past analysis and rewrites no logs.
 */

/**
 * The three competition events. Note this is the EVENT, not the exercise: sumo
 * and conventional deadlift are separate exercises that both compete under
 * `deadlift`, and both are `tier: 'comp'`. Tier is not unique per event.
 */
export type CompetitionLift = 'squat' | 'bench' | 'deadlift';

/** Specificity, relative to the exercise's base lift. Ordered most → least specific. */
export type Tier = 'comp' | 'high_spec' | 'low_spec' | 'acc';

/** How a muscle contributes. Numeric weights live in config/metrics.json, never here. */
export type MuscleRole = 'primary' | 'secondary' | 'aux';

/** How a logged number combines into the load actually moved. */
export type LoadType =
  | 'external' // the number is the load on the bar or machine
  | 'bw_plus' // effective load = bodyweight + the number (negative = assisted)
  | 'none'; // not weight-driven at all

/**
 * A muscle group, the unit volume is counted in. The groups are flat and do not
 * overlap, so per-group totals can be summed; docs/MUSCLES.md says what each covers.
 */
export interface Muscle {
  /** Referenced by exercises. Stable forever once an exercise points at it. */
  id: string;
  /** Shown in the UI. Safe to reword without touching any log. */
  name: string;
}

export interface Exercise {
  id: string;
  name: string;
  /**
   * Which competition event this serves. Volume attributes to the base lift and
   * never crosses events: a squat accessory is squat volume regardless of how
   * much it transfers to the deadlift. Null for work that serves no event.
   */
  base_lift: CompetitionLift | null;
  tier: Tier;
  /**
   * One set "per side". Defaults to false when the CSV cell is blank. Metrics
   * decide what to do with it — currently 2x tonnage, 1x set count.
   */
  unilateral: boolean;
  load_type: LoadType;
  /**
   * The unit this is usually logged in, so a cable machine doesn't default to
   * kilograms every time. A hint for the entry form only — the unit recorded on
   * each set is what counts, because gyms differ.
   */
  default_unit: LoadUnit;
  muscles: Record<MuscleRole, string[]>;
}
