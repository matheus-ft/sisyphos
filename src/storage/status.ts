import type { Exposure } from './durability';

/**
 * What the UI always shows (docs/STORAGE.md 7.3; exposure levels in
 * docs/DURABILITY.md). `durability.ts` keeps `requestPersistence`,
 * `storageStatus` and `exposure`; exposure gains the rule that a session in
 * progress caps it at `pending`.
 *
 * STUB — implemented by the scheduling work package.
 */

export type SyncStatus =
  | 'not_set_up'
  | 'idle'
  | 'syncing'
  | 'offline'
  | 'retrying'
  | 'needs_token'
  | 'repo_problem'
  | 'needs_update';

export interface StatusSnapshot {
  status: SyncStatus;
  /** When `retrying`: the next attempt. */
  nextRetryAt: Date | null;
  /** The last failure, in words the lifter can act on. */
  message: string | null;
  /** Unresolved sync conflicts (section 5). */
  conflicts: number;
  /** Library conflicts (9.1), derived. */
  libraryConflicts: number;
  /** Remote files left alone because they do not parse. */
  unreadable: string[];
  exposure: Exposure;
}
