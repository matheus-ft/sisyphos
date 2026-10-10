import { afterEach, describe, it, expect, vi } from 'vitest';
import { GitHubRemote } from '../src/storage/remote/github';
import { FormatError, SyncError, type SyncErrorKind } from '../src/storage/errors';
import { blobSha } from '../src/storage/hash';

// Responses as GitHub sends them (API version 2022-11-28), trimmed of fields
// the adapter does not read.
import repoJson from './fixtures/github/repo.json';
import refJson from './fixtures/github/ref.json';
import commitJson from './fixtures/github/commit.json';
import treeJson from './fixtures/github/tree.json';
import blobJson from './fixtures/github/blob.json';
import createTreeJson from './fixtures/github/create-tree.json';
import createCommitJson from './fixtures/github/create-commit.json';
import updateRefJson from './fixtures/github/update-ref.json';
import compareJson from './fixtures/github/compare.json';
import putContentsJson from './fixtures/github/put-contents.json';
import emptyRepoJson from './fixtures/github/error-empty-repo.json';
import notFastForwardJson from './fixtures/github/error-not-fast-forward.json';
import referenceUpdateFailedJson from './fixtures/github/error-reference-update-failed.json';
import notFoundJson from './fixtures/github/error-not-found.json';
import badCredentialsJson from './fixtures/github/error-bad-credentials.json';
import forbiddenJson from './fixtures/github/error-forbidden.json';
import rateLimitJson from './fixtures/github/error-rate-limit.json';
import secondaryRateLimitJson from './fixtures/github/error-secondary-rate-limit.json';

const TOKEN =
  'github_pat_11ABCDEFG0h1JkLmNoPqRsTuV_wXyZ0123456789abcdefghijklmnopqrstuvwxyzABCDEFG';
const REPO = 'https://api.github.com/repos/lifter/sisyphos-log';
const HEAD = refJson.object.sha;
const HEAD_TREE = treeJson.sha;
const NEW_TREE = createTreeJson.sha;
const NEW_COMMIT = createCommitJson.sha;
const OTHER = '366e905da7d0e5c5b46c49b399246fb0ccd0ddfe';
const SESSION = blobJson.sha;
const SESSION_TEXT =
  '{\n  "id": "2026-09-14-k3f9",\n  "date": "2026-09-14",\n  "notes": "Agachamento — pés afastados, 5×5 @ 140 kg 🏋️ ✓ 日本語"\n}\n';
const MARKER = '{\n  "format": 1\n}\n';

// --- a scripted GitHub ------------------------------------------------------------------

interface Exchange {
  /** The request the adapter must make. */
  method: 'GET' | 'POST' | 'PATCH' | 'PUT';
  url: string;
  body?: unknown;
  /** GitHub's answer: a status and body (JSON, or raw text when a string), or a rejection standing for the network. */
  status?: number;
  reply?: unknown;
  headers?: Record<string, string>;
  reject?: Error;
}

interface Sent {
  method: string;
  url: string;
  headers: Record<string, string>;
  cache: RequestCache | undefined;
  body: unknown;
}

const scripts: (() => void)[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const verify of scripts.splice(0)) verify();
});

/**
 * A GitHubRemote over a fake `fetch` that replays `script` in order. After each
 * test, every scripted request must have been made, in order and nothing else,
 * each with the headers, cache mode and body every request must carry. The
 * checks run after the test rather than inside `fetch`, where the adapter would
 * turn a failed assertion into a network error.
 */
