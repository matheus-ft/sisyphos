import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { FormatError } from '../src/storage/errors';
import { parseConflict } from '../src/storage/formats';
import { startStorage, type ClosableStore } from '../src/storage/app';
import { blobSha } from '../src/storage/hash';
import { conflictPath, RETIRED_PATHS } from '../src/storage/paths';
import { MemoryRemote } from '../src/storage/remote/memory';
import { retire } from '../src/storage/retire';
import { IndexedDbStore } from '../src/storage/store/indexeddb';
import { MemoryStore } from '../src/storage/store/memory';
import type { LocalStore } from '../src/storage/store/store';

/**
 * What an earlier build left on a device after a kind was retired (retire.ts):
 * the competition bests table, and a conflict record about it. Neither may stop
 * the app from opening, or leave a change that never backs up.
 */

const BESTS = RETIRED_PATHS[0];
const BESTS_TEXT = 'date,exercise_id,weight_kg,meet\n2026-05-16,bench,120,Nationals 2026\n';
const BODYWEIGHT = 'lifter/bodyweight.csv';
const WEIGHTS = 'date,weight_kg,source\n2026-09-01,80,manual\n';

const about = (path: string) =>
  JSON.stringify({
    id: '2026-09-27-7xq2',
    path,
    key: { date: '2026-05-16', exercise_id: 'bench' },
    found_at: '2026-09-27T10:00:00.000Z',
    device_id: 'phone',
    version: { date: '2026-05-16', exercise_id: 'bench', weight_kg: '125', meet: '' },
  });

const BACKENDS: Array<[string, () => Promise<LocalStore>]> = [
  ['MemoryStore', async () => new MemoryStore()],
  ['IndexedDbStore', () => IndexedDbStore.open(`sisyphos-retire-${crypto.randomUUID()}`)],
];

describe('the retired competition bests table', () => {
  it('has a conflict record this build cannot read, which is why it must go', () => {
    expect(() => parseConflict(about(BESTS))).toThrow(FormatError);
  });
});

describe.each(BACKENDS)('retiring what is left on a %s', (_name, open) => {
  /** A device that last synced the table, and has since changed it. */
  async function device() {
    const store = await open();
    await store.exclusive((s) =>
      s.apply([
        { op: 'content', path: BODYWEIGHT, text: WEIGHTS },
        { op: 'base', path: BODYWEIGHT, sha: blobSha(WEIGHTS), body: WEIGHTS },
        { op: 'content', path: BESTS, text: BESTS_TEXT },
        { op: 'base', path: BESTS, sha: blobSha('older\n'), body: 'older\n' },
        { op: 'content', path: conflictPath('2026-09-27-7xq2'), text: about(BESTS) },
      ]),
    );
    return store;
  }

  it('drops the file with its sync entry, so it is neither read nor waiting to back up', async () => {
    const store = await device();
    await retire(store);
    expect(await store.content(BESTS)).toBeNull();
    expect(await store.entry(BESTS)).toBeNull();
    expect(await store.paths()).not.toContain(BESTS);
  });

  it('drops a conflict record about it, keeping its base so the deletion syncs', async () => {
    const store = await device();
    const path = conflictPath('2026-09-27-7xq2');
    await store.exclusive((s) => s.apply([{ op: 'base', path, sha: blobSha(about(BESTS)) }]));
    await retire(store);
    expect(await store.content(path)).toBeNull();
    // Still an entry, local gone and base held: the next sync deletes it from the log, as resolving would.
    expect(await store.entry(path)).toMatchObject({
      local_sha: null,
      base_sha: blobSha(about(BESTS)),
    });
  });

  it('leaves every other file, and conflicts about anything else, alone', async () => {
    const store = await device();
    const other = conflictPath('2026-09-28-aaaa');
    const kept = about(BODYWEIGHT).replace('2026-05-16', '2026-09-01');
    await store.exclusive((s) => s.apply([{ op: 'content', path: other, text: kept }]));
    const before = await store.entry(BODYWEIGHT);
    await retire(store);
    expect(await store.content(BODYWEIGHT)).toBe(WEIGHTS);
    expect(await store.entry(BODYWEIGHT)).toEqual(before);
    expect(await store.content(other)).toBe(kept);
  });

  it('leaves a conflict record it cannot read, rather than guess', async () => {
    const store = await open();
    const path = conflictPath('2026-09-27-bbbb');
    await store.exclusive((s) => s.apply([{ op: 'content', path, text: '{"path": ' }]));
    await retire(store);
    expect(await store.content(path)).toBe('{"path": ');
  });

  it('is a no-op on a device that holds none, and when run twice', async () => {
    const store = await open();
    await store.exclusive((s) => s.apply([{ op: 'content', path: BODYWEIGHT, text: WEIGHTS }]));
    const before = await store.entries();
    await retire(store);
    await retire(store);
    expect(await store.entries()).toEqual(before);

    const left = await device();
    await retire(left);
    const once = await left.entries();
    await retire(left);
    expect(await left.entries()).toEqual(once);
  });
});

describe('opening the app over such a device', () => {
  const window = () => {
    const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    return Object.assign(new EventTarget(), { document }) as unknown as Window;
  };

  async function launch(store: MemoryStore) {
    return startStorage({
      target: window(),
      openStore: async (): Promise<ClosableStore> => Object.assign(store, { close: () => {} }),
      makeRemote: () => new MemoryRemote(),
      shipped: [],
    });
  }

  async function leftover() {
    const store = new MemoryStore();
    await store.exclusive((s) =>
      s.apply([
        { op: 'content', path: BESTS, text: BESTS_TEXT },
        { op: 'content', path: conflictPath('2026-09-27-7xq2'), text: about(BESTS) },
      ]),
    );
    return store;
  }

  it('starts, with no conflict to settle and nothing waiting to back up', async () => {
    const storage = await launch(await leftover());
    expect(await storage.log.getConflicts()).toEqual([]);
    const status = await storage.scheduler.status();
    expect(status.conflicts).toBe(0);
    expect(status.exposure.unsyncedDocuments).toBe(0);
    expect(await storage.store.content(BESTS)).toBeNull();
    storage.dispose();
  });

  it('counts only the app’s own files as waiting to back up, whatever else is on the device', async () => {
    const storage = await launch(new MemoryStore());
    await storage.store.exclusive((s) =>
      s.apply([{ op: 'content', path: BESTS, text: BESTS_TEXT }]),
    );
    expect((await storage.scheduler.status()).exposure.unsyncedDocuments).toBe(0);
    await storage.store.exclusive((s) =>
      s.apply([{ op: 'content', path: BODYWEIGHT, text: WEIGHTS }]),
    );
    expect((await storage.scheduler.status()).exposure.unsyncedDocuments).toBe(1);
    storage.dispose();
  });
});
