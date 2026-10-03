import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { blobSha } from '../src/storage/hash';
import { IndexedDbStore, SupersededError } from '../src/storage/store/indexeddb';
import type { Inflight } from '../src/storage/store/store';
import { clock, storeContract } from './store-contract';

/** A database of its own for each store, so no test sees another's data. */
const fresh = () => `sisyphos-test-${crypto.randomUUID()}`;

storeContract('IndexedDbStore', (options) => IndexedDbStore.open(fresh(), options));

const inflight: Inflight = {
  commit: 'c2',
  tree: 't2',
  parent: 'c1',
  pushed: [{ path: 'a.json', sha: blobSha('x\n'), body: null }],
};

describe('IndexedDbStore', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('finds everything committed after reopening the database', async () => {
    const name = fresh();
    const c = clock();
    const store = await IndexedDbStore.open(name, { now: c.now });
    await store.exclusive((s) =>
      s.apply([
        { op: 'content', path: 'a.json', text: 'x\n' },
        { op: 'base', path: 'lifter/bodyweight.csv', sha: 'b1', body: 'date\n' },
        { op: 'meta', meta: { last_synced_head: 'c1', last_synced_tree: 't1' } },
        { op: 'inflight', inflight },
      ]),
    );
    await store.saveSettings({ owner: 'lifter', repo: 'sisyphos-log', token: 'tok' });
    const before = {
      paths: await store.paths(),
      entries: await store.entries(),
      settings: await store.settings(),
    };
    store.close();

    const reopened = await IndexedDbStore.open(name, { now: c.now });
    expect(await reopened.content('a.json')).toBe('x\n');
    expect(await reopened.paths()).toEqual(before.paths);
    expect(await reopened.entries()).toEqual(before.entries);
    expect(await reopened.meta()).toEqual({ last_synced_head: 'c1', last_synced_tree: 't1' });
    expect(await reopened.inflight()).toEqual(inflight);
    expect(await reopened.settings()).toEqual(before.settings);
  });

  it('generates the device id once, on first open, and keeps it', async () => {
    const name = fresh();
    const first = await IndexedDbStore.open(name);
    const { device_id } = await first.settings();
    expect(device_id).toMatch(/^[0-9a-f-]{36}$/);
    await first.saveSettings({ owner: 'lifter' });
    await first.resetSync();
    first.close();

    const again = await IndexedDbStore.open(name);
    expect((await again.settings()).device_id).toBe(device_id);
    const elsewhere = await IndexedDbStore.open(fresh());
    expect((await elsewhere.settings()).device_id).not.toBe(device_id);
  });

  it('shares one database between two tabs', async () => {
    const name = fresh();
    const [tabA, tabB] = await Promise.all([IndexedDbStore.open(name), IndexedDbStore.open(name)]);
    expect((await tabA.settings()).device_id).toBe((await tabB.settings()).device_id);

    await tabA.exclusive((s) => s.apply([{ op: 'content', path: 'a.json', text: 'from a\n' }]));
    expect(await tabB.content('a.json')).toBe('from a\n');
    expect(await tabB.entry('a.json')).toEqual(await tabA.entry('a.json'));

    await tabB.exclusive((s) =>
      s.apply([
        { op: 'content', path: 'a.json', text: 'from b\n' },
        { op: 'meta', meta: { last_synced_head: 'c1', last_synced_tree: 't1' } },
      ]),
    );
    await tabB.saveSettings({ branch: 'main' });
    expect(await tabA.content('a.json')).toBe('from b\n');
    expect(await tabA.meta()).toEqual({ last_synced_head: 'c1', last_synced_tree: 't1' });
    expect((await tabA.settings()).branch).toBe('main');
  });

  it("never lets another tab's write land between a read and the write it leads to", async () => {
    // Tabs are kept apart by a Web Lock; without one the store assumes one tab.
    expect(globalThis.navigator?.locks, 'Web Locks: needs Node 24.5 or newer').toBeDefined();
    const name = fresh();
    const [tabA, tabB] = await Promise.all([IndexedDbStore.open(name), IndexedDbStore.open(name)]);
    await tabA.exclusive((s) => s.apply([{ op: 'content', path: 'n', text: '0' }]));

    /** Reads the counter, lets time pass, writes it back plus one. */
    const increment = (store: IndexedDbStore) =>
      store.exclusive(async (s) => {
        const n = Number(await s.content('n'));
        await new Promise((r) => setTimeout(r, 5));
        await s.apply([{ op: 'content', path: 'n', text: String(n + 1) }]);
      });
    await Promise.all([increment(tabA), increment(tabB), increment(tabA), increment(tabB)]);
    expect(await tabA.content('n')).toBe('4');
  });

  it('writes nothing when a request fails after the others were made', async () => {
    const c = clock();
    const store = await IndexedDbStore.open(fresh(), { now: c.now });
    await store.exclusive((s) => s.apply([{ op: 'inflight', inflight }]));

    // The in-flight record is the last request `apply` makes. Made with `add`
    // over the record already there, it fails only once the transaction runs
    // it, after every other request has been made.
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      return this.name === 'inflight' ? this.add(value, key) : put.call(this, value, key);
    });

    const next: Inflight = { ...inflight, commit: 'c3' };
    await expect(
      store.exclusive((s) =>
        s.apply([
          { op: 'content', path: 'a.json', text: 'x\n' },
          { op: 'base', path: 'b.json', sha: 'b1' },
          { op: 'meta', meta: { last_synced_head: 'c2', last_synced_tree: 't2' } },
          { op: 'inflight', inflight: next },
        ]),
      ),
    ).rejects.toThrow();
    vi.restoreAllMocks();

    expect(await store.paths()).toEqual([]);
    expect(await store.meta()).toEqual({ last_synced_head: null, last_synced_tree: null });
    expect(await store.inflight()).toEqual(inflight);

    // And the queue carries on.
    await store.exclusive((s) => s.apply([{ op: 'inflight', inflight: next }]));
    expect(await store.inflight()).toEqual(next);
  });

  it('lets a newer version of the app upgrade the database it has open', async () => {
    const name = fresh();
    const store = await IndexedDbStore.open(name);
    await store.exclusive((s) => s.apply([{ op: 'content', path: 'a.json', text: 'x\n' }]));

    // Opening at a higher version waits for every older connection to close.
    const newer = await openDB(name, 2);
    expect(newer.version).toBe(2);
    expect([...newer.objectStoreNames]).toContain('content');
    expect((await newer.get('content', 'a.json'))?.text).toBe('x\n');
    newer.close();
    // Not reopened at the old version it can no longer read: told to reload.
    await expect(store.content('a.json')).rejects.toThrow(SupersededError);
    await expect(
      store.exclusive((s) => s.apply([{ op: 'content', path: 'b.json', text: 'y\n' }])),
    ).rejects.toThrow(SupersededError);
  });

  it('reopens a connection the browser closed, for reads and for writes', async () => {
    const name = fresh();
    const store = await IndexedDbStore.open(name);
    await store.exclusive((s) => s.apply([{ op: 'content', path: 'a.json', text: 'x\n' }]));

    // What older iOS Safari does to a backgrounded app: the connection is closed
    // under the store, and every transaction on it is refused.
    const underneath = (store as unknown as { db: { close(): void } }).db;
    underneath.close();
    expect(await store.content('a.json')).toBe('x\n');

    (store as unknown as { db: { close(): void } }).db.close();
    await store.exclusive((s) => s.apply([{ op: 'content', path: 'b.json', text: 'y\n' }]));
    expect(await store.content('b.json')).toBe('y\n');
    expect((await store.entry('b.json'))?.local_sha).toBe(blobSha('y\n'));
  });
});
