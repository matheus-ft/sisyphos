import type { Exercise, ExerciseAddition } from '../model';

/**
 * Which version of each exercise the app uses (docs/STORAGE.md 9.1).
 *
 * Every addition is decided with the rule of 4.3: B is the shipped row it was
 * based on (`based_on`, a row hash, or null), L the addition, R the shipped row
 * now. Rows compare by `hash`.
 *
 *   L = R      the shipped row is used; `based_on` moves to it       -> fix 'rebase'
 *   L = B      the shipped row is used; the addition is deleted       -> fix 'drop'
 *   R = B      the addition is used (a brand-new exercise is this case: both absent)
 *   otherwise  conflict: the shipped row is used until resolved
 *
 * Pure. Deterministic: the same inputs give the same output on every device,
 * which is why library conflicts need not be stored.
 *
 * STUB — implemented by the decisions work package.
 */

export interface LibraryConflict {
  /** The exercise id. */
  id: string;
  addition: ExerciseAddition;
  shipped: Exercise;
}

/** A write the rule asks for; the caller applies it through the log. */
export type AdditionFix =
  { op: 'rebase'; id: string; based_on: string } | { op: 'drop'; id: string };

export interface AssembledLibrary {
  /** Every exercise the lifter can pick: shipped rows, with additions applied per the rule. Sorted by id. */
  exercises: Exercise[];
  conflicts: LibraryConflict[];
  fixes: AdditionFix[];
}

export function assembleLibrary(
  _shipped: Exercise[],
  _additions: ExerciseAddition[],
  _hash: (exercise: Exercise) => string,
): AssembledLibrary {
  throw new Error('not implemented: library/assemble');
}
