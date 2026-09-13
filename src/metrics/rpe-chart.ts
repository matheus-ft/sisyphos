import { parseCsv } from '../csv';
import chartCsv from './rpe-chart.csv?raw';

/**
 * The RPE-to-load chart: what fraction of your 1RM a given reps-at-RPE
 * represents. The classic RPE/RIR chart popularised by Helms et al.
 *
 * Stored as long-format CSV (rpe, reps, factor) rather than a nested table,
 * because that is the shape of the data and it diffs one line at a time. Note
 * the chart is deliberately ragged — low-RPE rows stop well before 12 reps,
 * because "3 reps at RPE 0" is not a thing the chart can speak to.
 */
const FACTORS = new Map<string, number>();
for (const row of parseCsv(chartCsv)) {
  FACTORS.set(`${row.rpe}:${row.reps}`, Number(row.factor));
}

/** RPE is recorded in 0.5 steps; anything else rounds to the nearest one. */
function roundRpe(rpe: number): number {
  return Math.round(rpe * 2) / 2;
}

function key(rpe: number, reps: number): string {
  return `${roundRpe(rpe).toFixed(1)}:${Math.round(reps)}`;
}

/**
 * Fraction of 1RM for `reps` at `rpe`, or null when the chart does not cover it.
 * Null is a real answer here, not a failure.
 */
export function loadFactor(rpe: number, reps: number): number | null {
  return FACTORS.get(key(rpe, reps)) ?? null;
}

/**
 * Estimated 1RM. Requires an RPE by design — there is no formula fallback,
 * because a formula above the chart's range produces a number that looks real
 * and is not.
 */
export function e1rm(weightKg: number, rpe: number, reps: number): number | null {
  const f = loadFactor(rpe, reps);
  return f && f > 0 ? weightKg / f : null;
}

/**
 * Highest rep count the chart covers at all, read off the chart itself rather
 * than configured — it is a property of the data, and a config value could only
 * ever disagree with it.
 */
export const MAX_CHART_REPS = Math.max(...[...FACTORS.keys()].map((k) => Number(k.split(':')[1])));