function github(script: Exchange[], branch: string | null = 'main') {
  const sent: Sent[] = [];
  const fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, key) => (headers[key] = value));
    sent.push({
      method: init.method ?? 'GET',
      url: String(input),
      headers,
      cache: init.cache,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body,
    });
    const next = script[sent.length - 1];
    if (!next) throw new Error('unscripted request');
    if (next.reject) throw next.reject;
    const body =
      next.reply === undefined
        ? null
        : typeof next.reply === 'string'
          ? next.reply
          : JSON.stringify(next.reply);
    return new Response(body, {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json; charset=utf-8', ...next.headers },
    });
  };

  scripts.push(() => {
    expect(sent.map(({ method, url, body }) => ({ method, url, body }))).toEqual(
      script.map(({ method, url, body }) => ({ method, url, body })),
    );
    for (const request of sent) {
      expect(request.cache).toBe('no-store');
      expect(request.headers).toEqual({
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${TOKEN}`,
        'x-github-api-version': '2022-11-28',
        ...(request.body === undefined ? {} : { 'content-type': 'application/json' }),
      });
      // The token travels in the Authorization header and nowhere else.
      expect(JSON.stringify({ ...request, headers: null })).not.toContain(TOKEN);
    }
  });

  const remote = new GitHubRemote({
    owner: 'lifter',
    repo: 'sisyphos-log',
    token: TOKEN,
    branch,
    fetch,
  });
  return { remote, sent };
}

/** The SyncError `promise` rejects with, checked for its kind and for the token. */
async function failure(promise: Promise<unknown>, kind: SyncErrorKind): Promise<SyncError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(SyncError);
  const syncError = error as SyncError;
  expect(syncError.kind).toBe(kind);
  expect(syncError.message).not.toContain(TOKEN);
  expect(String(syncError.cause ?? '')).not.toContain(TOKEN);
  return syncError;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Base64 as GitHub sends a blob's content: lines of 60 characters, each ending in a newline. */
function wrapped(encoded: string): string {
  return encoded.replace(/.{1,60}/g, '$&\n');
}

const getCommit: Exchange = {
  method: 'GET',
  url: `${REPO}/git/commits/${HEAD}`,
  reply: commitJson,
};

const getHead = (reply: unknown = refJson, status = 200): Exchange => ({
  method: 'GET',
  url: `${REPO}/git/ref/heads/main`,
  status,
  reply,
});

// --- the happy paths --------------------------------------------------------------------

describe('GitHubRemote: each operation', () => {
  it('reads the repository, before any branch is known', async () => {
    const { remote } = github([{ method: 'GET', url: REPO, reply: repoJson }], null);
    expect(await remote.repoInfo()).toEqual({
      id: 861234567,
      private: true,
      defaultBranch: 'main',
    });
  });

  it('reports a public repository as such', async () => {
    const { remote } = github([
      { method: 'GET', url: REPO, reply: { ...repoJson, private: false, visibility: 'public' } },
    ]);
    expect((await remote.repoInfo()).private).toBe(false);
  });

  it('reads the branch head', async () => {
    const { remote } = github([getHead()]);
    expect(await remote.head()).toBe(HEAD);
  });

  it('keeps the slashes of a branch name in the path', async () => {
    const { remote } = github(
      [{ method: 'GET', url: `${REPO}/git/ref/heads/log/main%23a`, reply: refJson }],
      'log/main#a',
    );
    expect(await remote.head()).toBe(HEAD);
  });

  it("lists every file of a commit recursively, and only files, by the tree's own sha", async () => {
    // Listed by the commit's sha, GitHub answers with the commit's sha in `sha`.
    const { remote } = github([
      getCommit,
      { method: 'GET', url: `${REPO}/git/trees/${HEAD_TREE}?recursive=1`, reply: treeJson },
    ]);
    expect(await remote.tree(HEAD)).toEqual({
      sha: HEAD_TREE,
      files: [
        { path: 'README.md', sha: '64e050b6e283a02d1027fd788beeefe89ebfb87f' },
        { path: 'lifter/bodyweight.csv', sha: 'd4ec9d051637ae51b1247887cfcaa365052713b3' },
        { path: 'sessions/2026/2026-09-14-k3f9.json', sha: SESSION },
        { path: 'sisyphos.json', sha: '00517d70de6db1e19725caa81a52566a6f9011a8' },
      ],
    });
  });

  it('reads a file, decoding base64 wrapped in lines into UTF-8 text', async () => {
    const { remote } = github([
      { method: 'GET', url: `${REPO}/git/blobs/${SESSION}`, reply: blobJson },
    ]);
    // The fixture's sha is `git hash-object` of this text.
    expect(blobSha(SESSION_TEXT)).toBe(SESSION);
    expect(blobJson.content).toContain('\n');
    expect(await remote.blob(SESSION)).toBe(SESSION_TEXT);
  });

  it('writes a tree on the base tree, then a commit on the parent', async () => {
    const { remote } = github([
      {
        method: 'POST',
        url: `${REPO}/git/trees`,
        body: {
          base_tree: HEAD_TREE,
          tree: [
            {
              path: 'sessions/2026/2026-09-14-k3f9.json',
              mode: '100644',
              type: 'blob',
              content: SESSION_TEXT,
            },
            { path: 'templates/squat-day-a-k3f9.json', mode: '100644', type: 'blob', sha: null },
          ],
        },
        status: 201,
        reply: createTreeJson,
      },
      {
        method: 'POST',
        url: `${REPO}/git/commits`,
        body: { message: 'Sync', tree: NEW_TREE, parents: [HEAD] },
        status: 201,
        reply: createCommitJson,
      },
    ]);
    expect(
      await remote.commit({
        parent: HEAD,
        baseTree: HEAD_TREE,
        changes: [
          { path: 'sessions/2026/2026-09-14-k3f9.json', content: SESSION_TEXT },
          { path: 'templates/squat-day-a-k3f9.json', content: null },
        ],
        message: 'Sync',
      }),
    ).toEqual({ commit: NEW_COMMIT, tree: NEW_TREE });
  });

  it('commits the base tree itself when nothing changed', async () => {
    const { remote } = github([
      {
        method: 'POST',
        url: `${REPO}/git/commits`,
        body: { message: 'Sync', tree: HEAD_TREE, parents: [HEAD] },
        status: 201,
        reply: { ...createCommitJson, tree: { ...createCommitJson.tree, sha: HEAD_TREE } },
      },
    ]);
    expect(
      await remote.commit({ parent: HEAD, baseTree: HEAD_TREE, changes: [], message: 'Sync' }),
    ).toEqual({ commit: NEW_COMMIT, tree: HEAD_TREE });
  });

  it('moves the branch fast-forward only', async () => {
    const { remote } = github([
      {
        method: 'PATCH',
        url: `${REPO}/git/refs/heads/main`,
        body: { sha: NEW_COMMIT, force: false },
        reply: updateRefJson,
      },
    ]);
    expect(await remote.moveBranch(HEAD, NEW_COMMIT)).toBe('moved');
  });

  it.each([
    ['identical', true],
    ['ahead', true],
    ['behind', false],
    ['diverged', false],
  ])('reads a comparison that is %s as contains = %s', async (status, contains) => {
    const { remote } = github([
      {
        method: 'GET',
        url: `${REPO}/compare/${HEAD}...${NEW_COMMIT}`,
        reply: { ...compareJson, status },
      },
    ]);
    expect(await remote.contains(HEAD, NEW_COMMIT)).toBe(contains);
  });

  it('reads a commit GitHub does not have (404) as in no history', async () => {
    const { remote } = github([
      {
        method: 'GET',
        url: `${REPO}/compare/${OTHER}...${HEAD}`,
        status: 404,
        reply: notFoundJson,
      },
    ]);
    expect(await remote.contains(OTHER, HEAD)).toBe(false);
  });
});

// --- setup: the empty repository --------------------------------------------------------

describe('GitHubRemote: an empty repository', () => {
  it('has no head: GitHub answers 409 for its refs', async () => {
    const { remote } = github([getHead(emptyRepoJson, 409)]);
    expect(await remote.head()).toBeNull();
  });

  it('gets its first commit through the Contents API', async () => {
    const { remote } = github([
      {
        method: 'PUT',
        url: `${REPO}/contents/sisyphos.json`,
        body: { message: 'Start the training log', content: btoa(MARKER) },
        status: 201,
        reply: putContentsJson,
      },
    ]);
    expect(await remote.initEmpty('sisyphos.json', MARKER, 'Start the training log')).toBe(
      putContentsJson.commit.sha,
    );
  });
});

// --- moving the branch: a race, or a refusal --------------------------------------------

describe('GitHubRemote: a refused move', () => {
  const patch = (status: number, reply: unknown): Exchange => ({
    method: 'PATCH',
    url: `${REPO}/git/refs/heads/main`,
    body: { sha: NEW_COMMIT, force: false },
    status,
    reply,
  });
  const headAt = (sha: string) => getHead({ ...refJson, object: { ...refJson.object, sha } });

  it("is a race when a fresh read shows the head moved (422 'not a fast forward')", async () => {
    const { remote } = github([patch(422, notFastForwardJson), headAt(OTHER)]);
    expect(await remote.moveBranch(HEAD, NEW_COMMIT)).toBe('raced');
  });

  it('is a race when a fresh read shows the head moved (409)', async () => {
    const { remote } = github([
      patch(409, { message: 'Reference cannot be updated', status: '409' }),
      headAt(OTHER),
    ]);
    expect(await remote.moveBranch(HEAD, NEW_COMMIT)).toBe('raced');
  });

  /** GitHub's reads of a ref trail its writes: the reads that still show `HEAD` after another device moved it. */
  const stale = (reads: number) => Array.from({ length: reads }, () => headAt(HEAD));
  /** Every read `moveBranch` makes before it gives up on the head moving. */
  const READS = 5;
  const compare = (status: string): Exchange => ({
    method: 'GET',
    url: `${REPO}/compare/${HEAD}...${NEW_COMMIT}`,
    reply: { ...compareJson, status },
  });

  /** `moveBranch` run to its end, its pauses between reads skipped; returns how long they would have been. */
  async function settled<T>(moving: Promise<T>): Promise<{ result: T; waited: number }> {
    const start = Date.now();
    await vi.runAllTimersAsync();
    return { result: await moving, waited: Date.now() - start };
  }

  it('is a race when a read made after a pause shows the head moved', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    const { remote } = github([patch(422, notFastForwardJson), ...stale(2), headAt(OTHER)]);
    const { result, waited } = await settled(remote.moveBranch(HEAD, NEW_COMMIT));
    expect(result).toBe('raced');
    expect(waited).toBe(250 + 500);
  });

  it('is a race when not a fast forward of a descendant, though every read still shows the old head', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const { remote } = github([patch(422, notFastForwardJson), ...stale(READS), compare('ahead')]);
    expect((await settled(remote.moveBranch(HEAD, NEW_COMMIT))).result).toBe('raced');
  });

  it('is a real refusal when not a fast forward of a commit off the old head', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const { remote } = github([
      patch(422, notFastForwardJson),
      ...stale(READS),
      compare('diverged'),
    ]);
    const moving = failure(remote.moveBranch(HEAD, NEW_COMMIT), 'repo');
    await settled(moving);
    expect((await moving).message).toContain('Update is not a fast forward');
  });

  it("is a real refusal, carrying GitHub's message, when the head has not moved", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    const { remote } = github([patch(422, referenceUpdateFailedJson), ...stale(READS)]);
    const moving = failure(remote.moveBranch(HEAD, NEW_COMMIT), 'repo');
    // Bounded: a refusal that is not a race is reported, not retried forever.
    expect((await settled(moving)).waited).toBe(250 + 500 + 1000 + 2000);
    expect((await moving).message).toContain('Reference update failed');
  });

  it('is a missing branch on 404', async () => {
    const { remote } = github([patch(404, notFoundJson)]);
    const error = await failure(remote.moveBranch(HEAD, NEW_COMMIT), 'repo');
    expect(error.message).toContain('main');
  });
});

// --- errors, by class --------------------------------------------

describe('GitHubRemote: failures', () => {
  it('refuses a truncated tree', async () => {
    const { remote } = github([
      getCommit,
      {
        method: 'GET',
        url: `${REPO}/git/trees/${HEAD_TREE}?recursive=1`,
        reply: { ...treeJson, truncated: true },
      },
    ]);
    expect((await failure(remote.tree(HEAD), 'repo')).notFound).toBe(false);
  });

  it('stops on a tree listing that answers for another sha', async () => {
    const { remote } = github([
      getCommit,
      {
        method: 'GET',
        url: `${REPO}/git/trees/${HEAD_TREE}?recursive=1`,
        reply: { ...treeJson, sha: HEAD },
      },
    ]);
    await failure(remote.tree(HEAD), 'bug');
  });

  it('retries when the network fails', async () => {
    const { remote } = github([
      {
        method: 'GET',
        url: `${REPO}/git/ref/heads/main`,
        reject: new TypeError('Failed to fetch'),
      },
    ]);
    const error = await failure(remote.head(), 'retryable');
    expect(error.cause).toBeInstanceOf(TypeError);
  });

  it.each([500, 502, 503, 504])('retries after a %i', async (status) => {
    const { remote } = github([getHead({ message: 'Server Error' }, status)]);
    await failure(remote.head(), 'retryable');
  });

  it('retries when a successful answer arrives cut off', async () => {
    const { remote } = github([getHead('{"ref":"refs/heads/main","object":{"sha":"47d9')]);
    await failure(remote.head(), 'retryable');
  });

  it('asks for a new token on 401', async () => {
    const { remote } = github([getHead(badCredentialsJson, 401)]);
    await failure(remote.head(), 'token');
  });

  it('asks for a token with the Contents permission on a 403 that is not a rate limit', async () => {
    const { remote } = github([
      {
        method: 'POST',
        url: `${REPO}/git/commits`,
        body: { message: 'Sync', tree: HEAD_TREE, parents: [HEAD] },
        status: 403,
        reply: forbiddenJson,
        headers: { 'x-ratelimit-remaining': '4990', 'x-ratelimit-reset': '1790510400' },
      },
    ]);
    const error = await failure(
      remote.commit({ parent: HEAD, baseTree: HEAD_TREE, changes: [], message: 'Sync' }),
      'token',
    );
    expect(error.message).toContain('Contents');
    expect(error.message).toContain('Resource not accessible by personal access token');
  });

  it.each([
    'Repository was archived so is read-only.',
    'Resource protected by organization SAML enforcement. You must grant your Personal Access token access to this organization.',
    "The 'acme' organization forbids access via a fine-grained personal access tokens if the token's lifetime is greater than 366 days.",
  ])('says what GitHub said on a 403 a new permission would not fix: %s', async (message) => {
    const { remote } = github([
      {
        ...getHead({ message, status: '403' }, 403),
        headers: { 'x-ratelimit-remaining': '4990', 'x-ratelimit-reset': '1790510400' },
      },
    ]);
    const error = await failure(remote.head(), 'token');
    expect(error.message).toContain(message);
    expect(error.message).toContain('Contents');
  });

  it('keeps the token out of what GitHub said on a 403', async () => {
    const { remote } = github([getHead({ message: `Token ${TOKEN} is not approved` }, 403)]);
    const error = await failure(remote.head(), 'token');
    expect(error.message).toContain('Token [token] is not approved');
  });

  it('waits for the reset time of a primary rate limit (403, x-ratelimit-remaining: 0)', async () => {
    const { remote } = github([
      {
        ...getHead(rateLimitJson, 403),
        headers: {
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': '1790510400',
          'x-ratelimit-resource': 'core',
        },
      },
    ]);
    const error = await failure(remote.head(), 'rate_limit');
    expect(error.retryAt).toEqual(new Date(1790510400 * 1000));
  });

  it('waits as long as retry-after says (429, secondary rate limit)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-27T12:00:00.000Z'));
    const { remote } = github([
      {
        ...getHead(secondaryRateLimitJson, 429),
        headers: { 'retry-after': '60', 'x-ratelimit-remaining': '4990' },
      },
    ]);
    const error = await failure(remote.head(), 'rate_limit');
    expect(error.retryAt).toEqual(new Date('2026-09-27T12:01:00.000Z'));
  });

  it('prefers retry-after to the reset time when GitHub sends both', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-27T12:00:00.000Z'));
    const { remote } = github([
      {
        ...getHead(secondaryRateLimitJson, 403),
        headers: {
          'retry-after': '30',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': '1790510400',
        },
      },
    ]);
    const error = await failure(remote.head(), 'rate_limit');
    expect(error.retryAt).toEqual(new Date('2026-09-27T12:00:30.000Z'));
  });

  it('waits a minute for a 429 that carries no headers and no message', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-27T12:00:00.000Z'));
    // A 429 is a rate limit whatever it carries.
    const { remote } = github([{ ...getHead(), status: 429, reply: undefined }]);
    const error = await failure(remote.head(), 'rate_limit');
    expect(error.retryAt).toEqual(new Date('2026-09-27T12:01:00.000Z'));
  });

  it('waits a minute for a secondary rate limit that names no time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-27T12:00:00.000Z'));
    const { remote } = github([getHead(secondaryRateLimitJson, 403)]);
    const error = await failure(remote.head(), 'rate_limit');
    expect(error.retryAt).toEqual(new Date('2026-09-27T12:01:00.000Z'));
  });

  it('reports a repository that is gone or invisible (404)', async () => {
    const { remote } = github(
      [{ method: 'GET', url: REPO, status: 404, reply: notFoundJson }],
      null,
    );
    const error = await failure(remote.repoInfo(), 'repo');
    expect(error.message).toContain('lifter/sisyphos-log');
    expect(error.notFound).toBe(true);
  });

  it('reports a missing branch (404)', async () => {
    const { remote } = github([getHead(notFoundJson, 404)]);
    const error = await failure(remote.head(), 'repo');
    expect(error.message).toContain('main');
    expect(error.notFound).toBe(true);
  });

  it('stops on a repository answer with no id', async () => {
    const { id: _, ...withoutId } = repoJson;
    const { remote } = github([{ method: 'GET', url: REPO, reply: withoutId }], null);
    const error = await failure(remote.repoInfo(), 'bug');
    expect(error.message).toContain('id');
  });

  it('reports what GitHub said when it refuses a write (422)', async () => {
    const { remote } = github([
      {
        method: 'POST',
        url: `${REPO}/git/trees`,
        body: {
          base_tree: HEAD_TREE,
          tree: [{ path: 'missing.json', mode: '100644', type: 'blob', sha: null }],
        },
        status: 422,
        reply: { message: 'GitRPC::BadObjectState', status: '422' },
      },
    ]);
    const error = await failure(
      remote.commit({
        parent: HEAD,
        baseTree: HEAD_TREE,
        changes: [{ path: 'missing.json', content: null }],
        message: 'Sync',
      }),
      'repo',
    );
    expect(error.message).toContain('GitRPC::BadObjectState');
    // Found, and refused: setup must not call this "not found".
    expect(error.notFound).toBe(false);
  });

  it('stops on a file whose content does not hash to its sha', async () => {
    const { remote } = github([
      { method: 'GET', url: `${REPO}/git/blobs/${OTHER}`, reply: { ...blobJson, sha: OTHER } },
    ]);
    const error = await failure(remote.blob(OTHER), 'bug');
    expect(error.message).toContain(OTHER);
  });

  it('refuses a file that is not UTF-8 text', async () => {
    const bytes = new Uint8Array([0x7b, 0xff, 0xfe, 0x7d, 0x0a]);
    const { remote } = github([
      {
        method: 'GET',
        url: `${REPO}/git/blobs/${OTHER}`,
        reply: { ...blobJson, sha: OTHER, content: wrapped(base64(bytes)) },
      },
    ]);
    // Not a SyncError: a file that is not text is one file that does not parse,
    // which the sync leaves alone while syncing the rest.
    const error = await remote.blob(OTHER).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(FormatError);
    expect(String((error as Error).message)).not.toContain(TOKEN);
  });

  it('stops on an answer that lacks what the request is for', async () => {
    const { remote } = github([getHead({ ref: 'refs/heads/main' })]);
    await failure(remote.head(), 'bug');
  });

  it('makes no request for the branch before setup has read it', async () => {
    const { remote, sent } = github([], null);
    await failure(remote.head(), 'bug');
    await failure(remote.moveBranch(HEAD, NEW_COMMIT), 'bug');
    expect(sent).toEqual([]);
  });
});

// --- text and the token -----------------------------------------------------------------

describe('GitHubRemote: text', () => {
  it('round-trips multi-byte UTF-8 through base64', async () => {
    const text = 'Supino — 3×8 @ 100 kg, cotovelos a 45°. 🏋️‍♀️ Ωμέγα, 日本語, עברית\n';
    const { remote, sent } = github([
      {
        method: 'PUT',
        url: `${REPO}/contents/notes/caf%C3%A9.md`,
        body: { message: 'x', content: base64(new TextEncoder().encode(text)) },
        status: 201,
        reply: putContentsJson,
      },
      {
        method: 'GET',
        url: `${REPO}/git/blobs/${blobSha(text)}`,
        reply: {
          ...blobJson,
          sha: blobSha(text),
          content: wrapped(base64(new TextEncoder().encode(text))),
        },
      },
    ]);
    await remote.initEmpty('notes/café.md', text, 'x');
    const encoded = (sent[0].body as { content: string }).content;
    expect(new TextDecoder().decode(Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)))).toBe(
      text,
    );
    expect(await remote.blob(blobSha(text))).toBe(text);
  });

  it('keeps a byte-order mark, so the text still hashes to its sha', async () => {
    const text = '﻿{ "format": 1 }\n';
    const { remote } = github([
      {
        method: 'GET',
        url: `${REPO}/git/blobs/${blobSha(text)}`,
        reply: {
          ...blobJson,
          sha: blobSha(text),
          content: wrapped(base64(new TextEncoder().encode(text))),
        },
      },
    ]);
    expect(await remote.blob(blobSha(text))).toBe(text);
  });
});

describe('GitHubRemote: the token', () => {
  it('never reaches an error message, even when GitHub echoes it', async () => {
    const { remote } = github([getHead({ message: `Bad credentials for ${TOKEN}` }, 422)]);
    const error = await failure(remote.head(), 'repo');
    expect(error.message).toContain('[token]');
  });

  it.each([
    ['a "…" from a shortened copy', `${TOKEN.slice(0, 40)}…`],
    ['a space', `${TOKEN.slice(0, 40)} ${TOKEN.slice(40)}`],
    ['a line break', `${TOKEN.slice(0, 40)}\n${TOKEN.slice(40)}`],
  ])('is refused as a token, not as no network, when it holds %s', async (_, token) => {
    // A fetch like the browser's: building the request refuses a header value
    // that is not Latin-1 with a TypeError, as it refuses no network.
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      new Request(input, init);
      return new Response(JSON.stringify(refJson));
    });
    const remote = new GitHubRemote({
      owner: 'lifter',
      repo: 'sisyphos-log',
      token,
      branch: 'main',
      fetch,
    });
    const error = await remote.head().then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(SyncError);
    expect(error).toMatchObject({ kind: 'token', network: false });
    const { message } = error as SyncError;
    expect(message).toContain('characters a GitHub token cannot');
    expect(message).not.toContain(TOKEN.slice(0, 40));
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('GitHubRemote: a request that never answers', () => {
  it('gives up after the timeout, as it would with no network', async () => {
    // Answers only by rejecting when the request's signal aborts, as fetch does.
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    const remote = new GitHubRemote({
      owner: 'lifter',
      repo: 'sisyphos-log',
      token: TOKEN,
      branch: 'main',
      fetch: hanging,
      timeoutMs: 20,
    });
    const error = await failure(remote.head(), 'retryable');
    expect(error.message).toContain('did not answer in time');
    expect(error.network).toBe(true);
  });
});
