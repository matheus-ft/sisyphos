import { describe, it, expect } from 'vitest';
import { SyncError } from '../src/storage/errors';
import { describeSync, type SyncState } from '../src/storage/status';

const retryAt = new Date('2026-09-27T10:00:30.000Z');

function state(overrides: Partial<SyncState>): SyncState {
  return {
    setUp: true,
    syncing: false,
    failure: null,
    nextRetryAt: null,
    sessionInProgress: false,
    ...overrides,
  };
}

/** How the GitHub adapter reports a request that never got an answer. */
const noConnection = () =>
  new SyncError('retryable', 'Could not reach GitHub', { cause: new TypeError('Failed to fetch') });

describe('describeSync', () => {
  it('says not set up whatever else is going on', () => {
    for (const failure of [null, noConnection(), new SyncError('token', 'Bad token')]) {
      expect(describeSync(state({ setUp: false, failure, syncing: true }))).toEqual({
        status: 'not_set_up',
        nextRetryAt: null,
        message: null,
      });
    }
  });

  it('says syncing while a sync runs, whatever the last one did', () => {
    const d = describeSync(state({ syncing: true, failure: noConnection(), nextRetryAt: retryAt }));
    expect(d).toEqual({ status: 'syncing', nextRetryAt: null, message: null });
  });

  it('is idle, with nothing to say, once a sync has succeeded', () => {
    expect(describeSync(state({}))).toEqual({ status: 'idle', nextRetryAt: null, message: null });
  });

  it('says offline when the last failure was the network, with the next attempt', () => {
    const d = describeSync(state({ failure: noConnection(), nextRetryAt: retryAt }));
    expect(d.status).toBe('offline');
    expect(d.nextRetryAt).toBe(retryAt);
    expect(d.message).toBe(
      'No connection. Your changes are kept on this phone. It will try again by itself.',
    );
  });

  it('counts a timeout, or an answer cut off on the way, as the network', () => {
    const timeout = new SyncError('retryable', 'GitHub did not answer in time', {
      cause: new DOMException('signal timed out', 'TimeoutError'),
    });
    expect(describeSync(state({ failure: timeout })).status).toBe('offline');
  });

  it('says retrying for a failure that had a connection: GitHub failing, rounds lost', () => {
    for (const message of ['GitHub failed (HTTP 502)', 'Lost five rounds to other devices.']) {
      const d = describeSync(
        state({ failure: new SyncError('retryable', message), nextRetryAt: retryAt }),
      );
      expect(d.status).toBe('retrying');
      expect(d.nextRetryAt).toBe(retryAt);
      expect(d.message).toMatch(
        /^(GitHub failed \(HTTP 502\)|Lost five rounds to other devices)\. /,
      );
      expect(d.message).toMatch(/It will try again by itself\.$/);
    }
  });

  it('says retrying for a rate limit, with the time GitHub gave', () => {
    const error = new SyncError('rate_limit', 'Rate limited', { retryAt });
    const d = describeSync(state({ failure: error, nextRetryAt: retryAt }));
    expect(d).toMatchObject({ status: 'retrying', nextRetryAt: retryAt });
    expect(d.message).toMatch(/GitHub asked the app to wait/);
  });

  it('tells the lifter when syncing resumes if no retry is armed', () => {
    const inSession = describeSync(state({ failure: noConnection(), sessionInProgress: true }));
    expect(inSession.nextRetryAt).toBeNull();
    expect(inSession.message).toMatch(/It will sync when you end the session\.$/);

    const outside = describeSync(state({ failure: new SyncError('retryable', 'GitHub failed') }));
    expect(outside.message).toBe('GitHub failed. Tap sync to try again.');
  });

  it('asks for a new token after a token failure', () => {
    const error = new SyncError(
      'token',
      'GitHub did not accept the token: it is wrong, expired or revoked',
    );
    expect(describeSync(state({ failure: error }))).toEqual({
      status: 'needs_token',
      nextRetryAt: null,
      message:
        'GitHub did not accept the token: it is wrong, expired or revoked. Paste a new token to resume syncing.',
    });
  });

  it('says what is wrong with the repo', () => {
    const error = new SyncError('repo', 'me/log was not found.');
    const d = describeSync(state({ failure: error }));
    expect(d.status).toBe('repo_problem');
    // A message that already ends a sentence is not given a second full stop.
    expect(d.message).toMatch(/^me\/log was not found\. Syncing is paused/);
  });

  it('asks the lifter to update the app for a newer log format', () => {
    const d = describeSync(state({ failure: new SyncError('update', 'Format 2') }));
    expect(d.status).toBe('needs_update');
    expect(d.message).toMatch(/Update the app/);
  });

  it('reports a broken invariant as a problem that stopped syncing, and asks for a report', () => {
    const error = new SyncError('bug', 'GitHub sent file abc with content that hashes to def');
    const d = describeSync(state({ failure: error }));
    expect(d.status).toBe('repo_problem');
    expect(d.nextRetryAt).toBeNull();
    expect(d.message).toContain('GitHub sent file abc with content that hashes to def.');
    expect(d.message).toMatch(/Please report this\.$/);
  });

  it('never offers a retry time for a failure that stops syncing', () => {
    for (const kind of ['token', 'repo', 'update', 'bug'] as const) {
      const d = describeSync(state({ failure: new SyncError(kind, 'x'), nextRetryAt: retryAt }));
      expect(d.nextRetryAt).toBeNull();
    }
  });
});
