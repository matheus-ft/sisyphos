import { describe, it, expect } from 'vitest';
import { MemoryStore } from '../src/storage/store/memory';
import { storeContract } from './store-contract';

storeContract('MemoryStore', async (options) => new MemoryStore(options));

describe('MemoryStore', () => {
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

  it('shares nothing with the instance it was restarted from', async () => {
    const store = new MemoryStore();
    const revived = store.restart();
    await revived.exclusive((s) => s.apply([{ op: 'content', path: 'a.json', text: 'x\n' }]));
    expect(await store.content('a.json')).toBeNull();
  });
});
