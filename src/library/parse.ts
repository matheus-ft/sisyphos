import { parseBool, parseCsv, parseList, type Row } from '../csv';
import type { CompetitionLift, Exercise, LoadType, LoadUnit, Muscle, Tier } from '../model';

/**
 * Reads the library CSVs into records.
 *
 * Both files ship with the app. `muscles.csv` is a fixed vocabulary exercises
 * point at; `exercises.csv` is the shared library everyone contributes to.
 * Exercises a lifter creates live in their own log repo until the pull request
 * adding them upstream is merged, and override the shipped rows by id until then.
 */

const TIERS: readonly Tier[] = ['comp', 'high_spec', 'low_spec', 'acc'];
const LIFTS: readonly CompetitionLift[] = ['squat', 'bench', 'deadlift'];
const LOAD_TYPES: readonly LoadType[] = ['external', 'bw_plus', 'none'];
const LOAD_UNITS: readonly LoadUnit[] = ['kg', 'lb', 'pins'];

function oneOf<T extends string>(
  cell: string,
  allowed: readonly T[],
  field: string,
  id: string,
): T {
  const v = cell.trim() as T;
  if (!allowed.includes(v)) {
    throw new Error(`${id}: ${field} must be one of ${allowed.join(', ')} — got "${cell}"`);
  }
  return v;
}

export function parseMuscles(csv: string): Muscle[] {
  return parseCsv(csv).map((row: Row) => ({
    id: row.id,
    name: row.name,
  }));
}

export function parseExercises(csv: string, knownMuscles?: Set<string>): Exercise[] {
  return parseCsv(csv).map((row: Row) => {
    const id = row.id;
    const muscles = {
      primary: parseList(row.primary ?? ''),
      secondary: parseList(row.secondary ?? ''),
      aux: parseList(row.aux ?? ''),
    };

    if (knownMuscles) {
      for (const role of ['primary', 'secondary', 'aux'] as const) {
        for (const m of muscles[role]) {
          if (!knownMuscles.has(m)) {
            throw new Error(`${id}: ${role} references unknown muscle "${m}"`);
          }
        }
      }
    }

    return {
      id,
      name: row.name,
      // Blank is meaningful: work that serves no competition event.
      base_lift: row.base_lift ? oneOf(row.base_lift, LIFTS, 'base_lift', id) : null,
      tier: oneOf(row.tier, TIERS, 'tier', id),
      // Blank defaults to false, so only unilateral exercises need the cell filled.
      unilateral: parseBool(row.unilateral ?? ''),
      load_type: row.load_type ? oneOf(row.load_type, LOAD_TYPES, 'load_type', id) : 'external',
      // A hint for the entry form. The unit recorded on each set is what counts.
      default_unit: row.default_unit
        ? oneOf(row.default_unit, LOAD_UNITS, 'default_unit', id)
        : 'kg',
      muscles,
    };
  });
}
