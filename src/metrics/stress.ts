import { parseCsv } from '../csv';
import chartCsv from './stress-chart.csv?raw';
import { countsWarmups, muscleWeights, type MuscleWeights } from './definitions';
import type { Exercise, MuscleRole } from '../model';

/**
 * Per-set peripheral and central fatigue for a given reps-at-RPE.
 *
 * Values derived from the fatigue model surfaced in Reactive Training Systems'
 * training log; see the credits in README. Unlike the RPE chart this one is
 * complete — every RPE from 0 to 10 has all 12 rep counts.
 */
export interface Stress {
  /** Local, mechanical fatigue. Scales with reps. */
  peripheral: number;
  /** Systemic fatigue. Scales with proximity to failure. */
  central: number;
}

const STRESS = new Map<string, Stress>();
for (const row of parseCsv(chartCsv)) {
  STRESS.set(`${row.rpe}:${row.reps}`, {
    peripheral: Number(row.peripheral),
    central: Number(row.central),
  });
}

/**
 * One set's fatigue. Out-of-range inputs clamp rather than return null: the
 * chart's edges are plateaus, so a set of 15 really is close to a set of 12 —
 * unlike the e1RM chart, where extrapolating would invent a number.
 */
export function stressFor(rpe: number, reps: number): Stress | null {
  const r = Math.max(0, Math.min(10, Math.round(rpe * 2) / 2));
  const n = Math.max(1, Math.min(12, Math.round(reps)));
  return STRESS.get(`${r.toFixed(1)}:${n}`) ?? null;
}

/**
 * Stress Index for one set: the mean of its two components.
 *
 * Not configurable. Summing them instead is the same number doubled, and
 * looking at one component alone is not an index — `totalStress` already
 * returns peripheral and central separately for exactly that.
 */
export function stressIndexOf(s: Stress): number {
  return (s.peripheral + s.central) / 2;
}

export function setStressIndex(rpe: number, reps: number): number | null {
  const s = stressFor(rpe, reps);
  return s ? stressIndexOf(s) : null;
}

export interface StressTotals {
  peripheral: number;
  central: number;
  si: number;
  sets: number;
}

export function totalStress(sets: Array<{ rpe: number; reps: number }>): StressTotals {
  const t: StressTotals = { peripheral: 0, central: 0, si: 0, sets: 0 };
  for (const s of sets) {
    const f = stressFor(s.rpe, s.reps);
    if (!f) continue;
    t.peripheral += f.peripheral;
    t.central += f.central;
    t.si += stressIndexOf(f);
    t.sets += 1;
  }
  return t;
}

/**
 * Central-stress balance: central divided by SI. Above 1 is intensity-dominant,
 * below 1 volume-dominant, and it can exceed 1 because SI is a mean rather than
 * a sum.
 *
 * Note the denominator is SI, not twice SI — the two differ by a factor of two
 * and only one of them has the stated meaning.
 */
export function centralBalance(sets: Array<{ rpe: number; reps: number }>): number | null {
  const t = totalStress(sets);
  return t.si > 0 ? t.central / t.si : null;
}

const ROLES: readonly MuscleRole[] = ['primary', 'secondary', 'aux'];

/**
 * Stress attributed to each muscle, scaled by the same role weights that drive
 * per-muscle volume — so switching preset moves volume and stress together
 * instead of letting them tell different stories.
 *
 * Movement-level stress is deliberately never scaled: the set cost what it cost.
 * Only the attribution to individual muscles is a modelling choice.
 */
export function stressByMuscle(
  sets: Array<{ rpe: number; reps: number; is_warmup?: boolean; exercise: Exercise }>,
  weights: MuscleWeights = muscleWeights(),
): Map<string, number> {
  const out = new Map<string, number>();
  const warmups = countsWarmups('stress');
  for (const s of sets) {
    if (s.is_warmup && !warmups) continue;
    const f = stressFor(s.rpe, s.reps);
    if (!f) continue;
    const si = stressIndexOf(f);
    for (const role of ROLES) {
      const w = weights[role];
      if (w === 0) continue;
      for (const muscle of s.exercise.muscles[role]) {
        out.set(muscle, (out.get(muscle) ?? 0) + si * w);
      }
    }
  }
  return out;
}
