import { describe, it, expect, vi } from 'vitest';
import type { ConflictRecord, Session } from '../src/model';
import {
  githubRemote,
  maskToken,
  parseRepo,
  remoteFromSettings,
  startStorage,
  type ClosableStore,
  type MakeRemote,
  type RemoteConfig,
} from '../src/storage/app';
import { FORMAT_PATH, sessionPath } from '../src/storage/paths';
import { GitHubRemote } from '../src/storage/remote/github';
import { MemoryRemote } from '../src/storage/remote/memory';
import type { Remote } from '../src/storage/remote/remote';
import type { StatusSnapshot } from '../src/storage/status';
import { MemoryStore } from '../src/storage/store/memory';
import type { Settings } from '../src/storage/store/store';

const SET_UP: Settings = {
  owner: 'me',
  repo: 'sisyphos-log',
  branch: 'main',
  token: 'github_pat_test',
  device_id: 'device-a',
};

describe('remoteFromSettings', () => {
  it('is null until owner, repo, token and branch are all stored', () => {
    const make = () => new MemoryRemote();
    for (const missing of ['owner', 'repo', 'token', 'branch'] as const) {
      expect(remoteFromSettings({ ...SET_UP, [missing]: null }, make)).toBeNull();
      expect(remoteFromSettings({ ...SET_UP, [missing]: '' }, make)).toBeNull();
    }
  });

  it('builds the remote from exactly the stored settings', () => {
    const built: RemoteConfig[] = [];
    const remote = new MemoryRemote();
    const found = remoteFromSettings(SET_UP, (config) => {
      built.push(config);
      return remote;
    });
    expect(found).toBe(remote);
    expect(built).toEqual([
      { owner: 'me', repo: 'sisyphos-log', token: 'github_pat_test', branch: 'main' },
    ]);
  });

  it('builds the GitHub adapter by default, with the fetch it is given', () => {
    const fetchImpl: typeof fetch = () => Promise.reject(new Error('not called'));
    const byDefault = remoteFromSettings(SET_UP);
    expect(byDefault).toBeInstanceOf(GitHubRemote);
    expect((byDefault as GitHubRemote).options).toMatchObject({ owner: 'me', branch: 'main' });
    const watched = remoteFromSettings(SET_UP, githubRemote(fetchImpl)) as GitHubRemote;
    expect(watched.options.fetch).toBe(fetchImpl);
  });
});

describe('parseRepo', () => {
  it.each([
    ['me/sisyphos-log', 'me', 'sisyphos-log'],
    ['  me/sisyphos-log  ', 'me', 'sisyphos-log'],
    ['https://github.com/me/sisyphos-log', 'me', 'sisyphos-log'],
    ['github.com/me/sisyphos-log/', 'me', 'sisyphos-log'],
    ['https://www.github.com/Me-2/log.v2.git', 'Me-2', 'log.v2'],
    ['me/my_log', 'me', 'my_log'],
  ])('reads %j as %s/%s', (text, owner, repo) => {
    expect(parseRepo(text)).toEqual({ owner, repo });
  });

  it.each(['', 'me', 'me/', '/log', 'me/log/extra', 'me/ log', 'https://gitlab.com/me/log'])(
    'refuses %j',
    (text) => {
      expect(parseRepo(text)).toBeNull();
    },
  );
});

describe('maskToken', () => {
  it('shows the kind of token and its last four characters, nothing else', () => {
    const token = 'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz';
    expect(maskToken(token)).toBe('github_pat_…wxyz');
    expect(maskToken('ghp_0123456789abcdefghijklmnopqrstuvwxyz')).toBe('ghp_…wxyz');
  });

  it('shows none of a token too short to spare four characters', () => {
    expect(maskToken('github_pat_short')).toBe('github_pat_…');
    expect(maskToken('hunter2')).toBe('…');
  });

  it('says when there is no token', () => {
    expect(maskToken(null)).toBe('none');
    expect(maskToken('')).toBe('none');
  });
});

// --- startStorage ----------------------------------------------------------------------

