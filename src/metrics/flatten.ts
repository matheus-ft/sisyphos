import type { Exercise, ExerciseInstance, PerformedSet, Session } from '../model';

/**
 * The sets of many sessions as one list, for the metrics that scan them all.
 * Each analysis asks its own question of the same flattening, so it lives once.
 */

export interface SetRef {
  session: Session;
  instance: ExerciseInstance;
  set: PerformedSet;
  exercise: Exercise;
}

/** Oldest first by date, then by start (a planned session has none), then id for a stable tie. */
export function compareSessions(a: Session, b: Session): number {
  return (
    a.date.localeCompare(b.date) ||
    (a.started_at ?? '').localeCompare(b.started_at ?? '') ||
    a.id.localeCompare(b.id)
  );
}

export function exercisesById(library: readonly Exercise[]): Map<string, Exercise> {
  return new Map(library.map((e) => [e.id, e]));
}

/**
 * Every set, in the order it was lifted: sessions oldest first, then the
 * session's exercises and sets in array order. A set of an exercise the library
 * no longer knows is left out, because nothing can say how to count it.
 */
export function flattenSets(sessions: readonly Session[], library: readonly Exercise[]): SetRef[] {
  const byId = exercisesById(library);
  const out: SetRef[] = [];
  for (const session of [...sessions].sort(compareSessions)) {
    for (const instance of session.exercises) {
      const exercise = byId.get(instance.exercise_id);
      if (!exercise) continue;
      for (const set of instance.performed) out.push({ session, instance, set, exercise });
    }
  }
  return out;
}
