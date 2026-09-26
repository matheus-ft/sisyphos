import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStorage } from './helpers/memory-storage';
import { LogEngine } from '../src/storage/engine';
import { Conflict, type SyncAdapter } from '../src/storage/SyncAdapter';
import { PATHS } from '../src/storage/paths';
import type { Session } from '../src/model';

let n = 0;
const session = (over: Partial<Session> = {}): Session => ({
  id: `s${++n}`,
  date: '2026-09-14',
  started_at: '2026-09-14T06:30:00.000Z',
  tz: 'Europe/Lisbon',
  time_precision: 'instant',
  ended_at: null,
  label: { name: null, block: null, week: null, day: null, weekday: null },
  bodyweight_kg: null,
  notes: null,
  exercises: [],
  created_at: '2026-09-14T06:30:00.000Z',
  updated_at: '2026-09-14T06:30:00.000Z',
  device_id: 'phone',
  ...over,
});

type PushArgs = { path: string; body: string; baseSha: string | null };

/**
 * Records every accepted push. `behaviour` decides what happens; recording runs
 * after it, so a throw is not recorded as a push. Nothing here closes over a
 * binding the caller is still destructuring, which is a subtle way to silently
 * record into the wrong array.
 */
function fakeSync(
  behaviour?: (a: PushArgs) => Promise<{ sha: string }>,
  over: Partial<SyncAdapter> = {},
) {
  const pushed: PushArgs[] = [];
  const removed: string[] = [];
  const sync: SyncAdapter = {
    isConfigured: () => true,
    pull: async () => null,
    push: async (path, body, baseSha) => {
      const args = { path, body, baseSha };
      const res = behaviour ? await behaviour(args) : { sha: `sha-${pushed.length + 1}` };
      pushed.push(args);
      return res;
    },
    remove: async (path) => void removed.push(path),
    list: async () => [],
    ...over,
  };
  return { sync, pushed, removed };
}

let storage: MemoryStorage;
const live: LogEngine[] = [];

/** Registered so every engine's timers are torn down, whatever the test does. */
function makeEngine(opts: ConstructorParameters<typeof LogEngine>[0]): LogEngine {
  const e = new LogEngine(opts);
  live.push(e);
  return e;
}

beforeEach(() => {
  storage = new MemoryStorage();
});

afterEach(() => {
  while (live.length) live.pop()!.dispose();
});

