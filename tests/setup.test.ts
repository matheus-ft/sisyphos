import { describe, it, expect, vi } from 'vitest';
import { SyncError } from '../src/storage/errors';
import { serializeFormatMarker } from '../src/storage/formats';
import { blobSha } from '../src/storage/hash';
import { FORMAT_PATH, FORMAT_VERSION } from '../src/storage/paths';
import { MemoryRemote } from '../src/storage/remote/memory';
import { setUp, type SetupInput } from '../src/storage/setup';
import { MemoryStore } from '../src/storage/store/memory';

const MARKER = serializeFormatMarker({ format: FORMAT_VERSION });
const INPUT: SetupInput = { owner: 'me', repo: 'sisyphos-log', token: 'github_pat_1' };

/** A device and the repo it is being pointed at. `makeRemote` hands out `remote` whatever it is asked for, and records what it was asked for. */
function harness(remote = new MemoryRemote(), store = new MemoryStore()) {
  const built: Array<SetupInput & { branch: string | null }> = [];
  const deps = {
    store,
    makeRemote: (input: SetupInput & { branch: string | null }) => {
      built.push(input);
      return remote;
    },
  };
  return { remote, store, built, run: (input: SetupInput = INPUT) => setUp(input, deps) };
}

const untouched = { owner: null, repo: null, branch: null, token: null };

describe('setUp: reading the repo', () => {
  it('reads the repo before knowing its branch, then works on its default branch', async () => {
    const h = harness(new MemoryRemote({ defaultBranch: 'trunk' }));
    expect(await h.run()).toEqual({ ok: true, initialised: true });
    expect(h.built).toEqual([
      { ...INPUT, branch: null },
      { ...INPUT, branch: 'trunk' },
    ]);
    expect(await h.store.settings()).toMatchObject({ ...INPUT, branch: 'trunk' });
  });

  it('refuses a public repo, and changes nothing', async () => {
    const h = harness(new MemoryRemote({ private: false }));
    const result = await h.run();
    expect(result).toMatchObject({ ok: false, reason: 'public' });
    expect(!result.ok && result.message).toMatch(/private/);
    expect(h.remote.calls).toEqual(['repoInfo']);
    expect(await h.store.settings()).toMatchObject(untouched);
  });

  it('reports a repo it cannot find, in the words the adapter used', async () => {
    const h = harness();
    const message =
      'me/sisyphos-log was not found. Check the name, and that the token was given access to it';
    h.remote.failNext('repoInfo', new SyncError('repo', message));
    expect(await h.run()).toEqual({ ok: false, reason: 'not_found', message });
    expect(await h.store.settings()).toMatchObject(untouched);
  });

  it('reports a token GitHub did not accept', async () => {
    const h = harness();
    h.remote.failNext('repoInfo', new SyncError('token', 'GitHub did not accept the token'));
    expect(await h.run()).toMatchObject({ ok: false, reason: 'token' });
  });

  it('reports no network, and a rate limit, as something to try again', async () => {
    for (const error of [
      new SyncError('retryable', 'Could not reach GitHub', { cause: new TypeError('offline') }),
      new SyncError('rate_limit', 'Rate limited', { retryAt: new Date() }),
    ]) {
      const h = harness();
      h.remote.failNext('repoInfo', error);
      expect(await h.run()).toEqual({ ok: false, reason: 'network', message: error.message });
    }
  });

  it('reports a token refused a write as a token problem', async () => {
    // Write access is proven by the first commit (section 8).
    const h = harness();
    const message =
      'GitHub refused the token access to me/sisyphos-log: it needs the Contents permission, read and write';
    h.remote.failNext('commit', new SyncError('token', message));
    expect(await h.run()).toEqual({ ok: false, reason: 'token', message });
    expect(await h.store.settings()).toMatchObject(untouched);
  });

  it('lets anything that is not a remote failure through', async () => {
    const h = harness();
    h.remote.failNext('head', new TypeError('broken'));
    await expect(h.run()).rejects.toThrow('broken');
  });
});

