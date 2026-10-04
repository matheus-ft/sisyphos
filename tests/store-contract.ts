import { describe, it, expect } from 'vitest';
import { blobSha } from '../src/storage/hash';
import type { Inflight, LocalStore } from '../src/storage/store/store';

/**
 * The store contract (`src/storage/store/store.ts`), written once and run
 * against every store: `MemoryStore` stands in for the device in the sync's
 * tests, so anything it does that `IndexedDbStore` does not would pass there
 * and fail on a phone.
 */

export type StoreFactory = (options: { now?: () => Date }) => Promise<LocalStore>;

export function clock(start = '2026-09-27T10:00:00.000Z') {
  let t = Date.parse(start);
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
}

const T0 = '2026-09-27T10:00:00.000Z';
const T1 = '2026-09-27T10:01:00.000Z';

const inflight: Inflight = {
  commit: 'c2',
  tree: 't2',
  parent: 'c1',
  pushed: [
    { path: 'a.json', sha: blobSha('x\n'), body: null },
    { path: 'lifter/bodyweight.csv', sha: null, body: 'date\n' },
  ],
};

export function storeContract(name: string, make: StoreFactory): void {
  describe(`${name}: the store contract`, () => {
    it('tracks local content against its base by hash', async () => {
      const c = clock();
      const store = await make({ now: c.now });
      await store.exclusive((s) => s.apply([{ op: 'content', path: 'a.json', text: 'one\n' }]));

      const e = await store.entry('a.json');
      expect(e).toEqual({
        path: 'a.json',
        local_sha: blobSha('one\n'),
        base_sha: null,
        unsynced_since: T0,
        base_body: null,
      });
      expect(await store.content('a.json')).toBe('one\n');

      await store.exclusive((s) =>
        s.apply([{ op: 'base', path: 'a.json', sha: blobSha('one\n') }]),
      );
      expect(await store.entry('a.json')).toMatchObject({ unsynced_since: null });
    });

    it('keeps the first divergence time while a path stays unsynced', async () => {
      const c = clock();
      const store = await make({ now: c.now });
      await store.exclusive((s) => s.apply([{ op: 'content', path: 'a.json', text: 'one\n' }]));
      c.advance(60_000);
      await store.exclusive((s) => s.apply([{ op: 'content', path: 'a.json', text: 'two\n' }]));
      expect((await store.entry('a.json'))?.unsynced_since).toBe(T0);
    });

    it('keeps the first divergence time when the base moves and the path stays unsynced', async () => {
      // A sync that takes some of the remote's rows moves the base, but the
      // device's own change is still unsynced: it is as old as it was, and
      // exposure must not report it as new.
      const c = clock();
      const store = await make({ now: c.now });
      await store.exclusive((s) =>
        s.apply([
          { op: 'content', path: 'a.json', text: 'one\n' },
          { op: 'base', path: 'a.json', sha: blobSha('one\n') },
        ]),
      );
      await store.exclusive((s) => s.apply([{ op: 'content', path: 'a.json', text: 'mine\n' }]));
      expect((await store.entry('a.json'))?.unsynced_since).toBe(T0);

      c.advance(60_000);
      await store.exclusive((s) =>
        s.apply([{ op: 'base', path: 'a.json', sha: blobSha('theirs\n') }]),
      );
      expect(await store.entry('a.json')).toMatchObject({
        base_sha: blobSha('theirs\n'),
        local_sha: blobSha('mine\n'),
        unsynced_since: T0,
      });
    });

    it('clears the divergence time when content returns to its base, and restarts it after', async () => {
      const c = clock();
      const store = await make({ now: c.now });
      await store.exclusive((s) =>
        s.apply([
          { op: 'content', path: 'a.json', text: 'one\n' },
          { op: 'base', path: 'a.json', sha: blobSha('one\n') },
        ]),
      );
      await store.exclusive((s) => s.apply([{ op: 'content', path: 'a.json', text: 'two\n' }]));
      expect((await store.entry('a.json'))?.unsynced_since).toBe(T0);

      c.advance(60_000);
      await store.exclusive((s) => s.apply([{ op: 'content', path: 'a.json', text: 'one\n' }]));
      expect((await store.entry('a.json'))?.unsynced_since).toBeNull();

      await store.exclusive((s) => s.apply([{ op: 'content', path: 'a.json', text: 'three\n' }]));
      expect((await store.entry('a.json'))?.unsynced_since).toBe(T1);
    });

    it('drops an entry that has neither content nor base', async () => {
      const store = await make({});
      await store.exclusive((s) => s.apply([{ op: 'content', path: 'a.json', text: 'x\n' }]));
      await store.exclusive((s) => s.apply([{ op: 'content', path: 'a.json', text: null }]));
      expect(await store.entry('a.json')).toBeNull();
      expect(await store.content('a.json')).toBeNull();
      expect(await store.paths()).toEqual([]);
      expect(await store.entries()).toEqual([]);
    });

    it('keeps a deleted path that has a base, as needing sync', async () => {
      const c = clock();
      const store = await make({ now: c.now });
      await store.exclusive((s) =>
        s.apply([
          { op: 'content', path: 'a.json', text: 'x\n' },
          { op: 'base', path: 'a.json', sha: blobSha('x\n') },
        ]),
      );
      c.advance(60_000);
      await store.exclusive((s) => s.apply([{ op: 'content', path: 'a.json', text: null }]));
      expect(await store.content('a.json')).toBeNull();
      expect(await store.entry('a.json')).toEqual({
        path: 'a.json',
        base_sha: blobSha('x\n'),
        local_sha: null,
        unsynced_since: T1,
        base_body: null,
      });
      expect(await store.paths()).toEqual(['a.json']);
    });

    it('keeps a base with no content, and a table base body', async () => {
      const store = await make({});
      await store.exclusive((s) =>
        s.apply([
          { op: 'base', path: 'lifter/bodyweight.csv', sha: 'b1', body: 'date\n' },
          { op: 'base', path: 'b.json', sha: 'b2', body: undefined },
        ]),
      );
      expect(await store.entry('lifter/bodyweight.csv')).toEqual({
        path: 'lifter/bodyweight.csv',
        base_sha: 'b1',
        local_sha: null,
        unsynced_since: expect.any(String),
        base_body: 'date\n',
      });
      expect((await store.entry('b.json'))?.base_body).toBeNull();

      // Content does not touch the base body; moving the base replaces it.
      await store.exclusive((s) =>
        s.apply([{ op: 'content', path: 'lifter/bodyweight.csv', text: 'x\n' }]),
      );
      expect((await store.entry('lifter/bodyweight.csv'))?.base_body).toBe('date\n');
      await store.exclusive((s) =>
        s.apply([{ op: 'base', path: 'lifter/bodyweight.csv', sha: blobSha('x\n') }]),
      );
      expect(await store.entry('lifter/bodyweight.csv')).toMatchObject({
        base_body: null,
        unsynced_since: null,
      });
    });

    it('applies ops in order, each seeing the ones before it', async () => {
      const c = clock();
      const store = await make({ now: c.now });
      await store.exclusive((s) =>
        s.apply([
          { op: 'content', path: 'a.json', text: 'one\n' },
          { op: 'base', path: 'a.json', sha: blobSha('one\n') },
          { op: 'content', path: 'b.json', text: 'x\n' },
          { op: 'content', path: 'b.json', text: null },
          { op: 'content', path: 'c.json', text: 'first\n' },
          { op: 'content', path: 'c.json', text: 'second\n' },
          { op: 'meta', meta: { last_synced_head: 'c0', last_synced_tree: 't0' } },
          { op: 'meta', meta: { last_synced_head: 'c1', last_synced_tree: 't1' } },
          { op: 'inflight', inflight },
          { op: 'inflight', inflight: null },
        ]),
      );
      expect(await store.entry('a.json')).toMatchObject({
        base_sha: blobSha('one\n'),
        local_sha: blobSha('one\n'),
        unsynced_since: null,
      });
      expect(await store.entry('b.json')).toBeNull();
      expect(await store.content('c.json')).toBe('second\n');
      expect(await store.entry('c.json')).toMatchObject({ local_sha: blobSha('second\n') });
      expect(await store.meta()).toEqual({ last_synced_head: 'c1', last_synced_tree: 't1' });
      expect(await store.inflight()).toBeNull();
    });

    it('lists every path with content or an entry, sorted, and entries by path', async () => {
      const store = await make({});
      await store.exclusive((s) =>
        s.apply([
          { op: 'content', path: 'sessions/2026/2026-09-14-k3f9.json', text: 's\n' },
          { op: 'base', path: 'conflicts/2026-09-27-7xq2.json', sha: 'b1' },
          { op: 'content', path: 'lifter/bodyweight.csv', text: 'date\n' },
          { op: 'content', path: 'Z.json', text: 'z\n' },
        ]),
      );
      const all = [
        'Z.json',
        'conflicts/2026-09-27-7xq2.json',
        'lifter/bodyweight.csv',
        'sessions/2026/2026-09-14-k3f9.json',
      ];
      expect(await store.paths()).toEqual(all);
      // Entries in the same plain code-unit order as paths.
      expect((await store.entries()).map((e) => e.path)).toEqual(all);
      // Every path's local sha is its content's blob sha.
      for (const e of await store.entries()) {
        const text = await store.content(e.path);
        expect(e.local_sha).toBe(text === null ? null : blobSha(text));
      }
    });

    it('keeps sync meta and the in-flight commit', async () => {
      const store = await make({});
      expect(await store.meta()).toEqual({ last_synced_head: null, last_synced_tree: null });
      expect(await store.inflight()).toBeNull();

      await store.exclusive((s) =>
        s.apply([
          { op: 'meta', meta: { last_synced_head: 'c1', last_synced_tree: 't1' } },
          { op: 'inflight', inflight },
        ]),
      );
      expect(await store.meta()).toEqual({ last_synced_head: 'c1', last_synced_tree: 't1' });
      expect(await store.inflight()).toEqual(inflight);

      await store.exclusive((s) => s.apply([{ op: 'inflight', inflight: null }]));
      expect(await store.inflight()).toBeNull();
      expect(await store.meta()).toEqual({ last_synced_head: 'c1', last_synced_tree: 't1' });
    });

    it('hands out copies, and keeps none of what it was given', async () => {
      const store = await make({});
      const given = structuredClone(inflight);
      const meta = { last_synced_head: 'c1', last_synced_tree: 't1' };
      await store.exclusive((s) =>
        s.apply([
          { op: 'content', path: 'a.json', text: 'x\n' },
          { op: 'meta', meta },
          { op: 'inflight', inflight: given },
        ]),
      );
      given.pushed[0].path = 'changed';
      meta.last_synced_head = 'changed';

      const read = await store.inflight();
      read!.pushed.push({ path: 'more', sha: null, body: null });
      const entry = await store.entry('a.json');
      entry!.base_sha = 'changed';
      (await store.entries())[0].base_sha = 'changed';
      (await store.meta()).last_synced_tree = 'changed';

      expect(await store.inflight()).toEqual(inflight);
      expect(await store.meta()).toEqual({ last_synced_head: 'c1', last_synced_tree: 't1' });
      expect((await store.entry('a.json'))?.base_sha).toBeNull();
    });

    it('applies all ops or none', async () => {
      const store = await make({});
      const bad = { op: 'bogus' } as never;
      await expect(
        store.exclusive((s) => s.apply([{ op: 'content', path: 'a.json', text: 'x\n' }, bad])),
      ).rejects.toThrow();
      expect(await store.content('a.json')).toBeNull();
      expect(await store.entry('a.json')).toBeNull();
    });

    it('applies nothing when an op fails after others were made', async () => {
      const store = await make({});
      await store.exclusive((s) =>
        s.apply([{ op: 'meta', meta: { last_synced_head: 'c1', last_synced_tree: 't1' } }]),
      );
      // A function cannot be stored. It is the last op, so every other change
      // has been made by the time it fails.
      const unstorable = { ...inflight, extra: () => 1 } as Inflight;
      await expect(
        store.exclusive((s) =>
          s.apply([
            { op: 'content', path: 'a.json', text: 'x\n' },
            { op: 'base', path: 'b.json', sha: 'b1' },
            { op: 'meta', meta: { last_synced_head: 'c2', last_synced_tree: 't2' } },
            { op: 'inflight', inflight: unstorable },
          ]),
        ),
      ).rejects.toThrow();
      expect(await store.paths()).toEqual([]);
      expect(await store.meta()).toEqual({ last_synced_head: 'c1', last_synced_tree: 't1' });
      expect(await store.inflight()).toBeNull();
    });

    it('does nothing for an empty apply', async () => {
      const store = await make({});
      await store.exclusive((s) => s.apply([]));
      expect(await store.paths()).toEqual([]);
    });

    it('runs exclusive callbacks one at a time, in order', async () => {
      const store = await make({});
      const order: string[] = [];
      const slow = store.exclusive(async () => {
        order.push('slow start');
        await new Promise((r) => setTimeout(r, 10));
        order.push('slow end');
      });
      const fast = store.exclusive(async () => {
        order.push('fast');
      });
      const last = store.exclusive(async () => {
        order.push('last');
      });
      await Promise.all([slow, fast, last]);
      expect(order).toEqual(['slow start', 'slow end', 'fast', 'last']);
    });

    it("resolves with the callback's value once what it applied is readable", async () => {
      const store = await make({});
      const value = await store.exclusive(async (s) => {
        await s.apply([{ op: 'content', path: 'a.json', text: 'x\n' }]);
        return (await s.content('a.json'))?.length;
      });
      expect(value).toBe(2);
      expect(await store.content('a.json')).toBe('x\n');
    });

    it('keeps going after a failed exclusive callback', async () => {
      const store = await make({});
      await expect(
        store.exclusive(async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      await expect(store.exclusive((s) => s.apply([{ op: 'bogus' } as never]))).rejects.toThrow();
      await store.exclusive((s) => s.apply([{ op: 'content', path: 'a.json', text: 'x\n' }]));
      expect(await store.content('a.json')).toBe('x\n');
    });

    it('has a device id and no repo until settings are saved', async () => {
      const store = await make({});
      const settings = await store.settings();
      expect(settings).toEqual({
        owner: null,
        repo: null,
        branch: null,
        repo_id: null,
        token: null,
        device_id: expect.stringMatching(/.+/),
      });

      await store.saveSettings({ owner: 'lifter', repo: 'sisyphos-log', token: 'tok' });
      await store.saveSettings({ branch: 'main', repo_id: 861234567, token: 'tok2' });
      expect(await store.settings()).toEqual({
        owner: 'lifter',
        repo: 'sisyphos-log',
        branch: 'main',
        repo_id: 861234567,
        token: 'tok2',
        device_id: settings.device_id,
      });
    });

    it('forgets every base on resetSync, keeping content', async () => {
      const c = clock();
      const store = await make({ now: c.now });
      await store.exclusive((s) =>
        s.apply([
          { op: 'content', path: 'a.json', text: 'x\n' },
          { op: 'base', path: 'a.json', sha: blobSha('x\n') },
          { op: 'base', path: 'gone.json', sha: 'abc' },
          { op: 'content', path: 't.csv', text: 'date\n' },
          { op: 'base', path: 't.csv', sha: 'b1', body: 'date\n' },
          { op: 'meta', meta: { last_synced_head: 'c1', last_synced_tree: 't1' } },
          { op: 'inflight', inflight },
        ]),
      );
      c.advance(60_000);
      await store.resetSync();
      expect(await store.entry('a.json')).toEqual({
        path: 'a.json',
        base_sha: null,
        local_sha: blobSha('x\n'),
        unsynced_since: T1,
        base_body: null,
      });
      expect(await store.entry('t.csv')).toMatchObject({ base_sha: null, base_body: null });
      expect(await store.entry('gone.json')).toBeNull();
      expect(await store.paths()).toEqual(['a.json', 't.csv']);
      expect(await store.content('a.json')).toBe('x\n');
      expect(await store.meta()).toEqual({ last_synced_head: null, last_synced_tree: null });
      expect(await store.inflight()).toBeNull();
    });
  });
}
