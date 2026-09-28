import type { Instant } from '../../model';

/**
 * The device's side of the log repo (docs/STORAGE.md sections 2 and 3).
 *
 * The store keeps, for every log-repo path, the device's current content as
 * text, plus the sync bookkeeping for that path. It knows nothing about what the
 * files mean: parsing them into sessions, rows and the rest is `log.ts`, on top.
 * That is what lets the sync treat every file the same way, and lets the
 * in-memory and IndexedDB stores share one contract and one test suite.
 *
 * Two implementations: `MemoryStore` (tests, the simulation) and `IndexedDbStore`
 * (the app). Both must behave identically.
 */

/** Sync bookkeeping for one log-repo path (section 3). */
export interface SyncEntry {
  path: string;
  /** Blob sha of the remote content at the last point this device agreed with it. Null: never agreed. */
  base_sha: string | null;
  /** Blob sha of the device's current content. Null: no local content. Kept in step by `apply`. */
  local_sha: string | null;
  /** Set when local first diverged from base; kept while it stays diverged; null when they agree. */
  unsynced_since: Instant | null;
  /** Tables only: the base content itself, which the per-key decision needs. */
  base_body: string | null;
}

export interface SyncMeta {
  /**
   * The newest commit the bases were moved against: every base describes that
   * commit or its history. The history check (4.2 step 2) asks whether the head
   * still holds it.
   */
  last_synced_head: string | null;
  /**
   * That commit's tree, recorded only when every base agrees with it; null
   * otherwise. The step-3 shortcut takes the bases as the remote's files only
   * when this is set.
   */
  last_synced_tree: string | null;
}

/** A commit this device is trying to land, recorded before moving the branch (4.5). */
export interface Inflight {
  commit: string;
  tree: string;
  parent: string;
  /** What each pushed path will hold once the commit lands. `sha` null: deleted. `body`: tables only. */
  pushed: Array<{ path: string; sha: string | null; body: string | null }>;
}

export interface Settings {
  owner: string | null;
  repo: string | null;
  branch: string | null;
  /**
   * GitHub's id for the repo (`RepoInfo.id`), saved by setup; null or absent
   * until then. The name alone cannot say whether a repo is the one the bases
   * describe: one deleted and created again under the same name holds another
   * history, and gets a new id (section 8). Optional, so a settings record
   * saved without it still reads as settings; setup treats absent as unknown.
   */
  repo_id?: number | null;
  token: string | null;
  /** Random, generated once per install, never copied between devices (2.1). */
  device_id: string;
}

/**
 * One change, applied by `Exclusive.apply` together with the others in its call
 * as a single all-or-nothing transaction.
 */
export type StoreOp =
  /**
   * Replace the device's content for a path (null deletes it). The store sets
   * `local_sha` to the new content's blob sha and updates `unsynced_since`.
   */
  | { op: 'content'; path: string; text: string | null }
  /**
   * Move a path's base. `body` is for tables and is ignored otherwise. The store
   * updates `unsynced_since` against the new base.
   */
  | { op: 'base'; path: string; sha: string | null; body?: string | null }
  | { op: 'meta'; meta: SyncMeta }
  | { op: 'inflight'; inflight: Inflight | null };

export interface StoreReader {
  /** The device's current content for a path, or null. */
  content(path: string): Promise<string | null>;
  /** Every path with local content or a sync entry, sorted. */
  paths(): Promise<string[]>;
  entry(path: string): Promise<SyncEntry | null>;
  entries(): Promise<SyncEntry[]>;
  meta(): Promise<SyncMeta>;
  inflight(): Promise<Inflight | null>;
}

/** The store, inside the write queue: reads cannot go stale before `apply`. */
export interface Exclusive extends StoreReader {
  /** Applies every op in one transaction: all of them, or none. */
  apply(ops: StoreOp[]): Promise<void>;
}

export interface LocalStore extends StoreReader {
  /**
   * Runs `fn` in the write queue (2.2): first in, first out, with no other write
   * interleaving. Resolves once `fn` has finished and everything it applied has
   * committed. `fn` must not call `exclusive` itself, which would deadlock.
   */
  exclusive<T>(fn: (store: Exclusive) => Promise<T>): Promise<T>;

  settings(): Promise<Settings>;
  saveSettings(patch: Partial<Omit<Settings, 'device_id'>>): Promise<void>;

  /**
   * Forgets every base, `sync_meta` and `inflight`, keeping all content: the
   * device now shares nothing with any remote (pointing at a different repo,
   * section 8). Every path with content then needs syncing.
   */
  resetSync(): Promise<void>;
}

/**
 * How `apply` keeps `unsynced_since` (section 3): set when a path starts to
 * differ from its base, left alone while it keeps differing, cleared when they
 * agree. Shared so both stores do exactly the same thing.
 */
export function nextUnsyncedSince(
  previous: Pick<SyncEntry, 'local_sha' | 'base_sha' | 'unsynced_since'> | null,
  next: Pick<SyncEntry, 'local_sha' | 'base_sha'>,
  now: Instant,
): Instant | null {
  if (next.local_sha === next.base_sha) return null;
  const wasDiverged = previous !== null && previous.local_sha !== previous.base_sha;
  return wasDiverged ? (previous.unsynced_since ?? now) : now;
}
