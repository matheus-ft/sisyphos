import { SyncError, type SyncErrorKind } from '../errors';
import { blobSha } from '../hash';
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
 * Request and response shapes follow docs.github.com/en/rest/git (refs, trees,
 * blobs, commits), /rest/commits/commits#compare-two-commits,
 * /rest/repos/contents#create-or-update-file-contents and
 * /rest/repos/repos#get-a-repository, API version 2022-11-28.
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

const API = 'https://api.github.com';

/**
 * How long to wait after a rate-limit response that names no time: GitHub's
 * advice is "at least one minute" (docs.github.com/en/rest/using-the-rest-api/
 * best-practices-for-using-the-rest-api#handle-rate-limit-errors-appropriately).
 */
const DEFAULT_WAIT_MS = 60_000;

const encoder = new TextEncoder();
/** Fatal, so text that is not UTF-8 is refused rather than silently altered; BOM kept, so the text hashes to the bytes it came from. */
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export class GitHubRemote implements Remote {
  constructor(readonly options: GitHubRemoteOptions) {}

  async repoInfo(): Promise<RepoInfo> {
    const res = await this.send('GET', this.repoPath());
    if (!res.ok) {
      throw await this.failure(
        res,
        `${this.name()} was not found. Check the name, and that the token was given access to it`,
      );
    }
    const data = await this.read(res);
    const visibility = pick(data, 'private');
    if (typeof visibility !== 'boolean') throw this.unexpected('the repository', 'private');
    return {
      private: visibility,
      defaultBranch: this.string(data, 'default_branch', 'the repository'),
    };
  }

  async head(): Promise<string | null> {
    const branch = this.branch();
    const res = await this.send('GET', `${this.repoPath()}/git/ref/heads/${encodePath(branch)}`);
    // GitHub answers 409 "Git Repository is empty." for any ref of a repository
    // with no commits; it is not documented beyond "409 Conflict".
    if (res.status === 409) return null;
    if (!res.ok) {
      throw await this.failure(
        res,
        `The branch ${branch} of ${this.name()} was not found, or the token can no longer see the repository`,
      );
    }
    return this.string(await this.read(res), 'object.sha', 'the branch');
  }

  async tree(commit: string): Promise<RemoteTree> {
    // The docs accept a tree sha or a ref, and a ref names a commit, so a commit
    // sha resolves to its tree; the answer's `sha` is then the tree's own, which
    // is what the next commit's `base_tree` needs. (Relied on, not documented.)
    const res = await this.send(
      'GET',
      `${this.repoPath()}/git/trees/${encodeURIComponent(commit)}?recursive=1`,
    );
    if (!res.ok) throw await this.failure(res, this.missing(`commit ${commit}`));
    const data = await this.read(res);
    // Past 100,000 entries or 7 MB GitHub lists part of the tree and says so.
    // Syncing part of the log is worse than not syncing (STORAGE.md 4.1).
    if (pick(data, 'truncated') === true) {
      throw this.error(
        'repo',
        `${this.name()} holds more files than GitHub will list at once, so it cannot be synced safely`,
      );
    }
    const entries = pick(data, 'tree');
    if (!Array.isArray(entries)) throw this.unexpected('the tree', 'tree');
    const files = entries
      .filter((entry) => pick(entry, 'type') === 'blob')
      .map((entry) => ({
        path: this.string(entry, 'path', 'the tree'),
        sha: this.string(entry, 'sha', 'the tree'),
      }));
    return { sha: this.string(data, 'sha', 'the tree'), files };
  }

  async blob(sha: string): Promise<string> {
    const res = await this.send('GET', `${this.repoPath()}/git/blobs/${encodeURIComponent(sha)}`);
    if (!res.ok) throw await this.failure(res, this.missing(`file ${sha}`));
    const encoded = this.string(await this.read(res), 'content', 'the file');

    // Always base64 in the default media type, wrapped with newlines.
    let bytes: Uint8Array;
    try {
      bytes = fromBase64(encoded);
    } catch {
      throw this.error('bug', `GitHub sent file ${sha} in a form that is not base64`);
    }
    let text: string;
    try {
      text = utf8.decode(bytes);
    } catch {
      throw this.error('repo', `A file in ${this.name()} (blob ${sha}) is not UTF-8 text`);
    }
    const actual = blobSha(text);
    if (actual !== sha) {
      throw this.error(
        'bug',
        `GitHub sent file ${sha} with content that hashes to ${actual}; syncing stopped rather than trust it`,
      );
    }
    return text;
  }

  async commit(input: {
    parent: string;
    baseTree: string;
    changes: RemoteChange[];
    message: string;
  }): Promise<NewCommit> {
    let tree = input.baseTree;
    if (input.changes.length > 0) {
      // Entries overwrite the base tree's at the same path; `sha: null` deletes
      // one. GitHub refuses the whole request if a deletion names a path the
      // base tree does not hold (422 GitRPC::BadObjectState, reported in
      // google/go-github#2418). `content` is written as a UTF-8 blob.
      const res = await this.send('POST', `${this.repoPath()}/git/trees`, {
        base_tree: input.baseTree,
        tree: input.changes.map(({ path, content }) =>
          content === null
            ? { path, mode: '100644', type: 'blob', sha: null }
            : { path, mode: '100644', type: 'blob', content },
        ),
      });
      if (!res.ok) throw await this.failure(res, this.missing(`tree ${input.baseTree}`));
      tree = this.string(await this.read(res), 'sha', 'the new tree');
    }

    const res = await this.send('POST', `${this.repoPath()}/git/commits`, {
      message: input.message,
      tree,
      parents: [input.parent],
    });
    if (!res.ok) throw await this.failure(res, this.missing(`commit ${input.parent}`));
    return { commit: this.string(await this.read(res), 'sha', 'the new commit'), tree };
  }

  async moveBranch(from: string, to: string): Promise<'moved' | 'raced'> {
    const branch = this.branch();
    const path = `${this.repoPath()}/git/refs/heads/${encodePath(branch)}`;
    const res = await this.send('PATCH', path, { sha: to, force: false });
    if (res.ok) return 'moved';
    if (res.status === 422 || res.status === 409) {
      // GitHub answers 422 for a non-fast-forward and for validation failures
      // alike, so only a fresh read of the head can tell a race from a real
      // refusal (STORAGE.md 4.2). Treating every 422 as a race retries forever.
      const said = await githubMessage(res);
      if ((await this.head()) !== from) return 'raced';
      throw this.error(
        'repo',
        `GitHub refused to move the branch ${branch} of ${this.name()} (HTTP ${res.status}): ${said}`,
      );
    }
    throw await this.failure(
      res,
      `The branch ${branch} of ${this.name()} was not found, or the token can no longer see the repository`,
    );
  }

  async contains(ancestor: string, descendant: string): Promise<boolean> {
    const res = await this.send(
      'GET',
      `${this.repoPath()}/compare/${encodeURIComponent(ancestor)}...${encodeURIComponent(descendant)}`,
    );
    // 404 is GitHub's answer for a commit it does not have: that commit is in
    // no history.
    if (res.status === 404) return false;
    if (!res.ok) throw await this.failure(res, this.missing(`commit ${ancestor}`));
    // `status` is how the head (`descendant`) relates to the base (`ancestor`):
    // `ahead` means the base is in its history.
    const status = this.string(await this.read(res), 'status', 'the comparison');
    return status === 'identical' || status === 'ahead';
  }

  async initEmpty(path: string, content: string, message: string): Promise<string> {
    // No `branch`: the file goes to the repository's default branch, which is
    // the branch setup stores (STORAGE.md section 8), and an empty repository
    // has no branch yet to name.
    const res = await this.send('PUT', `${this.repoPath()}/contents/${encodePath(path)}`, {
      message,
      content: toBase64(content),
    });
    if (!res.ok) {
      throw await this.failure(
        res,
        `${this.name()} was not found, or the token can no longer see it`,
      );
    }
    return this.string(await this.read(res), 'commit.sha', 'the new file');
  }

  // --- HTTP -------------------------------------------------------------------------

  private async send(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.options.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    // Called unbound: the browser's fetch refuses to run with a `this` other than the window.
    const request = this.options.fetch ?? fetch;
    try {
      // `no-store`: GitHub marks responses cacheable for 60 seconds, and a cached
      // head makes every push look like a lost race (STORAGE.md 4.1).
      return await request(`${API}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
      });
    } catch (cause) {
      throw this.error('retryable', 'Could not reach GitHub', { cause });
    }
  }

  /** A successful response's JSON. A body cut off or garbled on the way (a captive portal, say) is worth another try. */
  private async read(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch (cause) {
      throw this.error('retryable', "GitHub's answer arrived incomplete or unreadable", { cause });
    }
  }

  /**
   * The error for a response GitHub refused, by class (STORAGE.md section 6).
   * `notFound` says what a 404 means for this request.
   */
  private async failure(res: Response, notFound: string): Promise<SyncError> {
    const { status } = res;
    const said = await githubMessage(res);
    if (status >= 500) return this.error('retryable', `GitHub failed (HTTP ${status})`);
    if (status === 401) {
      return this.error(
        'token',
        'GitHub did not accept the token: it is wrong, expired or revoked',
      );
    }
    if (status === 403 || status === 429) {
      const retryAt = rateLimitedUntil(res, said);
      if (retryAt) {
        return this.error(
          'rate_limit',
          `GitHub's rate limit was reached; try again after ${retryAt.toISOString()}`,
          { retryAt },
        );
      }
    }
    if (status === 403) {
      // Reading or writing, the permission a log token can lack here is
      // Contents: Metadata is granted with any access (STORAGE.md section 8).
      return this.error(
        'token',
        `GitHub refused the token access to ${this.name()}: it needs the Contents permission, read and write`,
      );
    }
    if (status === 404) return this.error('repo', notFound);
    return this.error('repo', `GitHub refused the request (HTTP ${status}): ${said}`);
  }

  /** Every error goes through here, so the token cannot reach a message, even one GitHub echoed. */
  private error(
    kind: SyncErrorKind,
    message: string,
    options: { retryAt?: Date; cause?: unknown } = {},
  ): SyncError {
    const { token } = this.options;
    const safe = token ? message.split(token).join('[token]') : message;
    return new SyncError(kind, safe, options);
  }

  /** GitHub answered in a shape this adapter was not written for: stop rather than guess. */
  private unexpected(what: string, field: string): SyncError {
    return this.error('bug', `GitHub's answer for ${what} has no ${field}`);
  }

  private string(data: unknown, path: string, what: string): string {
    const value = pick(data, path);
    if (typeof value !== 'string') throw this.unexpected(what, path);
    return value;
  }

  private missing(what: string): string {
    return `${this.name()}, or ${what} in it, was not found; the repository may have been deleted or renamed, or the token can no longer see it`;
  }

  private branch(): string {
    const { branch } = this.options;
    if (branch === null)
      throw this.error('bug', 'No branch yet: setup has not read the repository');
    return branch;
  }

  private name(): string {
    return `${this.options.owner}/${this.options.repo}`;
  }

  private repoPath(): string {
    return `/repos/${encodeURIComponent(this.options.owner)}/${encodeURIComponent(this.options.repo)}`;
  }
}

