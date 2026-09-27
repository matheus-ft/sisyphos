import type { NewCommit, Remote, RemoteChange, RemoteTree, RepoInfo } from './remote';

/**
 * An in-memory GitHub: a real commit graph (commits with parents, trees, blobs
 * addressed by their git blob sha) and the same fast-forward rule, shared by
 * every simulated device. The sync and the simulation are tested against it.
 *
 * Shas of blobs must be real git blob shas (`blobSha`), so the device's hashes
 * and the remote's agree exactly as they do on GitHub. Commit and tree shas may
 * be any unique strings.
 *
 * Besides the `Remote` operations it has controls for tests, below.
 *
 * STUB — implemented by the remote work package.
 */

export type RemoteOp = keyof Remote;

export interface MemoryRemoteOptions {
  private?: boolean;
  defaultBranch?: string;
  /** Start with no commits at all (an empty repository). Default: one commit holding README.md. */
  empty?: boolean;
}

export class MemoryRemote implements Remote {
  constructor(_options: MemoryRemoteOptions = {}) {}

  // --- Remote ---------------------------------------------------------------------

  repoInfo(): Promise<RepoInfo> {
    throw new Error('not implemented: remote/memory');
  }
  head(): Promise<string | null> {
    throw new Error('not implemented: remote/memory');
  }
  tree(_commit: string): Promise<RemoteTree> {
    throw new Error('not implemented: remote/memory');
  }
  blob(_sha: string): Promise<string> {
    throw new Error('not implemented: remote/memory');
  }
  commit(_input: {
    parent: string;
    baseTree: string;
    changes: RemoteChange[];
    message: string;
  }): Promise<NewCommit> {
    throw new Error('not implemented: remote/memory');
  }
  moveBranch(_from: string, _to: string): Promise<'moved' | 'raced'> {
    throw new Error('not implemented: remote/memory');
  }
  contains(_ancestor: string, _descendant: string): Promise<boolean> {
    throw new Error('not implemented: remote/memory');
  }
  initEmpty(_path: string, _content: string, _message: string): Promise<string> {
    throw new Error('not implemented: remote/memory');
  }

  // --- test controls ----------------------------------------------------------------

  /** Commits on top of the head and moves the branch, as another client would. Returns the commit. */
  externalCommit(_changes: RemoteChange[], _message?: string): string {
    throw new Error('not implemented: remote/memory');
  }

  /** Every file at the head, path to content. Empty for an empty repository. */
  files(): Map<string, string> {
    throw new Error('not implemented: remote/memory');
  }

  /** The number of commits reachable from the head. */
  commitCount(): number {
    throw new Error('not implemented: remote/memory');
  }

  /** Makes the next call of `op` throw `error` instead of running. Queued in order per op. */
  failNext(_op: RemoteOp, _error: Error): void {
    throw new Error('not implemented: remote/memory');
  }

  /**
   * Called at the start of every `moveBranch`, before the fast-forward check, so a
   * test can slip another commit in (with `externalCommit`) and force a race.
   */
  beforeMove: (() => void) | null = null;

  /** Every call made, in order, for asserting request counts (e.g. a quiet sync makes one). */
  readonly calls: RemoteOp[] = [];
}
