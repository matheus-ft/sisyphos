import { FormatError, SyncError, type SyncErrorKind } from '../errors';
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
 *   in an error message;
 * - a 404 is marked `notFound`, so setup can tell a wrong name or token from a
 *   repository it found but cannot use.
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
  /**
   * How long a request may take, body included, before it counts as no network.
   * Without a limit, a request that hangs holds the sync lock (7.2) indefinitely.
   * Default 30 seconds.
   */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

const API = 'https://api.github.com';

/**
 * How long to wait after a rate-limit response that names no time: GitHub's
 * advice is "at least one minute" (docs.github.com/en/rest/using-the-rest-api/
 * best-practices-for-using-the-rest-api#handle-rate-limit-errors-appropriately).
 */
const DEFAULT_WAIT_MS = 60_000;

/**
 * What a token can hold: printable ASCII, no spaces. GitHub's tokens are letters,
 * digits and underscores, so this refuses nothing GitHub issues. It catches a
 * token pasted with a stray character, such as the "…" of a shortened copy:
 * `fetch` refuses a header that is not Latin-1 with a `TypeError`, the same
 * error it throws for no network, so without this check the lifter would be told
 * they are offline, and a sync would retry forever.
 */
const TOKEN_CHARACTERS = /^[\x21-\x7e]+$/;

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
    const id = pick(data, 'id');
    if (typeof id !== 'number' || !Number.isSafeInteger(id))
      throw this.unexpected('the repository', 'id');
    const visibility = pick(data, 'private');
    if (typeof visibility !== 'boolean') throw this.unexpected('the repository', 'private');
    return {
      id,
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
    // Listed by a commit sha, GitHub resolves it to the commit's tree but answers
    // with the commit's sha in `sha`, which is no tree to build on. So the commit
    // is read first for its tree's own sha, and the tree is listed by that.
    const found = await this.send(
      'GET',
      `${this.repoPath()}/git/commits/${encodeURIComponent(commit)}`,
    );
    if (!found.ok) throw await this.failure(found, this.missing(`commit ${commit}`));
    const sha = this.string(await this.read(found), 'tree.sha', 'the commit');

    const res = await this.send(
      'GET',
      `${this.repoPath()}/git/trees/${encodeURIComponent(sha)}?recursive=1`,
    );
    if (!res.ok) throw await this.failure(res, this.missing(`tree ${sha}`));
    const data = await this.read(res);
    if (this.string(data, 'sha', 'the tree') !== sha) {
      throw this.error(
        'bug',
        `GitHub listed another tree than ${sha}; syncing stopped rather than trust it`,
      );
    }
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
    return { sha, files };
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
      // No log file can be anything but UTF-8 text, so this is a file that does
      // not parse, not a broken repo: the sync leaves that one path alone and
      // syncs the rest (section 6), as it does for any unreadable file.
      throw new FormatError(`A file in ${this.name()} (blob ${sha}) is not UTF-8 text`);
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
    if (!TOKEN_CHARACTERS.test(this.options.token)) {
      // Not echoed: the message says what is wrong with it, and nothing of it.
      throw this.error(
        'token',
        'The token contains characters a GitHub token cannot, such as a space or "…". Paste it again exactly as GitHub showed it, or create a new one',
      );
    }
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
        // Covers reading the body too, since `read` consumes it under the same signal.
        signal: AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (cause) {
      const timedOut = cause instanceof DOMException && cause.name === 'TimeoutError';
      throw this.error(
        'retryable',
        timedOut ? 'GitHub did not answer in time' : 'Could not reach GitHub',
        { cause, network: true },
      );
    }
  }

  /** A successful response's JSON. A body cut off or garbled on the way (a captive portal, say) is worth another try. */
  private async read(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch (cause) {
      throw this.error('retryable', "GitHub's answer arrived incomplete or unreadable", {
        cause,
        network: true,
      });
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
      // But a 403 is also how GitHub refuses a write to an archived repository,
      // a token an organisation has not approved, or one not authorised for its
      // SAML single sign-on, where a token with more permissions changes
      // nothing. Only GitHub's own words say which, so they go along.
      const permission = `GitHub refused the token access to ${this.name()}: it needs the Contents permission, read and write`;
      return this.error('token', said ? `${permission}. GitHub said: ${said}` : permission);
    }
    if (status === 404) return this.error('repo', notFound, { notFound: true });
    return this.error('repo', `GitHub refused the request (HTTP ${status}): ${said}`);
  }

  /** Every error goes through here, so the token cannot reach a message, even one GitHub echoed. */
  private error(
    kind: SyncErrorKind,
    message: string,
    options: { retryAt?: Date; cause?: unknown; network?: boolean; notFound?: boolean } = {},
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
