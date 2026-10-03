import type { SyncEntry } from './store/store';

/**
 * How much of your training is at risk right now, and reducing it.
 *
 * The honest position: an installed web app's storage is a working copy, not the
 * archive. Deleting the home-screen icon removes its storage container — which
 * is exactly what deleting a native app does to its local data, so this is not a
 * web-app weakness, but it is a real one. The answer is not to make the phone
 * safer, because you cannot: it is to make sure the phone is never the only
 * place a session exists.
 *
 * Three mechanisms, in order of how much they buy you:
 *
 *   1. Sync. Every change reaches a private repo in a commit, so the archive
 *      lives somewhere the phone cannot take with it. `exposure()` measures how
 *      far the phone has drifted from it.
 *   2. Persistent storage. `requestPersistence()` asks the browser not to evict
 *      under disk pressure. It does nothing about deliberate deletion.
 *   3. Manual export, for when there is no network and you want a copy now.
 */

export interface StorageStatus {
  /** Browser has promised not to evict this origin's data under disk pressure. */
  persisted: boolean;
  /** Bytes in use, when the browser will say. */
  usageBytes: number | null;
  quotaBytes: number | null;
  /** False when the browser exposes no Storage API at all. */
  supported: boolean;
}

/**
 * Ask the browser to mark storage persistent. Safari generally grants this to
 * installed web apps and declines it for pages in a tab, which is one more
 * reason to install rather than bookmark.
 *
 * Safe to call on every launch: it resolves immediately once already granted.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function storageStatus(): Promise<StorageStatus> {
  if (!navigator.storage?.estimate) {
    return { persisted: false, usageBytes: null, quotaBytes: null, supported: false };
  }
  try {
    const [persisted, estimate] = await Promise.all([
      navigator.storage.persisted?.() ?? Promise.resolve(false),
      navigator.storage.estimate(),
    ]);
    return {
      persisted,
      usageBytes: estimate.usage ?? null,
      quotaBytes: estimate.quota ?? null,
      supported: true,
    };
  } catch {
    return { persisted: false, usageBytes: null, quotaBytes: null, supported: false };
  }
}

// ---------------------------------------------------------------------------
// Exposure — what would actually be lost
// ---------------------------------------------------------------------------

export type ExposureLevel =
  /** Everything on this device is also in the remote. Nothing to lose. */
  | 'safe'
  /** Unsynced changes, minutes old, or a session in progress (syncing paused on purpose). */
  | 'pending'
  /** Unsynced changes old enough to be worth acting on. */
  | 'at_risk'
  /** Sync has never been configured, so the phone is the only copy of everything. */
  | 'unprotected';

export interface Exposure {
  level: ExposureLevel;
  /** Log-repo files changed on this device and not yet accepted by the remote (STORAGE.md 3). */
  unsyncedDocuments: number;
  /** Age of the oldest unsynced change, in minutes. Null when nothing is pending. */
  oldestUnsyncedMinutes: number | null;
  /** One sentence, written to be shown to the lifter as-is. */
  message: string;
}

export interface ExposureInput {
  syncConfigured: boolean;
  /**
   * Every path's sync entry (`store.entries()`). A path needs syncing when its
   * `local_sha` differs from its `base_sha` (STORAGE.md section 3): derived
   * afresh every time, never recorded, so it cannot fall out of step.
   */
  entries: Pick<SyncEntry, 'local_sha' | 'base_sha' | 'unsynced_since'>[];
  /** A session is in progress (STORAGE.md 7.1), so syncing is paused on purpose. */
  sessionInProgress: boolean;
  now?: Date;
}

/** Unsynced work older than this is worth surfacing rather than leaving quiet. */
export const AT_RISK_AFTER_MINUTES = 60;

/**
 * How bad things are if this phone disappears right now (STORAGE.md 7.3).
 *
 * Deliberately never returns `safe` when sync is unconfigured, however tidy the
 * local state looks: zero unsynced changes on a device with nowhere to sync to
 * means everything is unsynced, not that everything is safe.
 *
 * Age is measured from the oldest `unsynced_since`, the first change that has
 * not reached the remote, so repeated edits or failed syncs never make old work
 * look new. While a session is in progress the level is at most `pending`:
 * leaving the app does not sync then (7.1), so changes growing old is the
 * design working, not a sync falling behind.
 */
export function exposure(input: ExposureInput): Exposure {
  const now = input.now ?? new Date();
  const unsynced = input.entries.filter((entry) => entry.local_sha !== entry.base_sha);
  const since = unsynced
    .map((entry) => (entry.unsynced_since === null ? NaN : Date.parse(entry.unsynced_since)))
    .filter((time) => !Number.isNaN(time));
  const minutes =
    since.length > 0 ? Math.max(0, Math.round((now.getTime() - Math.min(...since)) / 60000)) : null;
  const count = unsynced.length;

  if (!input.syncConfigured) {
    return {
      level: 'unprotected',
      unsyncedDocuments: count,
      oldestUnsyncedMinutes: minutes,
      message:
        'This phone is the only copy of your training. Connect a backup repo, or export regularly.',
    };
  }

  if (count === 0) {
    return {
      level: 'safe',
      unsyncedDocuments: 0,
      oldestUnsyncedMinutes: null,
      message: 'Everything is backed up.',
    };
  }

  const changes = count === 1 ? '1 change' : `${count} changes`;

  if (input.sessionInProgress) {
    return {
      level: 'pending',
      unsyncedDocuments: count,
      oldestUnsyncedMinutes: minutes,
      message: `${changes} waiting to back up when you end the session.`,
    };
  }

  if (minutes !== null && minutes >= AT_RISK_AFTER_MINUTES) {
    return {
      level: 'at_risk',
      unsyncedDocuments: count,
      oldestUnsyncedMinutes: minutes,
      message: `${changes} not backed up for ${Math.floor(minutes / 60)}h. Check your connection, or back up now.`,
    };
  }

  return {
    level: 'pending',
    unsyncedDocuments: count,
    oldestUnsyncedMinutes: minutes,
    message: `${changes} waiting to back up.`,
  };
}
