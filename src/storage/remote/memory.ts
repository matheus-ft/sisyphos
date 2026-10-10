import { SyncError } from '../errors';
import { blobSha, sha1Hex } from '../hash';
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
 * Where GitHub would refuse a request, this throws the `SyncError` the GitHub
 * adapter would turn that refusal into, so a sync that passes here does not
 * depend on anything GitHub would not do. Everything it returns is a copy: a
 * caller cannot change the remote except through its operations.
 */

export type RemoteOp = keyof Remote;

export interface MemoryRemoteOptions {
  private?: boolean;
  defaultBranch?: string;
  /** Start with no commits at all (an empty repository). Default: one commit holding README.md. */
  empty?: boolean;
}

interface Commit {
  tree: string;
  parent: string | null;
}

/** Path to blob sha. Stored trees are never changed; a commit makes a new one. */
type Tree = ReadonlyMap<string, string>;

const encoder = new TextEncoder();
const EMPTY_TREE: Tree = new Map();

/** What the lifter's first commit holds when they tick "Add a README". */
const README = '# sisyphos-log\n';

/**
 * Numbers each remote, so two remotes never share a commit sha or a repository
 * id, as two GitHub repositories would not, even one deleted and created again
 * under the same name. Tests that point a device at a different repo rely on
 * that.
 */
let remotes = 0;

export class MemoryRemote implements Remote {
  private readonly info: RepoInfo;
  private readonly id = ++remotes;
  /** Blob content by git blob sha. */
  private readonly blobs = new Map<string, string>();
  private readonly trees = new Map<string, Tree>();
  private readonly commits = new Map<string, Commit>();
  private branch: string | null = null;
  /** Commits created so far, so two commits of the same tree and parent still differ, as their timestamps would on GitHub. */
  private created = 0;
  private readonly failures = new Map<RemoteOp, Error[]>();
  /** Set by `lagHead`. */
  private lagging: { head: string | null; reads: number } = { head: null, reads: 0 };

  constructor(options: MemoryRemoteOptions = {}) {
    this.info = {
      id: this.id,
      private: options.private ?? true,
      defaultBranch: options.defaultBranch ?? 'main',
    };
    if (!options.empty)
      this.externalCommit([{ path: 'README.md', content: README }], 'Initial commit');
  }

  // --- Remote ---------------------------------------------------------------------

  async repoInfo(): Promise<RepoInfo> {
    this.enter('repoInfo');
    return { ...this.info };
  }

  async head(): Promise<string | null> {
    this.enter('head');
    if (this.lagging.reads > 0) {
      this.lagging.reads--;
      return this.lagging.head;
    }
    return this.branch;
  }