describe('setUp: making the repo a log', () => {
  it('starts a log in an empty repository through the Contents API', async () => {
    const h = harness(new MemoryRemote({ empty: true }));
    expect(await h.run()).toEqual({ ok: true, initialised: true });
    expect(h.remote.calls).toContain('initEmpty');
    expect(h.remote.files()).toEqual(new Map([[FORMAT_PATH, MARKER]]));
  });

  it('adds the marker to a repo holding only a README, keeping the README', async () => {
    const h = harness();
    const readme = h.remote.files().get('README.md');
    expect(await h.run()).toEqual({ ok: true, initialised: true });
    expect(h.remote.files()).toEqual(
      new Map([
        ['README.md', readme],
        [FORMAT_PATH, MARKER],
      ]),
    );
    expect(h.remote.commitCount()).toBe(2);
    expect(h.remote.calls).not.toContain('initEmpty');
  });

  it('treats licenses and .gitignore as part of a new repo too', async () => {
    const h = harness();
    h.remote.externalCommit([
      { path: 'LICENSE', content: 'MIT\n' },
      { path: 'LICENSE.md', content: 'MIT\n' },
      { path: '.gitignore', content: '*.tmp\n' },
      { path: 'readme.txt', content: 'hi\n' },
    ]);
    expect(await h.run()).toEqual({ ok: true, initialised: true });
    expect(h.remote.files().get(FORMAT_PATH)).toBe(MARKER);
    expect(h.remote.files().size).toBe(6);
  });

  it('adds the marker to a repo with no files at all', async () => {
    const h = harness();
    h.remote.externalCommit([{ path: 'README.md', content: null }]);
    expect(await h.run()).toEqual({ ok: true, initialised: true });
    expect(h.remote.files()).toEqual(new Map([[FORMAT_PATH, MARKER]]));
  });

  it('refuses a repo holding anything else, and changes nothing', async () => {
    for (const path of ['notes.md', 'docs/README.md', 'sessions/2026/2026-09-14-k3f9.json']) {
      const h = harness();
      h.remote.externalCommit([{ path, content: 'mine\n' }]);
      const commits = h.remote.commitCount();
      const result = await h.run();
      expect(result).toMatchObject({ ok: false, reason: 'not_a_log' });
      expect(h.remote.commitCount()).toBe(commits);
      expect(await h.store.settings()).toMatchObject(untouched);
    }
  });

  it('accepts a log as it is', async () => {
    const h = harness();
    h.remote.externalCommit([
      { path: FORMAT_PATH, content: MARKER },
      { path: 'notes.md', content: 'my own notes\n' },
    ]);
    const commits = h.remote.commitCount();
    expect(await h.run()).toEqual({ ok: true, initialised: false });
    expect(h.remote.commitCount()).toBe(commits);
    expect(h.remote.calls).not.toContain('commit');
    expect(h.remote.calls).not.toContain('moveBranch');
  });

  it('refuses a log in a newer format, asking for an update', async () => {
    const h = harness();
    h.remote.externalCommit([
      { path: FORMAT_PATH, content: serializeFormatMarker({ format: FORMAT_VERSION + 1 }) },
    ]);
    const result = await h.run();
    expect(result).toMatchObject({ ok: false, reason: 'needs_update' });
    expect(!result.ok && result.message).toMatch(/Update the app/);
    expect(await h.store.settings()).toMatchObject(untouched);
  });

  it('refuses a marker it cannot read', async () => {
    const h = harness();
    h.remote.externalCommit([{ path: FORMAT_PATH, content: '{"format": "one"}\n' }]);
    expect(await h.run()).toMatchObject({ ok: false, reason: 'not_a_log' });
  });

  it('looks again when the repo moves under it', async () => {
    const h = harness();
    h.remote.beforeMove = () => {
      h.remote.beforeMove = null;
      h.remote.externalCommit([{ path: 'LICENSE', content: 'MIT\n' }]);
    };
    expect(await h.run()).toEqual({ ok: true, initialised: true });
    expect([...h.remote.files().keys()].sort()).toEqual(['LICENSE', 'README.md', FORMAT_PATH]);
  });

  it('takes a log another device started meanwhile as it is', async () => {
    const h = harness();
    h.remote.beforeMove = () => {
      h.remote.beforeMove = null;
      h.remote.externalCommit([{ path: FORMAT_PATH, content: MARKER }]);
    };
    expect(await h.run()).toEqual({ ok: true, initialised: false });
    expect(h.remote.files().get(FORMAT_PATH)).toBe(MARKER);
  });

  it('looks again when an empty repo gets its first commit meanwhile', async () => {
    const remote = new MemoryRemote({ empty: true });
    vi.spyOn(remote, 'initEmpty').mockImplementationOnce(async () => {
      remote.externalCommit([{ path: 'README.md', content: '# log\n' }]);
      throw new SyncError('repo', 'GitHub refused the request: The repository is not empty');
    });
    const h = harness(remote);
    expect(await h.run()).toEqual({ ok: true, initialised: true });
    expect([...remote.files().keys()].sort()).toEqual(['README.md', FORMAT_PATH]);
  });

  it('gives up on a repo that keeps changing, as something to try again', async () => {
    const h = harness();
    let n = 0;
    h.remote.beforeMove = () =>
      h.remote.externalCommit([{ path: 'README.md', content: `${++n}\n` }]);
    const result = await h.run();
    expect(result).toMatchObject({ ok: false, reason: 'network' });
    expect(n).toBe(5);
    expect(await h.store.settings()).toMatchObject(untouched);
  });

  it('does not sync: the caller runs the first sync', async () => {
    const store = new MemoryStore();
    await store.exclusive((s) =>
      s.apply([{ op: 'content', path: 'lifter/bodyweight.csv', text: 'x\n' }]),
    );
    const h = harness(new MemoryRemote(), store);
    await h.run();
    expect(h.remote.files().has('lifter/bodyweight.csv')).toBe(false);
    expect(await store.meta()).toEqual({ last_synced_head: null, last_synced_tree: null });
    expect(await store.content('lifter/bodyweight.csv')).toBe('x\n');
  });
});

