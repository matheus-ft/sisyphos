import { classify, RETIRED_PATHS } from './paths';
import type { LocalStore, StoreOp } from './store/store';

/**
 * What an earlier build left on the device that this one no longer reads
 * (DATA.md, The files; DECISIONS.md, A meet is a record).
 *
 * Once a kind is retired its file is foreign: sync neither reads nor writes
 * it, and the copy in the log repo stays where it is. What is still on the
 * device would do harm all the same, so it is dropped when the app opens:
 *
 * - the file itself, content and sync entry together. Left, its entry would
 *   read as a change waiting to back up for ever, since nothing now pushes it;
 * - a conflict record about it. A record this build cannot read would stop
 *   `Log.getConflicts`, and with it the Conflicts page, from loading. Only its
 *   content goes: the deletion is an ordinary one and syncs, as resolving it
 *   would have.
 *
 * Nothing is migrated: what the lifter had in a retired file they enter again
 * in its replacement. Idempotent, and a no-op on a device that holds none.
 */
export async function retire(store: LocalStore): Promise<void> {
  await store.exclusive(async (s) => {
    const ops: StoreOp[] = [];
    for (const path of await s.paths()) {
      if (RETIRED_PATHS.includes(path)) {
        ops.push({ op: 'content', path, text: null }, { op: 'base', path, sha: null });
      } else if (classify(path).kind === 'conflict') {
        const text = await s.content(path);
        if (text !== null && RETIRED_PATHS.includes(conflictTarget(text) ?? '')) {
          ops.push({ op: 'content', path, text: null });
        }
      }
    }
    if (ops.length > 0) await s.apply(ops);
  });
}

/** The `path` a conflict record names, read without caring whether the rest parses. */
function conflictTarget(text: string): string | null {
  try {
    const value = JSON.parse(text.startsWith('﻿') ? text.slice(1) : text) as unknown;
    const path = (value as { path?: unknown } | null)?.path;
    return typeof path === 'string' ? path : null;
  } catch {
    return null;
  }
}
