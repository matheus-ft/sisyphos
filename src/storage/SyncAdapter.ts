/**
 * Remote sync. The MVP implementation is a private GitHub repo, which gives
 * version history for free and — because the Contents API requires the file's
 * current sha on write — compare-and-swap conflict detection for free too.
 *
 * Cadence is deliberately split from local saving: local writes are debounced
 * about a second so nothing is ever lost, while pushes wait for 10 minutes of
 * quiescence, the app being backgrounded, a session being ended, app launch, or
 * a manual tap. That keeps it to roughly one or two commits per session.
 */
export interface SyncAdapter {
  /** True once credentials are present and the remote is reachable. */
  isConfigured(): boolean;

  pull(path: string): Promise<{ body: string; sha: string } | null>;

  /**
   * Rejects with a Conflict when `baseSha` no longer matches the remote — that
   * is another device having written the same document. Never resolves by
   * overwriting; the caller surfaces both versions.
   */
  push(
    path: string,
    body: string,
    baseSha: string | null,
    message: string,
  ): Promise<{ sha: string }>;

  /** Everything under a prefix, for first-run restore onto a new device. */
  list(prefix: string): Promise<Array<{ path: string; sha: string }>>;
}

export class Conflict extends Error {
  constructor(
    readonly path: string,
    readonly remoteSha: string,
  ) {
    super(`Remote copy of ${path} changed since this device last read it`);
    this.name = 'Conflict';
  }
}
