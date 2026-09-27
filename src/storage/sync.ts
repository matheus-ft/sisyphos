import type { ConflictRecord } from '../model';
import type { Mode } from './decide';
import type { Remote } from './remote/remote';
import type { LocalStore } from './store/store';

/**
 * One sync (docs/STORAGE.md 4.2, 4.4, 4.5): recover an unfinished commit, read
 * the head, compare, fetch, decide, commit, move the branch fast-forward only,
 * settle. A pull stops after deciding and never commits.
 *
 * Every step that touches the device runs in `store.exclusive`. The device's
 * content is never changed before step 5, and a failure at any point leaves the
 * store consistent: killing the app between any two awaits must be safe.
 *
 * Throws `SyncError` (errors.ts) and nothing else. Unreadable remote files do
 * not throw: they are reported in the result and left alone (section 6).
 *
 * STUB — implemented by the sync work package.
 */

export interface SyncDeps {
  store: LocalStore;
  remote: Remote;
  deviceId: string;
  now?: () => Date;
  random?: () => number;
  /** Rounds lost to other devices before giving up with a retryable error. Default 5. */
  maxRounds?: number;
  /** Blob fetches in flight at once. Default 6. */
  concurrency?: number;
}

export interface SyncResult {
  /** The head this device is now in agreement with (or pulled from). */
  head: string;
  /** The commit this sync landed, or null if it had nothing to push. */
  committed: string | null;
  /** Paths written to the remote. */
  pushed: string[];
  /** Paths whose remote version was written to the device. */
  taken: string[];
  /** Conflict records this sync created. */
  conflicts: ConflictRecord[];
  /** Remote files that did not parse and were left alone. */
  unreadable: string[];
}

export function runSync(_deps: SyncDeps, _mode: Mode): Promise<SyncResult> {
  throw new Error('not implemented: storage/sync');
}