/** A window with just what the scheduler listens to. */
function fakeWindow() {
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  return Object.assign(new EventTarget(), { document });
}

async function start(remote = new MemoryRemote(), makeRemote: MakeRemote = () => remote) {
  const store = Object.assign(new MemoryStore(), { closed: false, close: () => {} });
  store.close = () => {
    store.closed = true;
  };
  const statuses: StatusSnapshot[] = [];
  const announced: ConflictRecord[][] = [];
  const target = fakeWindow();
  const storage = await startStorage({
    target: target as unknown as Window,
    openStore: async (): Promise<ClosableStore> => store,
    makeRemote,
    shipped: [],
    onStatus: (status) => statuses.push(status),
    onConflicts: (conflicts) => announced.push(conflicts),
  });
  return { storage, store, remote, target, statuses, announced };
}

describe('startStorage', () => {
  it('launches without a remote, and says the device is not set up', async () => {
    const { storage, remote } = await start();
    await storage.scheduler.trigger('launch');
    const status = await storage.scheduler.status();
    expect(status.status).toBe('not_set_up');
    expect(status.exposure.level).toBe('unprotected');
    expect(remote.calls).toEqual([]);
    storage.dispose();
  });

  it('sets up, then runs the first sync, and syncs what is written afterwards', async () => {
    const { storage, remote, statuses } = await start();
    expect(await storage.connect({ owner: 'me', repo: 'log', token: 'github_pat_x' })).toEqual({
      ok: true,
      initialised: true,
    });
    // The first sync was started by `connect`; this one folds into it or follows it.
    await storage.scheduler.trigger('manual');
    expect(statuses.at(-1)).toMatchObject({ status: 'idle', exposure: { level: 'safe' } });
    expect(await storage.store.content(FORMAT_PATH)).toBe(remote.files().get(FORMAT_PATH));

    const id = await storage.log.newSessionId('2026-09-27');
    await storage.log.putSession({
      id,
      date: '2026-09-27',
      started_at: '2026-09-27T07:00:00.000Z',
      tz: 'UTC',
      time_precision: 'instant',
      ended_at: '2026-09-27T08:00:00.000Z',
      label: { name: null, block: null, week: null, day: null, weekday: null },
      bodyweight_kg: null,
      notes: null,
      exercises: [],
      created_at: '2026-09-27T07:00:00.000Z',
      updated_at: '2026-09-27T07:00:00.000Z',
      device_id: 'ignored',
    });
    expect((await storage.scheduler.status()).exposure.level).toBe('pending');
    await storage.scheduler.trigger('manual');
    expect((await storage.scheduler.status()).exposure.level).toBe('safe');
    expect(remote.files().has(`sessions/2026/${id}.json`)).toBe(true);
    storage.dispose();
  });

  it('reports a refused setup, and does not sync', async () => {
    const { storage, remote } = await start(new MemoryRemote({ private: false }));
    const result = await storage.connect({ owner: 'me', repo: 'log', token: 'github_pat_x' });
    expect(result).toMatchObject({ ok: false, reason: 'public' });
    await storage.scheduler.trigger('launch');
    expect(remote.calls).toEqual(['repoInfo']);
    expect((await storage.scheduler.status()).status).toBe('not_set_up');
    storage.dispose();
  });

  it('syncs when the app is left, until disposed, and closes the store on dispose', async () => {
    const { storage, remote, store, target } = await start();
    await storage.connect({ owner: 'me', repo: 'log', token: 'github_pat_x' });
    await storage.scheduler.trigger('manual');
    const before = remote.calls.length;

    // Leaving, with no session in progress, syncs: at least the head is read.
    target.dispatchEvent(new Event('pagehide'));
    await vi.waitFor(() => expect(remote.calls.length).toBeGreaterThan(before));
    await storage.scheduler.trigger('manual');

    storage.dispose();
    expect(store.closed).toBe(true);
    const after = remote.calls.length;
    target.dispatchEvent(new Event('pagehide'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(remote.calls.length).toBe(after);
  });
});

// --- pointing the device at another repo ------------------------------------

/** A remote whose next `head` waits until the test lets it answer: a sync caught partway. */
class GatedRemote extends MemoryRemote {
  private gate: { reached: () => void; opened: Promise<void> } | null = null;

  /** Holds the next `head`. `reached` resolves once a caller is waiting on it. */
  holdHead(): { reached: Promise<void>; release: () => void } {
    let reached!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => (reached = resolve));
    const opened = new Promise<void>((resolve) => (release = resolve));
    this.gate = { reached, opened };
    return { reached: waiting, release };
  }

  override async head(): Promise<string | null> {
    const gate = this.gate;
    this.gate = null;
    if (gate) {
      gate.reached();
      await gate.opened;
    }
    return super.head();
  }
}

/** A session the lifter has finished, so none is in progress. */
function finished(id: string): Session {
  return {
    id,
    date: '2026-09-27',
    started_at: '2026-09-27T07:00:00.000Z',
    tz: 'UTC',
    time_precision: 'instant',
    ended_at: '2026-09-27T08:00:00.000Z',
    label: { name: null, block: null, week: null, day: null, weekday: null },
    bodyweight_kg: null,
    notes: null,
    exercises: [],
    created_at: '2026-09-27T07:00:00.000Z',
    updated_at: '2026-09-27T07:00:00.000Z',
    device_id: 'ignored',
  };
}

/**
 * A device set up with the log repo `old`, holding one session synced to it,
 * ready to be pointed at the repo `new`.
 */
async function syncedToOld() {
  const old = new GatedRemote();
  const next = new MemoryRemote();
  const remotes: Record<string, Remote> = { old, new: next };
  const started = await start(old, (config) => remotes[config.repo]);
  const { storage } = started;
  expect(await storage.connect({ owner: 'me', repo: 'old', token: 'github_pat_x' })).toMatchObject({
    ok: true,
  });
  const id = await storage.log.newSessionId('2026-09-27');
  await storage.log.putSession(finished(id));
  await storage.scheduler.trigger('manual');
  expect(old.files().has(sessionPath(id))).toBe(true);
  return { ...started, old, next, id };
}

describe('startStorage: pointing the device at another repo while a sync runs', () => {
  it('keeps every record, and the new repo receives them', async () => {
    const { storage, old, next, id } = await syncedToOld();

    // A sync against the old repo is partway through when the lifter points
    // the device at the new one.
    const held = old.holdHead();
    const running = storage.scheduler.trigger('manual');
    await held.reached;
    const connecting = storage.connect({ owner: 'me', repo: 'new', token: 'github_pat_x' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    held.release();
    await running;
    expect(await connecting).toEqual({ ok: true, initialised: true });

    // The first sync with the new repo is a first sync: nothing of the old
    // repo's history is compared against it, so nothing reads as deleted.
    await storage.scheduler.trigger('manual');
    expect(await storage.log.getSession(id)).not.toBeNull();
    expect(next.files().has(sessionPath(id))).toBe(true);
    expect((await storage.scheduler.status()).exposure.level).toBe('safe');
    storage.dispose();
  });

  it('waits for the sync before reading the new repo or changing anything', async () => {
    const { storage, store, old, next } = await syncedToOld();
    const before = { settings: await store.settings(), entries: await store.entries() };

    const held = old.holdHead();
    const running = storage.scheduler.trigger('manual');
    await held.reached;
    let settled = false;
    const connecting = storage
      .connect({ owner: 'me', repo: 'new', token: 'github_pat_x' })
      .finally(() => (settled = true));
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(settled).toBe(false);
      expect(next.calls).toEqual([]);
      expect(await store.settings()).toEqual(before.settings);
      expect(await store.entries()).toEqual(before.entries);
    } finally {
      held.release();
    }
    await running;
    expect(await connecting).toMatchObject({ ok: true });
    expect(next.calls[0]).toBe('repoInfo');
    expect(await store.settings()).toMatchObject({ repo: 'new' });
    storage.dispose();
  });
});
