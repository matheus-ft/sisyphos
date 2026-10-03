/**
 * The log repo, as the sync sees it (docs/STORAGE.md 4.1).
 *
 * Only a remote adapter talks to GitHub; the sync never sees HTTP. Two
 * implementations: `GitHubRemote` for real, and `MemoryRemote`, an in-memory
 * GitHub with a real commit graph and the same fast-forward rule, which the sync
 * and the simulation are tested against.
 *
 * Every method either returns or throws a `SyncError` whose kind says what to do
 * next (section 6). Nothing else may escape, with one exception: `blob` throws a
 * `FormatError` for content that is not UTF-8 text.
 */

export interface RemoteFile {
  path: string;
  /** Git blob sha of the file's content. */
  sha: string;
}

export interface RemoteTree {
  /** The tree's own sha: `base_tree` for the next commit, `last_synced_tree` once synced. */
  sha: string;
  /** Every file (blob) in the tree, recursively. Directories are not listed. */
  files: RemoteFile[];
}

export interface RepoInfo {
  /**
   * GitHub's id for the repository (`id` of `GET /repos/{o}/{r}`). It survives a
   * rename or a transfer, and a repository deleted and created again under the
   * same name gets a new one. That new repository holds another history, so
   * setup tells the two apart by this, not by the name (section 8).
   */
  id: number;
  private: boolean;
  defaultBranch: string;
}

/** One file in a commit: new content, or null to delete it. */
export interface RemoteChange {
  path: string;
  content: string | null;
}

export interface NewCommit {
  commit: string;
  tree: string;
}

export interface Remote {
  /** The repo's visibility and default branch. Works before a branch is known (setup). */
  repoInfo(): Promise<RepoInfo>;

  /** The branch head, or null when the repository has no commits yet. */
  head(): Promise<string | null>;

  /** The recursive tree of a commit. A tree GitHub reports as truncated is a `repo` error. */
  tree(commit: string): Promise<RemoteTree>;

  /**
   * One file's content. The adapter must check that the content hashes to `sha`
   * (`blobSha`) and throw a `bug` error if not. Content that is not UTF-8 text is
   * a `FormatError`, not a `SyncError`: no log file can be anything else, so it is
   * a file that does not parse, which the sync leaves alone while it syncs every
   * other path (section 6).
   */
  blob(sha: string): Promise<string>;

  /**
   * Writes a tree (on `baseTree`, so untouched files carry over) and a commit on
   * `parent`. Does not move the branch.
   */
  commit(input: {
    parent: string;
    baseTree: string;
    changes: RemoteChange[];
    message: string;
  }): Promise<NewCommit>;

  /**
   * Moves the branch from `from` to `to`, fast-forward only. GitHub checks `to`
   * against the head as it is, not against `from`: the move succeeds whenever
   * `to` descends from the current head, even if the head is no longer `from`
   * (another client force-reset it to an ancestor of `from`, say). Returns
   * 'raced' only when the move was refused and a fresh read of the head shows it
   * is no longer `from`: another device got there first. Any other refusal is
   * thrown as the error it is (section 4.2).
   */
  moveBranch(from: string, to: string): Promise<'moved' | 'raced'>;

  /** True when `ancestor` is `descendant` or in its history (compare: identical or ahead). */
  contains(ancestor: string, descendant: string): Promise<boolean>;

  /**
   * Creates the first commit of an empty repository, holding one file. The Git
   * Data API cannot write to an empty repository, so this is the one use of the
   * Contents API (section 8). Returns the new head.
   */
  initEmpty(path: string, content: string, message: string): Promise<string>;
}
