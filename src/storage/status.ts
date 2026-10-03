import type { Exposure } from './durability';
import type { SyncError } from './errors';

/**
 * What the UI always shows (docs/STORAGE.md 7.3; exposure levels in
 * docs/DURABILITY.md). `durability.ts` keeps `requestPersistence`,
 * `storageStatus` and `exposure`; exposure gains the rule that a session in
 * progress caps it at `pending`.
 *
 * The scheduler knows when syncs run and how they ended; `describeSync` turns
 * that into the status and the words the lifter sees, so the mapping from each
 * failure class (section 6) to what the lifter is told lives in one pure place.
 */

export type SyncStatus =
  | 'not_set_up'
  | 'idle'
  | 'syncing'
  | 'offline'
  | 'retrying'
  | 'needs_token'
  | 'repo_problem'
  | 'needs_update';

export interface StatusSnapshot {
  status: SyncStatus;
  /** When `retrying`: the next attempt. */
  nextRetryAt: Date | null;
  /** The last failure, in words the lifter can act on. */
  message: string | null;
  /** Unresolved sync conflicts (section 5). */
  conflicts: number;
  /** Library conflicts (9.1), derived. */
  libraryConflicts: number;
  /** Remote files left alone because they do not parse. */
  unreadable: string[];
  exposure: Exposure;
}

/** What the scheduler knows about syncing at one moment. */
export interface SyncState {
  /** A remote is configured (section 8). */
  setUp: boolean;
  syncing: boolean;
  /** How the last finished sync failed; null once one succeeds, and before any has run. */
  failure: SyncError | null;
  /** When the next automatic attempt is due; null when none is armed. */
  nextRetryAt: Date | null;
  /** Retries do not run during a session (7.2), which changes what the lifter is told. */
  sessionInProgress: boolean;
}

export function describeSync(
  state: SyncState,
): Pick<StatusSnapshot, 'status' | 'nextRetryAt' | 'message'> {
  if (!state.setUp) return { status: 'not_set_up', nextRetryAt: null, message: null };
  if (state.syncing) return { status: 'syncing', nextRetryAt: null, message: null };
  const { failure, nextRetryAt } = state;
  if (failure === null) return { status: 'idle', nextRetryAt: null, message: null };

  // What happens next without the lifter doing anything, which is what they
  // need to know to decide whether to do something.
  const next = nextRetryAt
    ? 'It will try again by itself.'
    : state.sessionInProgress
      ? 'It will sync when you end the session.'
      : 'Tap sync to try again.';

  switch (failure.kind) {
    case 'retryable':
      return isNetworkFailure(failure)
        ? {
            status: 'offline',
            nextRetryAt,
            message: `No connection. Your changes are kept on this phone. ${next}`,
          }
        : { status: 'retrying', nextRetryAt, message: `${sentence(failure.message)} ${next}` };
    case 'rate_limit':
      return {
        status: 'retrying',
        nextRetryAt,
        message: `GitHub asked the app to wait before syncing again. ${next}`,
      };
    case 'token':
      return {
        status: 'needs_token',
        nextRetryAt: null,
        message: `${sentence(failure.message)} Paste a new token to resume syncing.`,
      };
    case 'repo':
      return {
        status: 'repo_problem',
        nextRetryAt: null,
        message: `${sentence(failure.message)} Syncing is paused until the repo is fixed or set up again.`,
      };
    case 'update':
      return {
        status: 'needs_update',
        nextRetryAt: null,
        message:
          'Your log was saved by a newer version of Sisyphos. Update the app to keep syncing; everything you log meanwhile is kept on this phone.',
      };
    case 'bug':
      // Section 7.3 has no status of its own for a broken invariant. It is a
      // problem syncing cannot get past by itself, like a repo problem, and the
      // message says what it really is.
      return {
        status: 'repo_problem',
        nextRetryAt: null,
        message: `Syncing stopped rather than guess past something that should never happen: ${sentence(failure.message)} Nothing on this phone was changed. Please report this.`,
      };
  }
}

/**
 * A retryable failure is a network one (`offline`) when the request never got a
 * proper answer (no connection, a timeout, a body cut off on the way), which the
 * remote adapter says with `network`. GitHub's 5xx answers, rounds lost to other
 * devices and the device's own storage failing are `retrying`: telling the
 * lifter they are offline would send them looking in the wrong place.
 */
function isNetworkFailure(error: SyncError): boolean {
  return error.network;
}

/** An error's message as a sentence to put in front of more words. */
function sentence(message: string): string {
  const trimmed = message.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
