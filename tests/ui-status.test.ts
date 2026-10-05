import { describe, expect, it } from 'vitest';
import type { StatusSnapshot } from '../src/storage/status';
import { bannerOf } from '../src/ui/status';

const snapshot = (over: Partial<StatusSnapshot>): StatusSnapshot => ({
  status: 'idle',
  nextRetryAt: null,
  message: null,
  conflicts: 0,
  libraryConflicts: 0,
  unreadable: [],
  exposure: {
    level: 'safe',
    unsyncedDocuments: 0,
    oldestUnsyncedMinutes: null,
    message: 'Everything is backed up.',
  },
  ...over,
});

const atRisk = {
  level: 'at_risk' as const,
  unsyncedDocuments: 3,
  oldestUnsyncedMinutes: 90,
  message: '3 changes are only on this phone.',
};

describe('the banner on every screen', () => {
  it('is absent while everything is in the log', () => {
    expect(bannerOf(snapshot({}), false)).toBeNull();
  });

  it('announces conflicts first, sessions and exercises together, and leads to them', () => {
    expect(
      bannerOf(snapshot({ conflicts: 1, libraryConflicts: 1, status: 'offline' }), false),
    ).toEqual({
      kind: 'conflict',
      text: '2 conflicts to settle',
      action: { label: 'Review', to: 'conflicts' },
    });
    expect(bannerOf(snapshot({ conflicts: 1 }), false)?.text).toBe('1 conflict to settle');
  });

  it('announces only conflicts during a session', () => {
    expect(bannerOf(snapshot({ conflicts: 1 }), true)?.kind).toBe('conflict');
    expect(bannerOf(snapshot({ status: 'offline' }), true)).toBeNull();
    expect(bannerOf(snapshot({ exposure: atRisk }), true)).toBeNull();
  });

  it('says why sync stopped, and leads to the sync page to fix it', () => {
    expect(
      bannerOf(snapshot({ status: 'needs_token', message: 'Paste a new token.' }), false),
    ).toEqual({ kind: 'info', text: 'Paste a new token.', action: { label: 'Fix', to: 'sync' } });
  });

  it('says that sets still save while offline', () => {
    expect(bannerOf(snapshot({ status: 'retrying' }), false)).toEqual({
      kind: 'offline',
      text: 'Offline. Sets save here and sync later.',
      action: null,
    });
  });

  it('warns of work only on this phone for too long', () => {
    expect(bannerOf(snapshot({ exposure: atRisk }), false)).toEqual({
      kind: 'info',
      text: '3 changes are only on this phone.',
      action: { label: 'Sync', to: 'sync' },
    });
  });

  it('leaves a device never set up to say so in Agora', () => {
    expect(bannerOf(snapshot({ status: 'not_set_up', exposure: atRisk }), false)).toBeNull();
  });
});
