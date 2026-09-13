import { describe, it, expect, vi } from 'vitest';
import { GitHubSync } from '../src/storage/github';
import { Conflict } from '../src/storage/SyncAdapter';

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

type Call = { url: string; init: RequestInit };

function stub(responses: Array<{ status: number; body?: unknown }>) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const r = responses.shift() ?? { status: 500 };
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  const sync = new GitHubSync({
    owner: 'matheus-ft',
    repo: 'sisyphos-log',
    token: 'tok',
    fetchImpl,
  });
  return { sync, calls };
}

describe('configuration', () => {
  it('is unconfigured without a token, so exposure can say so', () => {
    const s = new GitHubSync({ owner: 'o', repo: 'r', token: '' });
    expect(s.isConfigured()).toBe(false);
  });

  it('authenticates every request as the lifter', async () => {
    const { sync, calls } = stub([{ status: 404 }]);
    await sync.pull('lifter/bodyweight.csv');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });
});

describe('repo creation', () => {
  it('creates the log repo privately when it does not exist', async () => {
    const { sync, calls } = stub([
      { status: 404 },
      { status: 201, body: { name: 'sisyphos-log' } },
    ]);
    expect(await sync.ensureRepo()).toBe('created');
    const body = JSON.parse(calls[1].init.body as string);
    expect(calls[1].url).toContain('/user/repos');
    expect(body.private).toBe(true);
  });

  it('leaves an existing repo alone', async () => {
    const { sync, calls } = stub([{ status: 200, body: { name: 'sisyphos-log' } }]);
    expect(await sync.ensureRepo()).toBe('exists');
    expect(calls).toHaveLength(1);
  });
});

describe('reading', () => {
  it('decodes content and returns the sha to write against', async () => {
    const { sync } = stub([
      { status: 200, body: { content: b64('hello'), sha: 'abc', encoding: 'base64' } },
    ]);
    expect(await sync.pull('a.txt')).toEqual({ body: 'hello', sha: 'abc' });
  });

  it('copes with the newlines GitHub puts in its base64', async () => {
    const chunked = b64('a session').replace(/(.{4})/g, '$1\n');
    const { sync } = stub([
      { status: 200, body: { content: chunked, sha: 'x', encoding: 'base64' } },
    ]);
    expect((await sync.pull('a.json'))?.body).toBe('a session');
  });

  it('survives a round trip of non-ASCII notes', async () => {
    const text = 'notes: "sentiu o quadríceps" — 日本語 · 100kg';
    const { sync } = stub([
      { status: 200, body: { content: b64(text), sha: 'x', encoding: 'base64' } },
    ]);
    expect((await sync.pull('a.json'))?.body).toBe(text);
  });

  it('treats a missing file as absent rather than an error', async () => {
    const { sync } = stub([{ status: 404 }]);
    expect(await sync.pull('nope.json')).toBeNull();
  });
});

describe('writing', () => {
  it('sends the base sha, which is what makes the write compare-and-swap', async () => {
    const { sync, calls } = stub([{ status: 200, body: { content: { sha: 'new' } } }]);
    const out = await sync.push('a.json', 'body', 'old', 'msg');
    expect(out.sha).toBe('new');
    expect(JSON.parse(calls[0].init.body as string).sha).toBe('old');
  });

  it('omits the sha when creating a file that does not exist yet', async () => {
    const { sync, calls } = stub([{ status: 200, body: { content: { sha: 'new' } } }]);
    await sync.push('a.json', 'body', null, 'msg');
    expect(JSON.parse(calls[0].init.body as string).sha).toBeUndefined();
  });

  it('raises a conflict when another device moved the file, and never overwrites', async () => {
    const { sync } = stub([
      { status: 409 },
      { status: 200, body: { content: b64('theirs'), sha: 'theirs-sha', encoding: 'base64' } },
    ]);
    await expect(sync.push('a.json', 'mine', 'stale', 'msg')).rejects.toBeInstanceOf(Conflict);
  });

  it('treats a rejected missing-sha write as the same conflict', async () => {
    const { sync } = stub([
      { status: 422 },
      { status: 200, body: { content: b64('theirs'), sha: 's', encoding: 'base64' } },
    ]);
    await expect(sync.push('a.json', 'mine', null, 'msg')).rejects.toBeInstanceOf(Conflict);
  });

  it('hands back the other version so the caller can show both', async () => {
    const { sync } = stub([
      { status: 409 },
      { status: 200, body: { content: b64('theirs'), sha: 'theirs-sha', encoding: 'base64' } },
    ]);
    await expect(sync.push('a.json', 'mine', 'stale', 'msg')).rejects.toMatchObject({
      path: 'a.json',
      remoteSha: 'theirs-sha',
    });
  });

  it('explains an auth failure in terms of the token', async () => {
    const { sync } = stub([{ status: 403, body: { message: 'Resource not accessible' } }]);
    await expect(sync.push('a.json', 'b', null, 'm')).rejects.toThrow(/contents:write/);
  });
});

describe('listing', () => {
  it('walks the year directories so a restore sees every session', async () => {
    const { sync } = stub([
      { status: 200, body: [{ path: 'sessions/2026', sha: 'd', type: 'dir' }] },
      {
        status: 200,
        body: [
          { path: 'sessions/2026/a.json', sha: 's1', type: 'file' },
          { path: 'sessions/2026/b.json', sha: 's2', type: 'file' },
        ],
      },
    ]);
    expect(await sync.list('sessions')).toEqual([
      { path: 'sessions/2026/a.json', sha: 's1' },
      { path: 'sessions/2026/b.json', sha: 's2' },
    ]);
  });

  it('returns nothing for a prefix that is not there yet', async () => {
    const { sync } = stub([{ status: 404 }]);
    expect(await sync.list('sessions')).toEqual([]);
  });
});
