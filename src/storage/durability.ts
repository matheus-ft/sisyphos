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
 *   1. Sync. Every session is pushed as a commit to a private repo, so the
 *      archive lives somewhere the phone cannot take with it. `exposure()`
 *      measures how far the phone has drifted from it.
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
  /** Unpushed work exists but is minutes old. Normal mid-session state. */
  | 'pending'
  /** Unpushed work is old enough to be worth acting on. */
  | 'at_risk'
  /** Sync has never been configured, so the phone is the only copy of everything. */
  | 'unprotected';

export interface Exposure {
  level: ExposureLevel;
  /** Documents changed locally and not yet accepted by the remote. */
  unsyncedDocuments: number;
  /** Age of the oldest unsynced change, in minutes. Null when nothing is pending. */
  oldestUnsyncedMinutes: number | null;
  /** One sentence, written to be shown to the lifter as-is. */
  message: string;
}

export interface ExposureInput {
  syncConfigured: boolean;
  unsyncedDocuments: number;
  /** When the oldest unsynced change was made. */
  oldestUnsyncedAt: Date | null;
  now?: Date;
}

/** Unsynced work older than this is worth surfacing rather than leaving quiet. */
export const AT_RISK_AFTER_MINUTES = 60;

/**
 * How bad things are if this phone disappears right now.
 *
 * Deliberately never returns `safe` when sync is unconfigured, however tidy the
 * local state looks: zero unsynced documents on a device with nowhere to sync to
 * means everything is unsynced, not that everything is safe.
 */
export function exposure(input: ExposureInput): Exposure {
  const now = input.now ?? new Date();
  const minutes = input.oldestUnsyncedAt
    ? Math.max(0, Math.round((now.getTime() - input.oldestUnsyncedAt.getTime()) / 60000))
    : null;

  if (!input.syncConfigured) {
    return {
      level: 'unprotected',
      unsyncedDocuments: input.unsyncedDocuments,
      oldestUnsyncedMinutes: minutes,
      message:
        'This phone is the only copy of your training. Connect a backup repo, or export regularly.',
    };
  }

  if (input.unsyncedDocuments === 0) {
    return {
      level: 'safe',
      unsyncedDocuments: 0,
      oldestUnsyncedMinutes: null,
      message: 'Everything is backed up.',
    };
  }

  const docs = input.unsyncedDocuments;
  const noun = docs === 1 ? 'session' : 'sessions';

  if (minutes !== null && minutes >= AT_RISK_AFTER_MINUTES) {
    const hours = Math.floor(minutes / 60);
    const age = hours >= 1 ? `${hours}h` : `${minutes}m`;
    return {
      level: 'at_risk',
      unsyncedDocuments: docs,
      oldestUnsyncedMinutes: minutes,
      message: `${docs} ${noun} not backed up for ${age}. Check your connection, or back up now.`,
    };
  }

  return {
    level: 'pending',
    unsyncedDocuments: docs,
    oldestUnsyncedMinutes: minutes,
    message: `${docs} ${noun} waiting to back up.`,
  };
}