/**
 * When to retry, if GitHub is rate limiting (docs.github.com/en/rest/using-the-rest-api/
 * rate-limits-for-the-rest-api). A primary limit sends `x-ratelimit-remaining: 0` and
 * `x-ratelimit-reset`, in UTC epoch seconds. A secondary limit may send `retry-after`,
 * in seconds, which takes precedence; otherwise it says so only in its message, and
 * GitHub advises waiting at least a minute. A 429 is a rate limit whatever it carries.
 */
function rateLimitedUntil(res: Response, said: string): Date | null {
  const now = Date.now();
  const retryAfter = res.headers.get('retry-after');
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    return new Date(now + (Number.isFinite(seconds) ? seconds * 1000 : DEFAULT_WAIT_MS));
  }
  if (res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    return new Date(reset > 0 ? reset * 1000 : now + DEFAULT_WAIT_MS);
  }
  if (res.status === 429 || /rate limit/i.test(said)) return new Date(now + DEFAULT_WAIT_MS);
  return null;
}

/** The `message` of a GitHub error body, or '' when there is none. */
async function githubMessage(res: Response): Promise<string> {
  try {
    const message = pick(JSON.parse(await res.text()), 'message');
    return typeof message === 'string' ? message.slice(0, 300) : '';
  } catch {
    return '';
  }
}

/** A value at a dotted path in parsed JSON, or undefined. */
function pick(data: unknown, path: string): unknown {
  let value = data;
  for (const key of path.split('.')) {
    value =
      typeof value === 'object' && value !== null
        ? (value as Record<string, unknown>)[key]
        : undefined;
  }
  return value;
}

/** Encodes each segment of a slash-separated path (a branch name, a file path), keeping the slashes. */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function toBase64(text: string): string {
  let binary = '';
  for (const byte of encoder.encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** GitHub wraps a blob's base64 in lines of 60 characters. */
function fromBase64(encoded: string): Uint8Array {
  const binary = atob(encoded.replace(/\s/g, ''));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