describe('setUp: saving the settings', () => {
  /** A device that has synced with me/sisyphos-log on main: a base, a head, an in-flight commit. */
  async function syncedDevice(): Promise<MemoryStore> {
    const store = new MemoryStore();
    await store.saveSettings({ ...INPUT, branch: 'main' });
    await store.exclusive((s) =>
      s.apply([
        { op: 'content', path: 'lifter/bodyweight.csv', text: 'x\n' },
        { op: 'base', path: 'lifter/bodyweight.csv', sha: blobSha('x\n'), body: 'x\n' },
        { op: 'meta', meta: { last_synced_head: 'abc', last_synced_tree: 'def' } },
        { op: 'inflight', inflight: { commit: 'c', tree: 't', parent: 'abc', pushed: [] } },
      ]),
    );
    return store;
  }

  async function logRepo(options: { defaultBranch?: string } = {}): Promise<MemoryRemote> {
    const remote = new MemoryRemote(options);
    remote.externalCommit([{ path: FORMAT_PATH, content: MARKER }]);
    return remote;
  }

  it('saves owner, repo, branch and token', async () => {
    const h = harness(await logRepo());
    await h.run();
    const settings = await h.store.settings();
    expect(settings).toMatchObject({ ...INPUT, branch: 'main' });
  });

  it('keeps everything but the token when a new token is pasted for the same repo', async () => {
    const store = await syncedDevice();
    const reset = vi.spyOn(store, 'resetSync');
    const h = harness(await logRepo(), store);
    expect(await h.run({ ...INPUT, token: 'github_pat_2' })).toEqual({
      ok: true,
      initialised: false,
    });
    expect(reset).not.toHaveBeenCalled();
    expect(await store.settings()).toMatchObject({ token: 'github_pat_2', branch: 'main' });
    expect(await store.entry('lifter/bodyweight.csv')).toMatchObject({ base_sha: blobSha('x\n') });
    expect(await store.meta()).toEqual({ last_synced_head: 'abc', last_synced_tree: 'def' });
    expect(await store.inflight()).not.toBeNull();
  });

  it('knows the same repo written with other capitals, as GitHub does', async () => {
    const store = await syncedDevice();
    const reset = vi.spyOn(store, 'resetSync');
    const h = harness(await logRepo(), store);
    await h.run({ ...INPUT, owner: 'Me', repo: 'Sisyphos-Log' });
    expect(reset).not.toHaveBeenCalled();
  });

  it('forgets the old repo before saving another, keeping every change on the device', async () => {
    const store = await syncedDevice();
    const order: string[] = [];
    const reset = vi.spyOn(store, 'resetSync');
    const save = vi.spyOn(store, 'saveSettings');
    reset.mockImplementation(async function (this: MemoryStore) {
      order.push('resetSync');
      return MemoryStore.prototype.resetSync.call(this);
    });
    save.mockImplementation(async function (this: MemoryStore, patch) {
      order.push('saveSettings');
      return MemoryStore.prototype.saveSettings.call(this, patch);
    });
    const h = harness(await logRepo(), store);
    await h.run({ ...INPUT, repo: 'another-log' });

    expect(order).toEqual(['resetSync', 'saveSettings']);
    expect(await store.settings()).toMatchObject({ repo: 'another-log' });
    expect(await store.entry('lifter/bodyweight.csv')).toMatchObject({
      base_sha: null,
      local_sha: blobSha('x\n'),
    });
    expect(await store.meta()).toEqual({ last_synced_head: null, last_synced_tree: null });
    expect(await store.inflight()).toBeNull();
    expect(await store.content('lifter/bodyweight.csv')).toBe('x\n');
  });

  it('forgets the old repo for another owner too', async () => {
    const store = await syncedDevice();
    const reset = vi.spyOn(store, 'resetSync');
    const h = harness(await logRepo(), store);
    await h.run({ ...INPUT, owner: 'someone-else' });
    expect(reset).toHaveBeenCalledOnce();
  });

  it('forgets the old history when the default branch is another', async () => {
    const store = await syncedDevice();
    const reset = vi.spyOn(store, 'resetSync');
    const h = harness(await logRepo({ defaultBranch: 'trunk' }), store);
    await h.run();
    expect(reset).toHaveBeenCalledOnce();
    expect(await store.settings()).toMatchObject({ branch: 'trunk' });
  });

  it('starts a device that logged before setup from null bases, keeping what it logged', async () => {
    const store = new MemoryStore();
    await store.exclusive((s) =>
      s.apply([{ op: 'content', path: 'lifter/bodyweight.csv', text: 'x\n' }]),
    );
    const h = harness(await logRepo(), store);
    await h.run();
    expect(await store.entry('lifter/bodyweight.csv')).toMatchObject({
      base_sha: null,
      local_sha: blobSha('x\n'),
    });
  });

  it('touches neither the settings nor the sync state when setup is refused', async () => {
    const store = await syncedDevice();
    const reset = vi.spyOn(store, 'resetSync');
    const remote = new MemoryRemote({ private: false });
    const h = harness(remote, store);
    await h.run({ ...INPUT, repo: 'public-repo' });
    expect(reset).not.toHaveBeenCalled();
    expect(await store.settings()).toMatchObject({ ...INPUT, branch: 'main' });
    expect(await store.meta()).toEqual({ last_synced_head: 'abc', last_synced_tree: 'def' });
  });
});
