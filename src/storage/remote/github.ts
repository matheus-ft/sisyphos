import type { NewCommit, Remote, RemoteChange, RemoteTree, RepoInfo } from './remote';

/**
 * The log repo on GitHub, through the Git Data API (docs/STORAGE.md 4.1).
 *
 * Requirements the implementation must meet:
 * - every request is sent with `cache: 'no-store'`;
 * - every failure becomes a `SyncError` of the right kind (section 6), including
 *   rate limits (403/429 with `x-ratelimit-remaining: 0` or `retry-after`);
 * - `blob` verifies the content against its sha;
 * - `tree` rejects a truncated tree;
 * - `moveBranch` returns 'raced' only when a fresh head read differs from `from`;
 * - the token is only ever sent as an `Authorization` header, and never appears
 *   in an error message.
 *
 * STUB — implemented by the remote work package.
 */

export interface GitHubRemoteOptions {
  owner: string;
  repo: string;
  token: string;
  /** Null until setup has read the repo's default branch; only `repoInfo` works without it. */
  branch: string | null;
  /** Injectable for tests. */
  fetch?: typeof fetch;
}

export class GitHubRemote implements Remote {
  constructor(readonly options: GitHubRemoteOptions) {}

  repoInfo(): Promise<RepoInfo> {
    throw new Error('not implemented: remote/github');
  }
  head(): Promise<string | null> {
    throw new Error('not implemented: remote/github');
  }
  tree(_commit: string): Promise<RemoteTree> {
    throw new Error('not implemented: remote/github');
  }
  blob(_sha: string): Promise<string> {
    throw new Error('not implemented: remote/github');
  }
  commit(_input: {
    parent: string;
    baseTree: string;
    changes: RemoteChange[];
    message: string;
  }): Promise<NewCommit> {
    throw new Error('not implemented: remote/github');
  }
  moveBranch(_from: string, _to: string): Promise<'moved' | 'raced'> {
    throw new Error('not implemented: remote/github');
  }
  contains(_ancestor: string, _descendant: string): Promise<boolean> {
    throw new Error('not implemented: remote/github');
  }
  initEmpty(_path: string, _content: string, _message: string): Promise<string> {
    throw new Error('not implemented: remote/github');
  }
}