  async tree(commit: string): Promise<RemoteTree> {
    this.enter('tree');
    const found = this.commits.get(commit);
    if (!found) throw notFound(`commit ${commit}`);
    const files = [...this.treeOf(found.tree)]
      .map(([path, sha]) => ({ path, sha }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { sha: found.tree, files };
  }

  async blob(sha: string): Promise<string> {
    this.enter('blob');
    const content = this.blobs.get(sha);
    if (content === undefined) throw notFound(`blob ${sha}`);
    return content;
  }

  async commit(input: {
    parent: string;
    baseTree: string;
    changes: RemoteChange[];
    message: string;
  }): Promise<NewCommit> {
    this.enter('commit');
    // GitHub answers 422 for a parent or base tree it does not have.
    if (!this.commits.has(input.parent)) throw refused(`Parent ${input.parent} does not exist`);
    if (!this.trees.has(input.baseTree))
      throw refused(`Base tree ${input.baseTree} does not exist`);
    const tree = this.writeTree(this.treeOf(input.baseTree), input.changes);
    return { commit: this.writeCommit(tree, input.parent, input.message), tree };
  }

  async moveBranch(from: string, to: string): Promise<'moved' | 'raced'> {
    this.enter('moveBranch');
    this.beforeMove?.();
    // GitHub's `force: false` is a fast-forward check against the head as it is,
    // not a compare-and-swap on `from`: the move succeeds whenever `to` descends
    // from the head, even one that is no longer `from`, such as after a
    // force-reset to an ancestor of `from`. A stricter rule here would keep from
    // the sync's tests a move GitHub makes.
    if (this.branch !== null && this.descends(to, this.branch)) {
      this.branch = to;
      return 'moved';
    }
    // Refused. With the head moved, another device got there first; with the
    // head still at `from`, the refusal is a real error.
    if (this.branch !== from) return 'raced';
    if (!this.commits.has(to)) throw refused(`Object ${to} does not exist`);
    throw refused('Update is not a fast forward');
  }

  async contains(ancestor: string, descendant: string): Promise<boolean> {
    this.enter('contains');
    return this.descends(descendant, ancestor);
  }

  async initEmpty(path: string, content: string, message: string): Promise<string> {
    this.enter('initEmpty');
    if (this.branch !== null) throw refused('The repository is not empty');
    const tree = this.writeTree(EMPTY_TREE, [{ path, content }]);
    this.branch = this.writeCommit(tree, null, message);
    return this.branch;
  }

  // --- test controls ----------------------------------------------------------------

  /** Commits on top of the head and moves the branch, as another client would. Returns the commit. */
  externalCommit(changes: RemoteChange[], message = 'External commit'): string {
    const base = this.branch === null ? EMPTY_TREE : this.treeOf(this.commitOf(this.branch).tree);
    const tree = this.writeTree(base, changes);
    this.branch = this.writeCommit(tree, this.branch, message);
    return this.branch;
  }

  /**
   * Points the branch at a commit it holds, whether or not that is a fast-forward,
   * as another client's force-push or reset would. The adapter never does this.
   */
  forceBranch(commit: string): void {
    if (!this.commits.has(commit)) throw new Error(`No commit ${commit} to point the branch at`);
    this.branch = commit;
  }

  /**
   * The next `reads` reads of the head answer `head`, whatever the branch holds,
   * as GitHub's reads can for a moment after the branch moved (remote.ts,
   * `REREAD_MS`).
   */
  lagHead(head: string, reads: number): void {
    this.lagging = { head, reads };
  }

  /** Every file at the head, path to content. Empty for an empty repository. */
  files(): Map<string, string> {
    if (this.branch === null) return new Map();
    const tree = this.treeOf(this.commitOf(this.branch).tree);
    return new Map([...tree].map(([path, sha]) => [path, this.blobs.get(sha)!]));
  }

  /** The number of commits reachable from the head. */
  commitCount(): number {
    let count = 0;
    for (let at = this.branch; at !== null; at = this.commitOf(at).parent) count++;
    return count;
  }

  /** Makes the next call of `op` throw `error` instead of running. Queued in order per op. */
  failNext(op: RemoteOp, error: Error): void {
    const queue = this.failures.get(op) ?? [];
    queue.push(error);
    this.failures.set(op, queue);
  }

  /**
   * Called at the start of every `moveBranch`, before the fast-forward check, so a
   * test can slip another commit in (with `externalCommit`) and force a race, or
   * move the branch some other way (with `forceBranch`).
   */
  beforeMove: (() => void) | null = null;

  /** Every call made, in order, for asserting request counts (e.g. a quiet sync makes one). */
  readonly calls: RemoteOp[] = [];

  // --- the graph --------------------------------------------------------------------

  /** Records the call, then throws the failure queued for it, if any, so the op does not run. */
  private enter(op: RemoteOp): void {
    this.calls.push(op);
    const failure = this.failures.get(op)?.shift();
    if (failure) throw failure;
  }

  private treeOf(sha: string): Tree {
    return this.trees.get(sha)!;
  }

  private commitOf(sha: string): Commit {
    return this.commits.get(sha)!;
  }

  /**
   * Applies changes on a base tree and stores the result. Validates before
   * storing anything, so a refused write leaves no trace.
   */
  private writeTree(base: Tree, changes: RemoteChange[]): string {
    const files = new Map(base);
    const added: [string, string][] = [];
    for (const { path, content } of changes) {
      if (content === null) {
        // GitHub refuses the whole tree when a deletion names a path the base
        // tree does not hold (422 GitRPC::BadObjectState; reported in
        // google/go-github#2418 and octokit/octokit.net#2836).
        if (!files.delete(path)) throw refused(`Cannot delete ${path}: it is not in the base tree`);
      } else {
        const sha = blobSha(content);
        added.push([sha, content]);
        files.set(path, sha);
      }
    }
    for (const [sha, content] of added) this.blobs.set(sha, content);

    // Content-addressed, as in git: equal trees share a sha, different ones never do.
    const listing = [...files]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([path, sha]) => `${sha} ${path}\n`)
      .join('');
    const sha = sha1Hex(encoder.encode(`tree\n${listing}`));
    this.trees.set(sha, files);
    return sha;
  }

  private writeCommit(tree: string, parent: string | null, message: string): string {
    const text = `commit ${this.id}.${++this.created}\ntree ${tree}\nparent ${parent ?? ''}\n\n${message}`;
    const sha = sha1Hex(encoder.encode(text));
    this.commits.set(sha, { tree, parent });
    return sha;
  }

  /** True when `ancestor` is `commit` or in its history. False for commits the remote does not have. */
  private descends(commit: string, ancestor: string): boolean {
    if (!this.commits.has(ancestor)) return false;
    for (let at: string | null = commit; at !== null; at = this.commits.get(at)?.parent ?? null) {
      if (at === ancestor) return true;
    }
    return false;
  }
}

/** A 404 from GitHub, as the adapter reports it. */
function notFound(what: string): SyncError {
  return new SyncError('repo', `The log repo has no ${what}`, { notFound: true });
}

/** A 422 from GitHub, as the adapter reports it. */
function refused(message: string): SyncError {
  return new SyncError('repo', `GitHub refused the request: ${message}`);
}
