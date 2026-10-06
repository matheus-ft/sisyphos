import type { Instant } from '../../model';
import { isMigrated, migrateFile } from '../formats';
import { blobSha } from '../hash';
import { nextUnsyncedSince, type Inflight, type SyncEntry, type SyncMeta } from './store';

/**
 * What a build in log format 1 left on the device, brought to format 2 when a
 * newer build first opens the store: IndexedDB's version 2, and
 * `MemoryStore.upgraded`, so both stores do exactly this. Before it, nothing on
 * the device could be read by this build; after it, everything is as this build
 * would have written it, and the device's unsynced changes are still unsynced.
 *
 * The content is migrated file by file (`migrateFile`). A base is migrated with
 * it wherever the two were the same file, since then the base's text is the
 * content's. Where the device had changed or deleted a file since it last
 * agreed with the log, the base's text is not on the device: that base keeps
 * its format-1 sha, marked as such (`SyncEntry.base_format`), and the sync
 * migrates it from the remote's copy. Left unmarked, a change made on the
 * device by the old build would read as a conflict with the migrated log
 * instead of being pushed into it.
 *
 * The recorded tree is forgotten: the bases are no longer the blobs it holds,
 * and the step-3 shortcut would take them for the log's files. The head stays,
 * since every base still describes that history.
 */

const FROM = 1;

/** The store's records before format 2: `base_format` and `Inflight.format` did not exist. */
export interface Format1Records {
  content: Array<{ path: string; text: string }>;
  entries: Array<Omit<SyncEntry, 'base_format'>>;
  meta: SyncMeta | null;
  inflight: Omit<Inflight, 'format'> | null;
}

export interface Format2Records {
  content: Array<{ path: string; text: string }>;
  entries: SyncEntry[];
  meta: SyncMeta | null;
  inflight: Inflight | null;
}

export function upgradeToFormat2(old: Format1Records, now: Instant): Format2Records {
  const content = old.content.map(({ path, text }) => ({ path, text: migrated(path, text) }));
  const texts = new Map(content.map(({ path, text }) => [path, text]));

  const entries = old.entries.map((entry): SyncEntry => {
    if (!isMigrated(entry.path)) return { ...entry, base_format: null };
    const text = texts.get(entry.path);
    const local_sha = text === undefined ? null : blobSha(text);
    const together = entry.base_sha !== null && entry.base_sha === entry.local_sha;
    const base_sha = together ? local_sha : entry.base_sha;
    return {
      ...entry,
      local_sha,
      base_sha,
      unsynced_since: nextUnsyncedSince(entry, { local_sha, base_sha }, now),
      base_format: base_sha !== null && !together ? FROM : null,
    };
  });

  return {
    content,
    entries,
    meta: old.meta && { last_synced_head: old.meta.last_synced_head, last_synced_tree: null },
    inflight: old.inflight && { ...old.inflight, format: FROM },
  };
}

/**
 * A file that cannot be migrated is left as it was: it did not parse before
 * either, and the app names it as unreadable. Anything else that goes wrong
 * here is left the same way rather than thrown, since a throw would abort the
 * upgrade, and the app would not open at all.
 */
function migrated(path: string, text: string): string {
  try {
    return migrateFile(path, text, FROM);
  } catch {
    return text;
  }
}
