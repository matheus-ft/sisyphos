/**
 * Failure classes (docs/STORAGE.md section 6). Every failure a sync can end in
 * is exactly one of these, and the class alone decides what happens next.
 *
 * An unreadable log-repo file is not here: it does not fail the sync, it is
 * reported per path in the sync's result.
 */
export type SyncErrorKind =
  /** No network, timeout, 5xx, rounds lost to other devices. Back off and retry. */
  | 'retryable'
  /** GitHub's rate limit. Wait until `retryAt`. */
  | 'rate_limit'
  /** 401, or a 403 that is not a rate limit. Stop; ask for a new token. */
  | 'token'
  /** Repo or branch gone or invisible to the token; format marker missing or unreadable. Stop. */
  | 'repo'
  /** The log's format is newer than this build. Stop; ask the lifter to update. */
  | 'update'
  /** A broken invariant, e.g. a blob whose hash does not match its sha. Stop; never guess past it. */
  | 'bug';

export class SyncError extends Error {
  readonly kind: SyncErrorKind;
  /** For `rate_limit`: when GitHub says to try again. */
  readonly retryAt: Date | null;

  constructor(
    kind: SyncErrorKind,
    message: string,
    options: { retryAt?: Date | null; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'SyncError';
    this.kind = kind;
    this.retryAt = options.retryAt ?? null;
  }
}

/** Thrown by every parser for content that is not a valid file of its kind. */
export class FormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormatError';
  }
}
