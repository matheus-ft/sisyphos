import exercisesCsv from '../src/library/exercises.csv?raw';
import musclesCsv from '../src/library/muscles.csv?raw';
import { parseExercises, parseMuscles } from '../src/library/parse';
import type { Exercise, LoadUnit, Session } from '../src/model';
import {
  addExercise,
  addSet,
  editSet,
  finish,
  measureOf,
  newSession,
  skipSet,
} from '../src/ui/session';

/**
 * Sessions for the analysis tests, built with the session screen's own edits
 * rather than as literals, so they stay valid as the model grows fields.
 */

export const muscles = parseMuscles(musclesCsv);
export const library = parseExercises(exercisesCsv, new Set(muscles.map((m) => m.id)));
export const byId = (id: string): Exercise => {
  const found = library.find((e) => e.id === id);
  if (!found) throw new Error(`no exercise ${id}`);
  return found;
};

export const squat = byId('low_bar_squat');
export const bench = byId('bench');
export const deadlift = byId('conventional_deadlift');

/** One set as the lifter typed it. A set with nothing typed in stays pending. */
export interface SetSpec {
  /** The number typed as the load: kg, lb or pins; seconds for a timed exercise. */
  load?: number;
  unit?: LoadUnit;
  reps?: number;
  rpe?: number;
  warmup?: boolean;
  skip?: boolean;
}

let counter = 0;
const newId = () => `id${++counter}`;

export interface SessionSpec {
  /** Local date, "2026-10-04". */
  date: string;
  /** Distinguishes sessions on one day. */
  hour?: number;
  planned?: boolean;
  bodyweightKg?: number;
  work: Array<[Exercise, SetSpec[]]>;
  /** Minutes after the start the session ended, if it did. */
  lastedMin?: number;
}

export function sessionOf(spec: SessionSpec): Session {
  const [y, m, d] = spec.date.split('-').map(Number);
  const at = new Date(y, m - 1, d, spec.hour ?? 18, 0);
  let s = newSession({
    id: `${spec.date}-${newId()}`,
    at,
    tz: 'Europe/Lisbon',
    deviceId: 'phone',
    planned: spec.planned,
  });
  if (spec.bodyweightKg !== undefined) s = { ...s, bodyweight_kg: spec.bodyweightKg };

  for (const [exercise, sets] of spec.work) {
    s = addExercise(s, exercise, newId);
    const instanceId = s.exercises.at(-1)!.id;
    sets.forEach((spec, i) => {
      if (i > 0) s = addSet(s, instanceId, newId);
      const setId = s.exercises.at(-1)!.performed.at(-1)!.id;
      const edit = {
        amount: spec.load,
        unit: spec.unit,
        reps: spec.reps,
        rpe: spec.rpe,
        is_warmup: spec.warmup,
      };
      if (Object.values(edit).some((v) => v !== undefined)) {
        s = editSet(s, instanceId, setId, edit, measureOf(exercise), exercise.default_unit);
      }
      if (spec.skip) s = skipSet(s, instanceId, setId, true);
    });
  }
  if (spec.lastedMin !== undefined) {
    s = finish(s, new Date(at.getTime() + spec.lastedMin * 60_000));
  }
  return s;
}
