import { describe, it, expect } from 'vitest';
import { exposure, AT_RISK_AFTER_MINUTES, type ExposureInput } from '../src/storage/durability';

const now = new Date('2026-09-13T12:00:00Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60000).toISOString();

type Entry = ExposureInput['entries'][number];

/** A path this device changed `m` minutes ago that the remote does not have yet. */
const unsynced = (m: number): Entry => ({
  local_sha: 'new',
  base_sha: 'old',
  unsynced_since: minutesAgo(m),
});
/** A path the device and the remote agree on. */
const synced: Entry = { local_sha: 'same', base_sha: 'same', unsynced_since: null };

function input(overrides: Partial<ExposureInput>): ExposureInput {
  return { syncConfigured: true, entries: [], sessionInProgress: false, now, ...overrides };
}

describe('exposure', () => {
  it('is safe only when sync is configured and nothing needs syncing', () => {
    const e = exposure(input({ entries: [synced, synced] }));
    expect(e).toMatchObject({ level: 'safe', unsyncedDocuments: 0, oldestUnsyncedMinutes: null });
    expect(e.message).toBe('Everything is backed up.');
  });

  it('never reports safe when sync was never set up, however tidy it looks', () => {
    // Zero unsynced changes with nowhere to sync means everything is unsynced.
    const e = exposure(input({ syncConfigured: false }));
    expect(e.level).toBe('unprotected');
    expect(e.message).toMatch(/only copy/);
  });

  it('stays unprotected during a session: the cap is for a paused sync, not a missing one', () => {
    const e = exposure(
      input({ syncConfigured: false, entries: [unsynced(5)], sessionInProgress: true }),
    );
    expect(e.level).toBe('unprotected');
    expect(e.unsyncedDocuments).toBe(1);
  });

  it('counts the paths whose local version differs from their base, including deletions', () => {
    const deleted: Entry = { local_sha: null, base_sha: 'old', unsynced_since: minutesAgo(1) };
    const created: Entry = { local_sha: 'new', base_sha: null, unsynced_since: minutesAgo(2) };
    const e = exposure(input({ entries: [synced, deleted, created, unsynced(3)] }));
    expect(e.unsyncedDocuments).toBe(3);
  });

  it('treats fresh unsynced changes as routine', () => {
    const e = exposure(input({ entries: [unsynced(5)] }));
    expect(e.level).toBe('pending');
    expect(e.message).toBe('1 change waiting to back up.');
  });

  it('escalates once unsynced changes get old', () => {
    const e = exposure(
      input({ entries: [unsynced(AT_RISK_AFTER_MINUTES), unsynced(1), unsynced(2)] }),
    );
    expect(e.level).toBe('at_risk');
    expect(e.message).toBe(
      '3 changes not backed up for 1h. Check your connection, or back up now.',
    );
  });

  it('is still pending a minute before that', () => {
    const e = exposure(input({ entries: [unsynced(AT_RISK_AFTER_MINUTES - 1)] }));
    expect(e.level).toBe('pending');
  });

  it('reports the age of the oldest change, not the newest', () => {
    const e = exposure(input({ entries: [unsynced(5), unsynced(200), unsynced(30)] }));
    expect(e.oldestUnsyncedMinutes).toBe(200);
    expect(e.message).toMatch(/3h/);
  });

  it('is at most pending while a session is in progress, however old the changes', () => {
    const e = exposure(input({ entries: [unsynced(600), unsynced(1)], sessionInProgress: true }));
    expect(e.level).toBe('pending');
    expect(e.oldestUnsyncedMinutes).toBe(600);
    expect(e.message).toBe('2 changes waiting to back up when you end the session.');
  });

  it('is safe during a session when nothing here needs syncing', () => {
    // A session in progress on another device, pulled here: this phone holds nothing new.
    const e = exposure(input({ entries: [synced], sessionInProgress: true }));
    expect(e.level).toBe('safe');
  });
});