describe('saving', () => {
  it('coalesces rapid edits of one session into a single write', async () => {
    const { sync } = fakeSync();
    const engine = makeEngine({ storage, sync });
    const s = session();
    engine.edit(s);
    engine.edit({ ...s, notes: 'a' });
    engine.edit({ ...s, notes: 'b' });
    await engine.saveNow();
    expect((await storage.getSession(s.id))?.notes).toBe('b');
  });

  it('stamps updated_at, so the document carries when it last changed', async () => {
    const { sync } = fakeSync();
    const engine = makeEngine({ storage, sync });
    const s = session({ updated_at: '2020-01-01T00:00:00.000Z' });
    engine.edit(s);
    await engine.saveNow();
    expect((await storage.getSession(s.id))!.updated_at).not.toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('pushing', () => {
  it('saves before pushing, and sends the document body', async () => {
    const { sync, pushed } = fakeSync();
    const engine = makeEngine({ storage, sync });
    const s = session();
    engine.edit(s);
    await engine.flush('manual');
    expect(pushed).toHaveLength(1);
    expect(pushed[0].path).toBe(PATHS.session(s));
    expect(JSON.parse(pushed[0].body).id).toBe(s.id);
  });

  it('sends the remembered sha on the second push, making it compare-and-swap', async () => {
    const { sync, pushed } = fakeSync();
    const engine = makeEngine({ storage, sync });
    const s = session();
    engine.edit(s);
    await engine.flush('manual');
    engine.edit({ ...s, notes: 'more' });
    await engine.flush('manual');
    expect(pushed[0].baseSha).toBeNull();
    expect(pushed[1].baseSha).toBe('sha-1');
  });

  it('clears the dirty queue only for documents the remote accepted', async () => {
    const { sync } = fakeSync();
    const engine = makeEngine({ storage, sync });
    engine.edit(session());
    await engine.flush('manual');
    expect(await storage.listDirty()).toEqual([]);
  });

  it('does nothing at all when sync is not configured', async () => {
    const { sync, pushed } = fakeSync(undefined, { isConfigured: () => false });
    const engine = makeEngine({ storage, sync });
    engine.edit(session());
    await engine.flush('manual');
    expect(pushed).toEqual([]);
    // The change is still on disk; it is only the remote that has not seen it.
    expect(await storage.listDirty()).toHaveLength(1);
  });

  it('pushes a deleted session as a removal', async () => {
    const { sync, removed } = fakeSync();
    const engine = makeEngine({ storage, sync });
    const s = session();
    engine.edit(s);
    await engine.flush('manual');
    await storage.deleteSession(s.id);
    await engine.flush('manual');
    expect(removed).toEqual([PATHS.session(s)]);
  });
});

describe('when one document fails', () => {
  it('still pushes the others, rather than abandoning the batch', async () => {
    const a = session({ date: '2026-09-14' });
    const b = session({ date: '2026-09-15' });
    const pathA = PATHS.session(a);
    const { sync, pushed } = fakeSync(async ({ path }) => {
      if (path === pathA) throw new Conflict(path, 'theirs');
      return { sha: 'ok' };
    });
    const engine = makeEngine({ storage, sync });
    engine.edit(a);
    engine.edit(b);
    await engine.flush('manual');
    // Tuesday conflicting must not keep Wednesday off the remote.
    expect(pushed.map((p) => p.path)).toEqual([PATHS.session(b)]);
    expect(engine.getConflicts().map((c) => c.path)).toEqual([pathA]);
  });

  it('reports a conflict with both versions, and picks neither', async () => {
    const seen: string[] = [];
    const s = session();
    const path = PATHS.session(s);
    const { sync } = fakeSync(
      async () => {
        throw new Conflict(path, 'theirs-sha');
      },
      { pull: async () => ({ body: '{"id":"theirs"}', sha: 'theirs-sha' }) },
    );
    const engine = makeEngine({ storage, sync, onConflict: (c) => seen.push(c.path) });
    engine.edit(s);
    await engine.flush('manual');

    const [c] = engine.getConflicts();
    expect(seen).toEqual([path]);
    expect(JSON.parse(c.mine).id).toBe(s.id);
    expect(c.theirs).toBe('{"id":"theirs"}');
    // Still dirty: nothing was resolved on the app's own say-so.
    expect(await storage.listDirty()).toHaveLength(1);
  });

  it('rethrows a network error so the scheduler backs off and retries', async () => {
    const { sync } = fakeSync(async () => {
      throw new Error('offline');
    });
    const engine = makeEngine({ storage, sync });
    engine.edit(session());
    await engine.flush('manual');
    // The scheduler swallowed it into its failure count rather than crashing.
    expect(await storage.listDirty()).toHaveLength(1);
  });
});

describe('resolving a conflict', () => {
  it('keeping mine overwrites the remote with this version', async () => {
    const s = session();
    const path = PATHS.session(s);
    let conflictOnce = true;
    const { sync, pushed } = fakeSync(
      async ({ path: p }) => {
        if (conflictOnce) {
          conflictOnce = false;
          throw new Conflict(p, 'theirs-sha');
        }
        return { sha: 'resolved' };
      },
      { pull: async () => ({ body: 'theirs', sha: 'theirs-sha' }) },
    );
    const engine = makeEngine({ storage, sync });
    engine.edit(s);
    await engine.flush('manual');
    await engine.resolveConflict(path, 'mine');
    expect(pushed.map((p) => p.baseSha)).toEqual(['theirs-sha']);
    expect(engine.getConflicts()).toEqual([]);
  });

  it('keeping mine remembers the sha it produced, so the next push is not a conflict', async () => {
    const s = session();
    const path = PATHS.session(s);
    let conflictOnce = true;
    const { sync, pushed } = fakeSync(
      async ({ path: p }) => {
        if (conflictOnce) {
          conflictOnce = false;
          throw new Conflict(p, 'theirs-sha');
        }
        return { sha: `after-${pushed.length}` };
      },
      { pull: async () => ({ body: 'theirs', sha: 'theirs-sha' }) },
    );
    const engine = makeEngine({ storage, sync });
    engine.edit(s);
    await engine.flush('manual');
    await engine.resolveConflict(path, 'mine');
    engine.edit({ ...s, notes: 'next edit' });
    await engine.flush('manual');
    expect(pushed.map((p) => p.baseSha)).toEqual(['theirs-sha', 'after-0']);
  });

  it('keeping mine sends what the device holds now, not the snapshot', async () => {
    const s = session();
    const path = PATHS.session(s);
    let conflictOnce = true;
    const { sync, pushed } = fakeSync(
      async ({ path: p }) => {
        if (conflictOnce) {
          conflictOnce = false;
          throw new Conflict(p, 'theirs-sha');
        }
        return { sha: 'resolved' };
      },
      { pull: async () => ({ body: 'theirs', sha: 'theirs-sha' }) },
    );
    const engine = makeEngine({ storage, sync });
    engine.edit(s);
    await engine.flush('manual');
    engine.edit({ ...s, notes: 'edited after the conflict' });
    await engine.saveNow();
    await engine.resolveConflict(path, 'mine');
    expect(JSON.parse(pushed[0].body).notes).toBe('edited after the conflict');
  });

  it('keeping a deletion removes the remote file instead of writing an empty one', async () => {
    const s = session();
    const path = PATHS.session(s);
    const removed: string[] = [];
    let conflictOnce = true;
    const { sync, pushed } = fakeSync(undefined, {
      pull: async () => ({ body: 'theirs', sha: 'theirs-sha' }),
      remove: async (p) => {
        if (conflictOnce) {
          conflictOnce = false;
          throw new Conflict(p, '');
        }
        removed.push(p);
      },
    });
    const engine = makeEngine({ storage, sync });
    engine.edit(s);
    await engine.flush('manual');
    await engine.deleteSession(s.id);
    await engine.flush('manual');
    expect(engine.getConflicts().map((c) => c.path)).toEqual([path]);
    await engine.resolveConflict(path, 'mine');
    expect(removed).toEqual([path]);
    expect(pushed.filter((p) => p.body === '')).toEqual([]);
    expect(await storage.listDirty()).toEqual([]);
  });

  it('keeping theirs accepts the remote without pushing anything', async () => {
    const s = session();
    const path = PATHS.session(s);
    let pushes = 0;
    const { sync } = fakeSync(
      async ({ path: p }) => {
        pushes += 1;
        throw new Conflict(p, 'theirs-sha');
      },
      { pull: async () => ({ body: 'theirs', sha: 'theirs-sha' }) },
    );
    const engine = makeEngine({ storage, sync });
    engine.edit(s);
    await engine.flush('manual');
    await engine.resolveConflict(path, 'theirs');
    expect(pushes).toBe(1);
    expect(engine.getConflicts()).toEqual([]);
    expect(await storage.listDirty()).toEqual([]);
  });
});

describe('data that must not be lost', () => {
  it('keeps an edit saved while the previous version was being pushed', async () => {
    const s = session();
    let engine!: LogEngine;
    const { sync } = fakeSync(async () => {
      // The lifter keeps typing while the PUT is in flight, and it gets saved.
      engine.edit({ ...s, notes: 'during the push' });
      await engine.saveNow();
      return { sha: 'sha-1' };
    });
    engine = makeEngine({ storage, sync });
    engine.edit(s);
    await engine.flush('manual');
    const dirty = await storage.listDirty();
    expect(dirty).toHaveLength(1);
    expect(JSON.parse(dirty[0].body).notes).toBe('during the push');
  });

  it('does not bring back a session deleted while an edit was waiting to be saved', async () => {
    const { sync, removed, pushed } = fakeSync();
    const engine = makeEngine({ storage, sync });
    const s = session();
    engine.edit(s);
    await engine.flush('manual');
    engine.edit({ ...s, notes: 'last keystroke' });
    await engine.deleteSession(s.id);
    await engine.flush('manual');
    expect(await storage.getSession(s.id)).toBeNull();
    expect(removed).toEqual([PATHS.session(s)]);
    expect(pushed).toHaveLength(1);
  });

  it('keeps every unsaved session when one write fails', async () => {
    const { sync } = fakeSync();
    const engine = makeEngine({ storage, sync });
    const a = session();
    const b = session();
    engine.edit(a);
    engine.edit(b);
    storage.failNextPut = new Error('quota');
    await expect(engine.saveNow()).rejects.toThrow('quota');
    await engine.saveNow();
    expect(await storage.getSession(a.id)).not.toBeNull();
    expect(await storage.getSession(b.id)).not.toBeNull();
  });

  it('removes the old file when a session is moved to another date', async () => {
    const { sync, removed, pushed } = fakeSync();
    const engine = makeEngine({ storage, sync });
    const s = session({ date: '2026-09-25' });
    engine.edit(s);
    await engine.flush('manual');
    const moved = { ...s, date: '2026-09-24' };
    engine.edit(moved);
    await engine.flush('manual');
    expect(removed).toEqual([PATHS.session(s)]);
    expect(pushed.map((p) => p.path)).toEqual([PATHS.session(s), PATHS.session(moved)]);
  });
});

describe('exposure', () => {
  it('is safe once everything has been accepted', async () => {
    const { sync } = fakeSync();
    const engine = makeEngine({ storage, sync });
    engine.edit(session());
    await engine.flush('manual');
    expect((await engine.exposure()).level).toBe('safe');
  });

  it('is unprotected when sync was never set up, however tidy things look', async () => {
    const { sync } = fakeSync(undefined, { isConfigured: () => false });
    const engine = makeEngine({ storage, sync });
    expect((await engine.exposure()).level).toBe('unprotected');
  });

  it('counts what is waiting once something is pending', async () => {
    const { sync } = fakeSync(async () => {
      throw new Error('offline');
    });
    const engine = makeEngine({ storage, sync });
    engine.edit(session());
    await engine.flush('manual');
    const e = await engine.exposure();
    expect(e.level).toBe('pending');
    expect(e.unsyncedDocuments).toBe(1);
  });
});
