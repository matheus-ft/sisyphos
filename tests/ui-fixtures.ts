import exercisesCsv from '../src/library/exercises.csv?raw';
import musclesCsv from '../src/library/muscles.csv?raw';
import { parseExercises, parseMuscles } from '../src/library/parse';
import type { Exercise, LoadUnit, Session } from '../src/model';
import {
  addExercise,
  addSet,
  editSet,
  newSession,
  type NewId,
  type SetEdit,
} from '../src/ui/session';

/** The shipped library, so tests use real exercises and not look-alikes. */
const muscles = parseMuscles(musclesCsv);
export const library = parseExercises(exercisesCsv, new Set(muscles.map((m) => m.id)));
export const byId = (id: string): Exercise => library.find((e) => e.id === id)!;

export function ids(prefix = 'id'): NewId {
  let n = 0;
  return () => `${prefix}${++n}`;
}

/** A session on a day of October 2026, built with the real helpers so new fields come along. */
export function sessionOn(day: number, id = `s${day}`, hour = 18): Session {
  return newSession({
    id,
    at: new Date(2026, 9, day, hour, 0),
    tz: 'Europe/Lisbon',
    deviceId: 'phone',
  });
}

export interface Lifted {
  amount: number;
  reps: number;
  rpe?: number;
  unit?: LoadUnit;
  warmup?: boolean;
}

/**
 * The session with `exercise` added and these sets logged, in order. The first
 * set is the exercise's own blank one; the rest come from `addSet`.
 */
export function withSets(
  session: Session,
  exercise: Exercise,
  sets: Lifted[],
  newId: NewId = ids(),
): Session {
  let s = addExercise(session, exercise, newId);
  const instanceId = s.exercises.at(-1)!.id;
  sets.forEach((lifted, i) => {
    if (i > 0) s = addSet(s, instanceId, newId);
    const setId = s.exercises.at(-1)!.performed.at(-1)!.id;
    const edit: SetEdit = {
      amount: lifted.amount,
      reps: lifted.reps,
      unit: lifted.unit ?? 'kg',
      is_warmup: lifted.warmup ?? false,
    };
    if (lifted.rpe !== undefined) edit.rpe = lifted.rpe;
    s = editSet(s, instanceId, setId, edit, 'weight', 'kg');
  });
  return s;
}
