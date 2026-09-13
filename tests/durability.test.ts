import { describe, it, expect } from 'vitest';
import { exposure, AT_RISK_AFTER_MINUTES } from '../src/storage/durability';

const now = new Date('2026-09-13T12:00:00Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60000);

describe('exposure', () => {
  it('is safe only when sync is configured and nothing is pending', () => {
    const e = exposure({ syncConfigured: true, unsyncedDocuments: 0, oldestUnsyncedAt: null, now });
    expect(e.level).toBe('safe');
  });

  it('never reports safe when sync was never set up, however tidy it looks', () => {
    // Zero unsynced documents with nowhere to sync means everything is unsynced.
    const e = exposure({
      syncConfigured: false,
      unsyncedDocuments: 0,
      oldestUnsyncedAt: null,
      now,
    });
    expect(e.level).toBe('unprotected');
    expect(e.message).toMatch(/only copy/);
  });

  it('treats fresh unsynced work as routine', () => {
    const e = exposure({
      syncConfigured: true,
      unsyncedDocuments: 1,
      oldestUnsyncedAt: minutesAgo(5),
      now,
    });
    expect(e.level).toBe('pending');
    expect(e.message).toBe('1 session waiting to back up.');
  });

  it('escalates once unsynced work gets old', () => {
    const e = exposure({
      syncConfigured: true,
      unsyncedDocuments: 3,
      oldestUnsyncedAt: minutesAgo(AT_RISK_AFTER_MINUTES),
      now,
    });
    expect(e.level).toBe('at_risk');
    expect(e.message).toMatch(/3 sessions not backed up for 1h/);
  });

  it('reports the age of the oldest change, not the newest', () => {
    const e = exposure({
      syncConfigured: true,
      unsyncedDocuments: 2,
      oldestUnsyncedAt: minutesAgo(200),
      now,
    });
    expect(e.oldestUnsyncedMinutes).toBe(200);
    expect(e.message).toMatch(/3h/);
  });
});
