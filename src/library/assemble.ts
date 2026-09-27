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
  shipped: Exercise[],
  additions: ExerciseAddition[],
  hash: (exercise: Exercise) => string,
): AssembledLibrary {
  const shippedById = new Map(shipped.map((exercise) => [exercise.id, exercise]));
  // What the lifter picks from, by id: the shipped row unless the rule says otherwise.
  const used = new Map<string, Exercise>(shippedById);
  const conflicts: LibraryConflict[] = [];
  const fixes: AdditionFix[] = [];

  // In id order, so the fixes and conflicts come out the same on every device
  // whatever order the additions were read in.
  for (const addition of [...additions].sort(byId)) {
    // `based_on` is bookkeeping about the row, not part of it: the addition is
    // hashed, and used, as the exercise it describes.
    const { based_on: base, ...mine } = addition;
    const { id } = mine;
    const shippedRow = shippedById.get(id);

    if (!shippedRow) {
      // R is absent. With B absent too this is a brand-new exercise, the R = B
      // case: the addition is used. A B that names a shipped row this app does
      // not have means the addition was made by a newer app, since ids never
      // leave the shipped library (9). From here that row is as absent as R, so
      // the addition is used and nothing is written; dropping it or flagging it
      // would act on a library that is merely out of date.
      used.set(id, mine);
      continue;
    }

    const local = hash(mine);
    const remote = hash(shippedRow);
    if (local === remote) {
      // A based_on that already names this row needs no write. Asking for one
      // anyway would ask again at every assembly, for ever.
      if (base !== remote) fixes.push({ op: 'rebase', id, based_on: remote });
    } else if (local === base) {
      fixes.push({ op: 'drop', id });
    } else if (remote === base) {
      used.set(id, mine);
    } else {
      conflicts.push({ id, addition, shipped: shippedRow });
    }
  }

  return { exercises: [...used.values()].sort(byId), conflicts, fixes };
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
