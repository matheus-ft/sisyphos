import type { ConflictRecord, Exercise, Id, IsoDate, Session, Template } from '../model';
import type { AssembledLibrary } from '../library/assemble';
import type { SubmissionKind } from '../library/submission';
import type { RecordOf } from './formats';
import type { TableKind } from './paths';
import type { LocalStore } from './store/store';

/**
 * The lifter's records, over the store: what the app reads and writes.
 *
 * Every write goes through `store.exclusive` and is one `apply`, so it is on
 * disk when the promise resolves, and nothing is held in memory (2.2). Records
 * are serialised with formats.ts into the file content the store keeps; reads
 * parse it back (caching by content sha is fine).
 *
 * STUB — implemented by the store work package.
 */

export interface LogOptions {
  deviceId: string;
  /** The shipped exercise library, for `based_on` and `library()`. */
  shipped: Exercise[];
  now?: () => Date;
  random?: () => number;
}

export type ConflictChoice = 'keep_log' | 'use_saved';
export type LibraryConflictChoice = 'use_shipped' | 'keep_mine';

const todo = (): never => {
  throw new Error('not implemented: storage/log');
};

export class Log {
  constructor(
    readonly store: LocalStore,
    readonly options: LogOptions,
  ) {}

  // --- reads ----------------------------------------------------------------------

  getSession(_id: Id): Promise<Session | null> {
    return todo();
  }
  /** Inclusive date range, ordered by date then `started_at`. */
  listSessions(_from: IsoDate, _to: IsoDate): Promise<Session[]> {
    return todo();
  }
  /** Sessions with `ended_at` null. */
  listOpenSessions(): Promise<Session[]> {
    return todo();
  }
  getTemplates(): Promise<Template[]> {
    return todo();
  }
  getRows<K extends TableKind>(_kind: K): Promise<RecordOf<K>[]> {
    return todo();
  }
  /** Every unresolved sync conflict (section 5). */
  getConflicts(): Promise<ConflictRecord[]> {
    return todo();
  }
  /**
   * The exercise library with the lifter's additions applied (9.1). Applies the
   * rule's fixes (rebase, drop) as writes before returning.
   */
  library(): Promise<AssembledLibrary> {
    return todo();
  }

  // --- writes ---------------------------------------------------------------------

  newSessionId(_date: IsoDate): Promise<Id> {
    return todo();
  }
  newTemplateId(_name: string): Promise<Id> {
    return todo();
  }
  /**
   * Sets `updated_at` and `device_id`. A write whose only change would be a new
   * `updated_at` is skipped (2.2).
   */
  putSession(_session: Session): Promise<void> {
    return todo();
  }
  deleteSession(_id: Id): Promise<void> {
    return todo();
  }
  /** Sets `updated_at`, with the same skip rule as sessions. */
  putTemplate(_template: Template): Promise<void> {
    return todo();
  }
  deleteTemplate(_id: Id): Promise<void> {
    return todo();
  }
  /** Replaces the row with the record's key (2.3). Not for additions: use `saveExercise`. */
  putRow<K extends Exclude<TableKind, 'additions'>>(_kind: K, _record: RecordOf<K>): Promise<void> {
    return todo();
  }
  deleteRow<K extends TableKind>(_kind: K, _record: RecordOf<K>): Promise<void> {
    return todo();
  }
  /**
   * Saves an exercise the lifter created or changed as an addition, with
   * `based_on` set to the current shipped row with its id (9.1). Returns the
   * submission to open (9.2): 'new', 'change', or null when it equals the shipped row.
   */
  saveExercise(_exercise: Exercise): Promise<SubmissionKind | null> {
    return todo();
  }

  // --- conflicts ------------------------------------------------------------------

  /** Section 5.3: keep the log's version, or write the saved one; either way the record goes. */
  resolveConflict(_id: Id, _choice: ConflictChoice): Promise<void> {
    return todo();
  }
  /**
   * Section 9.1: 'use_shipped' deletes the addition; 'keep_mine' moves its
   * `based_on` to the current shipped row and returns 'change' so the caller opens
   * a new submission.
   */
  resolveLibraryConflict(
    _exerciseId: string,
    _choice: LibraryConflictChoice,
  ): Promise<SubmissionKind | null> {
    return todo();
  }
}
