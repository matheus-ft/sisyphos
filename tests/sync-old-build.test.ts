import { describe, expect, it, vi } from 'vitest';
import { FORMAT_PATH, FORMAT_VERSION } from '../src/storage/paths';
import { MemoryRemote } from '../src/storage/remote/memory';
import { Device, failure, lifted } from './sync-harness';
import { sessionV1 } from './format1';

/**
 * The build before format 2, which phones still run until they update: the
 * same sync with format 1 as the newest it knows. It must stop at a migrated
 * log, change nothing on either side, and leave its own changes on the device,
 * where the update finds them (sync-migration.test.ts).
 */
vi.mock('../src/storage/paths', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/storage/paths')>()),
  FORMAT_VERSION: 1,
}));

describe('a format-1 build', () => {
  it('stops at a log migrated to format 2 and asks to be updated, keeping its changes', async () => {
    expect(FORMAT_VERSION).toBe(1);
    const remote = new MemoryRemote();
    remote.externalCommit([{ path: FORMAT_PATH, content: '{\n  "format": 2\n}\n' }]);
    const head = await remote.head();

    const old = new Device(remote, 'old-phone');
    const path = 'sessions/2026/2026-09-14-aaaa.json';
    await old.write(path, sessionV1(lifted('2026-09-14-aaaa', 'logged on the old build')));
    const entries = await old.disk.entries();

    expect(await failure(old.sync())).toBe('update');
    expect(await remote.head()).toBe(head);
    expect(await old.disk.entries()).toEqual(entries);
    expect((await old.disk.entry(path))?.unsynced_since).not.toBeNull();
  });
});
