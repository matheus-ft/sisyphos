import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../src/storage/store/memory';
import { blobSha } from '../src/storage/hash';

function clock(start = '2026-09-27T10:00:00.000Z') {
  let t = Date.parse(start);
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
}

describe('MemoryStore', () => {
  it('tracks local content against its base by hash', async () => {
    const c = clock();
    const store = new MemoryStore({ now: c.now });
    await store.exclusive((s) => s.apply([{ op: 'content', path: 'a.json', text: 'one\n' }]));

    const e = await store.entry('a.json');
    expect(e).toMatchObject({ local_sha: blobSha('one\n'), base_sha: null });
    expect(e?.unsynced_since).toBe('2026-09-27T10:00:00.000Z');

    await store.exclusive((s) => s.apply([{ op: 'base', path: 'a.json', sha: blobSha('one\n') }]));
    expect(await store.entry('a.json')).toMatchObject({ unsynced_since: null });
  });

  it('keeps the first divergence time while a path stays unsynced', async () => {
    const c = clock();
    const store = new MemoryStore({ now: c.now });
    await store.exclusive((s) => s.apply([{ op: 'content', path: 'a.json', text: 'one\n' }]));
    c.advance(60_000);
    await store.exclusive((s) => s.apply([{ op: 'content', path: 'a.json', text: 'two\n' }]));
    expect((await store.entry('a.json'))?.unsynced_since).toBe('2026-09-27T10:00:00.000Z');
  });

  it('drops an entry that has neither content nor base', async () => {
    const store = new MemoryStore();
    await store.exclusive((s) => s.apply([{ op: 'content', path: 'a.json', text: 'x\n' }]));
    await store.exclusive((s) => s.apply([{ op: 'content', path: 'a.json', text: null }]));
    expect(await store.entry('a.json')).toBeNull();
    expect(await store.paths()).toEqual([]);
  });

  it('applies all ops or none', async () => {
    const store = new MemoryStore();
    const bad = { op: 'bogus' } as never;
    await expect(
      store.exclusive((s) => s.apply([{ op: 'content', path: 'a.json', text: 'x\n' }, bad])),
    ).rejects.toThrow();
    expect(await store.content('a.json')).toBeNull();
  });

  it('runs exclusive callbacks one at a time, in order', async () => {
    const store = new MemoryStore();
    const order: string[] = [];
    const slow = store.exclusive(async () => {
      order.push('slow start');
      await new Promise((r) => setTimeout(r, 10));
      order.push('slow end');
    });
    const fast = store.exclusive(async () => {
      order.push('fast');
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(['slow start', 'slow end', 'fast']);
  });

  it('keeps going after a failed exclusive callback', async () => {
    const store = new MemoryStore();
    await expect(
      store.exclusive(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await store.exclusive((s) => s.apply([{ op: 'content', path: 'a.json', text: 'x\n' }]));
    expect(await store.content('a.json')).toBe('x\n');
  });

  it('survives a restart with everything that was applied', async () => {
    const store = new MemoryStore({ deviceId: 'dev-1' });
    await store.exclusive((s) =>
      s.apply([
        { op: 'content', path: 'a.json', text: 'x\n' },
        { op: 'meta', meta: { last_synced_head: 'c1', last_synced_tree: 't1' } },
      ]),
    );
    const revived = store.restart();
    expect(await revived.content('a.json')).toBe('x\n');
    expect(await revived.meta()).toEqual({ last_synced_head: 'c1', last_synced_tree: 't1' });
    expect((await revived.settings()).device_id).toBe('dev-1');
  });

  it('forgets every base on resetSync, keeping content', async () => {
    const store = new MemoryStore();
    await store.exclusive((s) =>
      s.apply([
        { op: 'content', path: 'a.json', text: 'x\n' },
        { op: 'base', path: 'a.json', sha: blobSha('x\n') },
        { op: 'base', path: 'gone.json', sha: 'abc' },
        { op: 'meta', meta: { last_synced_head: 'c1', last_synced_tree: 't1' } },
      ]),
    );
    await store.resetSync();
    expect(await store.entry('a.json')).toMatchObject({
      base_sha: null,
      local_sha: blobSha('x\n'),
    });
    expect(await store.entry('gone.json')).toBeNull();
    expect(await store.meta()).toEqual({ last_synced_head: null, last_synced_tree: null });
  });
});
