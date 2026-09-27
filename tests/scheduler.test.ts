import { describe, it, expect, vi } from 'vitest';
import type { ConflictRecord, Session } from '../src/model';
import type { LibraryConflict } from '../src/library/assemble';
import type { Mode } from '../src/storage/decide';
import { SyncError } from '../src/storage/errors';
import type { Log } from '../src/storage/log';
import { MemoryRemote } from '../src/storage/remote/memory';
import type { Remote } from '../src/storage/remote/remote';
import {
  IN_PROGRESS_MS,
  Scheduler,
  sessionInProgress,
  type Locks,
  type Trigger,
} from '../src/storage/scheduler';
import type { StatusSnapshot } from '../src/storage/status';
import { MemoryStore } from '../src/storage/store/memory';
import type { SyncDeps, SyncResult } from '../src/storage/sync';

const T0 = Date.parse('2026-09-27T10:00:00.000Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** Lets every pending promise chain run to completion (or to whatever it is waiting on). */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// --- fakes ----------------------------------------------------------------------------

/** Timers and a clock under the test's control. */
class Timers {
  now = T0;
  private next = 0;
  pending: Array<{ id: number; at: number; fn: () => void }> = [];

  set = (fn: () => void, ms: number): unknown => {
    const id = ++this.next;
    this.pending.push({ id, at: this.now + ms, fn });
    return id;
  };

  clear = (handle: unknown): void => {
    this.pending = this.pending.filter((timer) => timer.id !== handle);
  };

  clock = (): Date => new Date(this.now);

  /** When the earliest armed timer fires, in ms from now; null when none is armed. */
  due(): number | null {
    if (this.pending.length === 0) return null;
    return Math.min(...this.pending.map((timer) => timer.at)) - this.now;
  }

  /** Moves the clock on, firing every timer that falls due on the way, in order. */
  async advance(ms: number): Promise<void> {
    const end = this.now + ms;
    for (;;) {
      const timer = [...this.pending].sort((a, b) => a.at - b.at).find((t) => t.at <= end);
      if (!timer) break;
      this.pending = this.pending.filter((t) => t !== timer);
      this.now = timer.at;
      timer.fn();
      await flush();
    }
    this.now = end;
    await flush();
  }
}

/** The part of `Log` the scheduler reads. */
class FakeLog {
  open: Session[] = [];
  conflicts: ConflictRecord[] = [];
  libraryConflicts: LibraryConflict[] = [];

  async listOpenSessions(): Promise<Session[]> {
    return this.open.filter((session) => session.ended_at === null);
  }
  async getConflicts(): Promise<ConflictRecord[]> {
    return [...this.conflicts];
  }
  async library() {
    return { exercises: [], conflicts: [...this.libraryConflicts], fixes: [] };
  }
}

function result(overrides: Partial<SyncResult> = {}): SyncResult {
  return {
    head: 'head',
    committed: null,
    pushed: [],
    taken: [],
    conflicts: [],
    unreadable: [],
    ...overrides,
  };
}

/** A sync that waits until the test lets it finish. */
class Held {
  readonly promise: Promise<SyncResult>;
  resolve!: (value?: SyncResult) => void;
  reject!: (error: Error) => void;
  constructor() {
    this.promise = new Promise<SyncResult>((resolve, reject) => {
      this.resolve = (value) => resolve(value ?? result());
      this.reject = reject;
    });
  }
}

type Step = SyncResult | Error | Held | ((mode: Mode) => Promise<SyncResult>);

/** `runSync`, scripted: each call takes the next step; calls past the script succeed quietly. */
class ScriptedSync {
  readonly modes: Mode[] = [];
  readonly deps: SyncDeps[] = [];
  active = 0;
  maxActive = 0;
  private readonly script: Step[] = [];

  then(...steps: Step[]): this {
    this.script.push(...steps);
    return this;
  }

  hold(): Held {
    const held = new Held();
    this.script.push(held);
    return held;
  }

  run = async (deps: SyncDeps, mode: Mode): Promise<SyncResult> => {
    this.modes.push(mode);
    this.deps.push(deps);
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      const step = this.script.shift() ?? result();
      if (step instanceof Held) return await step.promise;
      if (step instanceof Error) throw step;
      if (typeof step === 'function') return await step(mode);
      return step;
    } finally {
      this.active--;
    }
  };
}

/** Web Locks with one queue per name, shared by the "tabs" given it. */
class FakeLocks implements Locks {
  readonly requested: string[] = [];
  held = false;
  private tail: Promise<unknown> = Promise.resolve();

  request<T>(name: string, callback: () => Promise<T>): Promise<T> {
    this.requested.push(name);
    const run = this.tail.then(async () => {
      this.held = true;
      try {
        return await callback();
      } finally {
        this.held = false;
      }
    });
    this.tail = run.catch(() => undefined);
    return run;
  }
}

const network = () =>
  new SyncError('retryable', 'Could not reach GitHub', { cause: new TypeError('Failed to fetch') });
const serverError = () => new SyncError('retryable', 'GitHub failed (HTTP 502)');

function conflict(id: string): ConflictRecord {
  return {
    id,
    path: 'lifter/bodyweight.csv',
    key: { date: '2026-09-27' },
    found_at: '2026-09-27T10:00:00.000Z',
    device_id: 'tablet',
    version: null,
  };
}

/** A session written `ago` ms before the clock's now; open unless `ended`. */
function session(timers: Timers, ago: number, ended = false): Session {
  const at = new Date(timers.now - ago).toISOString();
  return {
    id: '2026-09-27-k3f9',
    date: '2026-09-27',
    started_at: at,
    tz: 'Europe/Lisbon',
    time_precision: 'instant',
    ended_at: ended ? at : null,
    label: { name: null, block: null, week: null, day: null, weekday: null },
    bodyweight_kg: null,
    notes: null,
    exercises: [],
    created_at: at,
    updated_at: at,
    device_id: 'phone',
  };
}

function setup(options: { setUp?: boolean; locks?: Locks | null; sync?: ScriptedSync } = {}) {
  const timers = new Timers();
  const store = new MemoryStore({ now: timers.clock, deviceId: 'phone' });
  const log = new FakeLog();
  const sync = options.sync ?? new ScriptedSync();
  const statuses: StatusSnapshot[] = [];
  const announced: ConflictRecord[][] = [];
  let remote: Remote | null = options.setUp === false ? null : new MemoryRemote();
  const scheduler = new Scheduler({
    store,
    log: log as unknown as Log,
    remote: async () => remote,
    deviceId: 'phone',
    now: timers.clock,
    locks: options.locks === undefined ? null : options.locks,
    setTimer: timers.set,
    clearTimer: timers.clear,
    onStatus: (status) => statuses.push(status),
    onConflicts: (conflicts) => announced.push(conflicts),
    sync: sync.run,
  });
  return {
    scheduler,
    timers,
    store,
    log,
    sync,
    statuses,
    announced,
    setRemote: (next: Remote | null) => (remote = next),
    /** Puts a session in progress: open, written a minute ago. */
    startSession: () => (log.open = [session(timers, MINUTE)]),
    endSession: () => (log.open = []),
    last: () => statuses[statuses.length - 1],
  };
}

type Harness = ReturnType<typeof setup>;

/** Tracks which of several promises have settled. */
function tracker() {
  const settled = new Set<string>();
  return {
    settled,
    watch: (name: string, promise: Promise<unknown>) => void promise.then(() => settled.add(name)),
  };
}

// --- a session in progress ------------------------------------------------------------

describe('sessionInProgress', () => {
  const timers = new Timers();
  const now = timers.clock();

  it('is true for an open session written within the last three hours', () => {
    expect(sessionInProgress([session(timers, 0)], now)).toBe(true);
    expect(sessionInProgress([session(timers, IN_PROGRESS_MS - 1)], now)).toBe(true);
  });

  it('is false from exactly three hours after the last write', () => {
    expect(sessionInProgress([session(timers, IN_PROGRESS_MS)], now)).toBe(false);
    expect(sessionInProgress([session(timers, 24 * 60 * MINUTE)], now)).toBe(false);
  });

  it('is false for an ended session, however recent', () => {
    expect(sessionInProgress([session(timers, 0, true)], now)).toBe(false);
  });

  it('is false with no sessions, and true if any one of several is in progress', () => {
    expect(sessionInProgress([], now)).toBe(false);
    const stale = session(timers, IN_PROGRESS_MS + MINUTE);
    expect(sessionInProgress([stale, session(timers, MINUTE)], now)).toBe(true);
  });

  it('counts a write stamped a little ahead of this clock, but not one far ahead', () => {
    expect(sessionInProgress([session(timers, -5 * MINUTE)], now)).toBe(true);
    expect(sessionInProgress([session(timers, -IN_PROGRESS_MS)], now)).toBe(false);
  });
});

// --- triggers (7.1) -------------------------------------------------------------------

describe('Scheduler: triggers', () => {
  const table: Array<[Trigger, Mode | null, Mode | null]> = [
    // trigger          no session   session in progress
    ['session_ended', 'full', 'full'],
    ['manual', 'full', 'full'],
    ['left', 'full', null],
    ['launch', 'full', 'pull'],
    ['online', null, null],
  ];

  for (const [trigger, outside, during] of table) {
    it(`${trigger}: ${outside ?? 'nothing'} outside a session, ${during ?? 'nothing'} during one`, async () => {
      const a = setup();
      await a.scheduler.trigger(trigger);
      expect(a.sync.modes).toEqual(outside ? [outside] : []);

      const b = setup();
      b.startSession();
      await b.scheduler.trigger(trigger);
      expect(b.sync.modes).toEqual(during ? [during] : []);
    });
  }

  it('treats a session last written three hours ago as over', async () => {
    const h = setup();
    h.log.open = [session(h.timers, IN_PROGRESS_MS)];
    await h.scheduler.trigger('left');
    await h.scheduler.trigger('launch');
    expect(h.sync.modes).toEqual(['full', 'full']);
  });

  it('treats a session last written a moment under three hours ago as in progress', async () => {
    const h = setup();
    h.log.open = [session(h.timers, IN_PROGRESS_MS - 1)];
    await h.scheduler.trigger('left');
    await h.scheduler.trigger('launch');
    expect(h.sync.modes).toEqual(['pull']);
  });

  it('syncs on leaving once the session has ended', async () => {
    const h = setup();
    h.log.open = [session(h.timers, MINUTE, true)];
    await h.scheduler.trigger('left');
    expect(h.sync.modes).toEqual(['full']);
  });

  it('hands the sync the store, the remote, the device id and the clock', async () => {
    const h = setup();
    const remote = new MemoryRemote();
    h.setRemote(remote);
    await h.scheduler.trigger('manual');
    const [deps] = h.sync.deps;
    expect(deps.store).toBe(h.store);
    expect(deps.remote).toBe(remote);
    expect(deps.deviceId).toBe('phone');
    expect(deps.now?.().getTime()).toBe(T0);
  });

  it('does nothing before setup, and says so', async () => {
    const h = setup({ setUp: false });
    await h.scheduler.trigger('manual');
    await h.scheduler.trigger('launch');
    expect(h.sync.modes).toEqual([]);
    expect(h.last().status).toBe('not_set_up');
    expect(h.last().exposure.level).toBe('unprotected');
  });
});

// --- one at a time (7.2) ----------------------------------------------------------------

describe('Scheduler: one sync at a time', () => {
  it('folds every request made during a sync into exactly one more', async () => {
    const h = setup();
    const first = h.sync.hold();
    const second = h.sync.hold();
    const t = tracker();
    t.watch('first', h.scheduler.trigger('manual'));
    await flush();
    expect(h.sync.modes).toEqual(['full']);

    for (let i = 0; i < 5; i++) t.watch(`later ${i}`, h.scheduler.trigger('manual'));
    await flush();
    expect(h.sync.modes).toEqual(['full']);

    first.resolve();
    await flush();
    expect(h.sync.modes).toEqual(['full', 'full']);
    // The first caller's sync is done; the others wait for the one that serves them.
    expect([...t.settled]).toEqual(['first']);

    second.resolve();
    await flush();
    expect(t.settled.size).toBe(6);
    expect(h.sync.modes).toEqual(['full', 'full']);
    expect(h.sync.maxActive).toBe(1);
  });

  it('makes the follow-up a full sync if anyone asked for one', async () => {
    const h = setup();
    h.startSession();
    const first = h.sync.hold();
    void h.scheduler.trigger('launch');
    await flush();
    // One at a time, so the follow-up is first asked for as a pull.
    const pull = h.scheduler.trigger('launch');
    await flush();
    const full = h.scheduler.trigger('session_ended');
    await flush();
    const pullAgain = h.scheduler.trigger('launch');
    await flush();
    first.resolve();
    await Promise.all([pull, full, pullAgain]);
    expect(h.sync.modes).toEqual(['pull', 'full']);
  });

  it('keeps a follow-up asked for only as a pull a pull', async () => {
    const h = setup();
    h.startSession();
    const first = h.sync.hold();
    void h.scheduler.trigger('launch');
    await flush();
    const later = [h.scheduler.trigger('launch'), h.scheduler.trigger('launch')];
    await flush();
    first.resolve();
    await Promise.all(later);
    expect(h.sync.modes).toEqual(['pull', 'pull']);
  });

  it('resolves every caller even when the sync fails', async () => {
    const h = setup();
    h.sync.then(serverError(), serverError());
    await h.scheduler.trigger('manual');
    await h.scheduler.trigger('manual');
    expect(h.sync.modes).toEqual(['full', 'full']);
  });

  it('starts afresh once idle: a request after a sync ended is not folded into it', async () => {
    const h = setup();
    await h.scheduler.trigger('manual');
    await h.scheduler.trigger('manual');
    expect(h.sync.modes).toEqual(['full', 'full']);
  });
});

describe('Scheduler: the sync lock', () => {
  it('runs every sync holding sisyphos-sync', async () => {
    const locks = new FakeLocks();
    const heldDuringSync: boolean[] = [];
    const sync = new ScriptedSync().then(async () => {
      heldDuringSync.push(locks.held);
      return result();
    });
    const h = setup({ locks, sync });
    await h.scheduler.trigger('manual');
    expect(locks.requested).toEqual(['sisyphos-sync']);
    expect(heldDuringSync).toEqual([true]);
  });

  it('never lets two tabs sync at once', async () => {
    const locks = new FakeLocks();
    const shared = new ScriptedSync();
    const tab1 = setup({ locks, sync: shared });
    const tab2 = setup({ locks, sync: shared });
    const held = shared.hold();
    const one = tab1.scheduler.trigger('manual');
    await flush();
    const two = tab2.scheduler.trigger('manual');
    await flush();
    expect(shared.modes).toEqual(['full']);

    held.resolve();
    await Promise.all([one, two]);
    expect(shared.modes).toEqual(['full', 'full']);
    expect(shared.maxActive).toBe(1);
  });

  it('serves a request made while waiting for the lock with the sync that was waiting', async () => {
    const locks = new FakeLocks();
    const otherTab = setup({ locks });
    const held = otherTab.sync.hold();
    void otherTab.scheduler.trigger('manual');
    await flush();

    const h = setup({ locks });
    h.startSession();
    const t = tracker();
    t.watch('pull', h.scheduler.trigger('launch'));
    await flush();
    t.watch('full', h.scheduler.trigger('manual'));
    await flush();
    expect(h.sync.modes).toEqual([]);

    held.resolve();
    await flush();
    // One sync, and full, because one of the two asked for full.
    expect(h.sync.modes).toEqual(['full']);
    expect(t.settled).toEqual(new Set(['pull', 'full']));
  });

  it('syncs without a lock when there is none (one tab assumed)', async () => {
    const h = setup({ locks: null });
    await h.scheduler.trigger('manual');
    expect(h.sync.modes).toEqual(['full']);
  });

  it('records a lock that fails as a failure, and still resolves its callers', async () => {
    const failing: Locks = { request: () => Promise.reject(new Error('lock manager gone')) };
    const h = setup({ locks: failing });
    await h.scheduler.trigger('manual');
    expect(h.sync.modes).toEqual([]);
    expect(h.last().status).toBe('repo_problem');
    expect(h.last().message).toContain('lock manager gone');
  });

  it.runIf(typeof navigator !== 'undefined' && navigator.locks)(
    'uses navigator.locks when not given any',
    async () => {
      const spy = vi.spyOn(navigator.locks, 'request');
      try {
        const sync = new ScriptedSync();
        const scheduler = new Scheduler({
          store: new MemoryStore(),
          log: new FakeLog() as unknown as Log,
          remote: async () => new MemoryRemote(),
          deviceId: 'phone',
          sync: sync.run,
        });
        await scheduler.trigger('manual');
        expect(spy).toHaveBeenCalledWith('sisyphos-sync', expect.any(Function));
        expect(sync.modes).toEqual(['full']);
        scheduler.dispose();
      } finally {
        spy.mockRestore();
      }
    },
  );
});

// --- retries (7.2) ----------------------------------------------------------------------

describe('Scheduler: retrying a failed full sync', () => {
  it('backs off from 30 seconds, doubling, capped at 15 minutes', async () => {
    const h = setup();
    h.sync.then(...Array.from({ length: 8 }, serverError));
    await h.scheduler.trigger('manual');

    const delays: number[] = [];
    for (let i = 0; i < 7; i++) {
      const due = h.timers.due()!;
      delays.push(due / SECOND);
      expect(h.last().nextRetryAt?.getTime()).toBe(h.timers.now + due);
      await h.timers.advance(due);
    }
    expect(delays).toEqual([30, 60, 120, 240, 480, 900, 900]);
    expect(h.sync.modes).toEqual(Array(8).fill('full'));
  });

  it('starts from 30 seconds again after a success', async () => {
    const h = setup();
    h.sync.then(serverError(), serverError(), result(), serverError());
    await h.scheduler.trigger('manual');
    await h.timers.advance(30 * SECOND);
    expect(h.timers.due()).toBe(60 * SECOND);
    await h.timers.advance(60 * SECOND);
    expect(h.sync.modes).toHaveLength(3);
    expect(h.timers.due()).toBeNull();
    expect(h.last().status).toBe('idle');

    await h.scheduler.trigger('manual');
    expect(h.timers.due()).toBe(30 * SECOND);
  });

  it('retries at once when the connection returns', async () => {
    const h = setup();
    h.sync.then(network(), network());
    await h.scheduler.trigger('manual');
    expect(h.last().status).toBe('offline');
    await h.timers.advance(10 * SECOND);

    await h.scheduler.trigger('online');
    expect(h.sync.modes).toEqual(['full', 'full']);
    // The retry it replaced is gone; the new failure armed the next one.
    expect(h.timers.pending).toHaveLength(1);
    expect(h.timers.due()).toBe(60 * SECOND);
  });

  it('ignores a returning connection when nothing failed', async () => {
    const h = setup();
    await h.scheduler.trigger('manual');
    await h.scheduler.trigger('online');
    expect(h.sync.modes).toEqual(['full']);
  });

  it('does not retry a failed pull: the session ending syncs anyway', async () => {
    const h = setup();
    h.startSession();
    h.sync.then(network());
    await h.scheduler.trigger('launch');
    expect(h.sync.modes).toEqual(['pull']);
    expect(h.timers.due()).toBeNull();
    expect(h.last().status).toBe('offline');
  });

  it('arms no retry for a sync that fails during a session', async () => {
    const h = setup();
    h.startSession();
    h.sync.then(network());
    await h.scheduler.trigger('manual');
    expect(h.timers.due()).toBeNull();
    expect(h.last()).toMatchObject({ status: 'offline', nextRetryAt: null });
    expect(h.last().message).toMatch(/when you end the session/);

    await h.scheduler.trigger('online');
    await h.timers.advance(60 * MINUTE);
    expect(h.sync.modes).toEqual(['full']);

    h.endSession();
    await h.scheduler.trigger('session_ended');
    expect(h.sync.modes).toEqual(['full', 'full']);
  });

  it('drops a retry that falls due once a session has started', async () => {
    const h = setup();
    h.sync.then(serverError());
    await h.scheduler.trigger('manual');
    expect(h.timers.due()).toBe(30 * SECOND);

    h.startSession();
    await h.timers.advance(30 * SECOND);
    expect(h.sync.modes).toEqual(['full']);
    expect(h.timers.due()).toBeNull();
    expect(h.last()).toMatchObject({ status: 'retrying', nextRetryAt: null });
  });

  it('lets a new sync replace a retry that was waiting', async () => {
    const h = setup();
    h.sync.then(serverError());
    await h.scheduler.trigger('manual');
    expect(h.timers.due()).toBe(30 * SECOND);
    await h.scheduler.trigger('left');
    expect(h.timers.due()).toBeNull();
    await h.timers.advance(60 * MINUTE);
    expect(h.sync.modes).toEqual(['full', 'full']);
  });
});

// --- failure classes (section 6) ----------------------------------------------------------

describe('Scheduler: what each failure does', () => {
  /** Automatic triggers, outside a session: each would sync if nothing held it back. */
  async function automatic(h: Harness): Promise<number> {
    const before = h.sync.modes.length;
    await h.scheduler.trigger('left');
    await h.scheduler.trigger('launch');
    await h.scheduler.trigger('session_ended');
    await h.scheduler.trigger('online');
    await h.timers.advance(60 * MINUTE);
    return h.sync.modes.length - before;
  }

  it('retryable, no network: offline, retried', async () => {
    const h = setup();
    h.sync.then(network());
    await h.scheduler.trigger('manual');
    expect(h.last()).toMatchObject({ status: 'offline' });
    expect(h.last().nextRetryAt?.getTime()).toBe(T0 + 30 * SECOND);
  });

  it('retryable, GitHub failing: retrying, with the next attempt', async () => {
    const h = setup();
    h.sync.then(serverError());
    await h.scheduler.trigger('manual');
    expect(h.last()).toMatchObject({ status: 'retrying' });
    expect(h.last().nextRetryAt?.getTime()).toBe(T0 + 30 * SECOND);
    expect(h.last().message).toMatch(/^GitHub failed \(HTTP 502\)\./);
  });

  it('rate limit: waits until the time GitHub gave, holding automatic syncs back', async () => {
    const h = setup();
    const retryAt = new Date(T0 + 10 * MINUTE);
    h.sync.then(new SyncError('rate_limit', 'Rate limited', { retryAt }));
    await h.scheduler.trigger('manual');
    expect(h.last()).toMatchObject({ status: 'retrying', nextRetryAt: retryAt });
    expect(h.timers.due()).toBe(10 * MINUTE);

    await h.scheduler.trigger('left');
    await h.scheduler.trigger('online');
    await h.timers.advance(10 * MINUTE - 1);
    expect(h.sync.modes).toEqual(['full']);

    await h.timers.advance(1);
    expect(h.sync.modes).toEqual(['full', 'full']);
    expect(h.last().status).toBe('idle');
  });

  it('rate limit: the lifter can still ask', async () => {
    const h = setup();
    h.sync.then(new SyncError('rate_limit', 'Rate limited', { retryAt: new Date(T0 + MINUTE) }));
    await h.scheduler.trigger('manual');
    await h.scheduler.trigger('manual');
    expect(h.sync.modes).toEqual(['full', 'full']);
  });

  const stops = [
    ['token', 'needs_token', /^A token failure\. Paste a new token/],
    ['repo', 'repo_problem', /^A repo failure\. Syncing is paused/],
    ['update', 'needs_update', /Update the app/],
    ['bug', 'repo_problem', /A bug failure\. .*Please report this\.$/],
  ] as const;

  for (const [kind, status, message] of stops) {
    it(`${kind}: ${status}, and no automatic syncing until the lifter taps sync`, async () => {
      const h = setup();
      h.sync.then(new SyncError(kind, `A ${kind} failure`));
      await h.scheduler.trigger('manual');
      expect(h.last()).toMatchObject({ status, nextRetryAt: null });
      expect(h.last().message).toMatch(message);
      expect(h.timers.due()).toBeNull();

      expect(await automatic(h)).toBe(0);

      await h.scheduler.trigger('manual');
      expect(h.sync.modes).toEqual(['full', 'full']);
      expect(h.last().status).toBe('idle');
      expect(await automatic(h)).toBe(3);
    });
  }

  it('token: syncing resumes once new settings are saved', async () => {
    const h = setup();
    await h.store.saveSettings({ owner: 'me', repo: 'log', branch: 'main', token: 'old' });
    h.sync.then(new SyncError('token', 'Bad token'));
    await h.scheduler.trigger('manual');
    expect(await automatic(h)).toBe(0);

    await h.store.saveSettings({ token: 'new' });
    await h.scheduler.trigger('left');
    expect(h.sync.modes).toEqual(['full', 'full']);
  });

  it('token: a token pasted while the failing sync ran counts as new', async () => {
    const h = setup();
    await h.store.saveSettings({ owner: 'me', repo: 'log', branch: 'main', token: 'old' });
    const held = h.sync.hold();
    const running = h.scheduler.trigger('manual');
    await flush();
    await h.store.saveSettings({ token: 'new' });
    held.reject(new SyncError('token', 'Bad token'));
    await running;
    await h.scheduler.trigger('left');
    expect(h.sync.modes).toEqual(['full', 'full']);
  });

  it('stays stopped when the next manual sync fails the same way', async () => {
    const h = setup();
    h.sync.then(new SyncError('repo', 'Gone'), new SyncError('repo', 'Gone'));
    await h.scheduler.trigger('manual');
    await h.scheduler.trigger('manual');
    expect(await automatic(h)).toBe(0);
  });

  it('treats anything but a SyncError as a bug, and stops', async () => {
    const h = setup();
    h.sync.then(new TypeError('x is undefined'));
    await h.scheduler.trigger('manual');
    expect(h.last().status).toBe('repo_problem');
    expect(h.last().message).toContain('x is undefined');
    expect(await automatic(h)).toBe(0);
  });
});

// --- teardown ---------------------------------------------------------------------------

describe('Scheduler: dispose', () => {
  it('cancels an armed retry for good', async () => {
    const h = setup();
    h.sync.then(serverError());
    await h.scheduler.trigger('manual');
    expect(h.timers.pending).toHaveLength(1);
    h.scheduler.dispose();
    expect(h.timers.pending).toHaveLength(0);
    await h.timers.advance(60 * MINUTE);
    expect(h.sync.modes).toEqual(['full']);
  });

  it('arms nothing when a sync running at teardown fails afterwards', async () => {
    const h = setup();
    const held = h.sync.hold();
    const running = h.scheduler.trigger('manual');
    await flush();
    const told = h.statuses.length;
    h.scheduler.dispose();
    held.reject(serverError());
    await running;
    await flush();
    expect(h.timers.pending).toHaveLength(0);
    expect(h.statuses).toHaveLength(told);
  });

  it('runs nothing afterwards, and releases callers of a sync that will not run', async () => {
    const h = setup();
    const held = h.sync.hold();
    void h.scheduler.trigger('manual');
    await flush();
    const queued = h.scheduler.trigger('manual');
    h.scheduler.dispose();
    await queued;

    held.resolve();
    await flush();
    await h.scheduler.trigger('manual');
    await h.scheduler.trigger('launch');
    expect(h.sync.modes).toEqual(['full']);
  });

  it('unwires what attach wired', async () => {
    const h = setup();
    const w = fakeWindow();
    h.scheduler.attach(w.window);
    h.scheduler.dispose();
    w.window.dispatchEvent(new Event('pagehide'));
    await flush();
    expect(h.sync.modes).toEqual([]);
    expect(h.scheduler.attach(w.window)).toBeTypeOf('function');
    w.window.dispatchEvent(new Event('pagehide'));
    await flush();
    expect(h.sync.modes).toEqual([]);
  });
});

// --- attach -----------------------------------------------------------------------------

function fakeWindow() {
  const document = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as DocumentVisibilityState,
  });
  const window = Object.assign(new EventTarget(), { document }) as unknown as Window;
  return {
    window,
    hide() {
      document.visibilityState = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
    },
    show() {
      document.visibilityState = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
    },
  };
}

describe('Scheduler: attach', () => {
  it('syncs when the app is hidden, and not when it comes back', async () => {
    const h = setup();
    const w = fakeWindow();
    h.scheduler.attach(w.window);
    w.hide();
    await flush();
    expect(h.sync.modes).toEqual(['full']);
    w.show();
    await flush();
    expect(h.sync.modes).toEqual(['full']);
  });

  it('syncs on pagehide', async () => {
    const h = setup();
    const w = fakeWindow();
    h.scheduler.attach(w.window);
    w.window.dispatchEvent(new Event('pagehide'));
    await flush();
    expect(h.sync.modes).toEqual(['full']);
  });

  it('does nothing on leaving during a session', async () => {
    const h = setup();
    h.startSession();
    const w = fakeWindow();
    h.scheduler.attach(w.window);
    w.hide();
    w.window.dispatchEvent(new Event('pagehide'));
    await flush();
    expect(h.sync.modes).toEqual([]);
  });

  it('retries on online after a failure', async () => {
    const h = setup();
    h.sync.then(network());
    await h.scheduler.trigger('manual');
    const w = fakeWindow();
    h.scheduler.attach(w.window);
    w.window.dispatchEvent(new Event('online'));
    await flush();
    expect(h.sync.modes).toEqual(['full', 'full']);
  });

  it('returns a function that unwires all three', async () => {
    const h = setup();
    h.sync.then(network());
    await h.scheduler.trigger('manual');
    const w = fakeWindow();
    const unwire = h.scheduler.attach(w.window);
    unwire();
    w.hide();
    w.window.dispatchEvent(new Event('pagehide'));
    w.window.dispatchEvent(new Event('online'));
    await flush();
    expect(h.sync.modes).toEqual(['full']);
  });
});

// --- conflicts (5.2) ----------------------------------------------------------------------

describe('Scheduler: telling the lifter about conflicts', () => {
  it('announces the conflicts a sync created', async () => {
    const h = setup();
    const found = conflict('2026-09-27-7xq2');
    h.sync.then(async () => {
      // The sync writes its conflict records to the device, and reports them.
      h.log.conflicts.push(found);
      return result({ conflicts: [found] });
    });
    await h.scheduler.trigger('manual');
    expect(h.announced).toEqual([[found]]);
  });

  it('announces conflicts pulled from another device', async () => {
    const h = setup();
    h.startSession();
    const theirs = conflict('2026-09-26-abcd');
    h.sync.then(async () => {
      h.log.conflicts.push(theirs);
      return result({ taken: ['conflicts/2026-09-26-abcd.json'] });
    });
    await h.scheduler.trigger('launch');
    expect(h.announced).toEqual([[theirs]]);
  });

  it('announces only what is new, and nothing when nothing is', async () => {
    const h = setup();
    const old = conflict('2026-09-20-aaaa');
    h.log.conflicts = [old];
    await h.scheduler.trigger('manual');
    expect(h.announced).toEqual([]);

    const next = conflict('2026-09-27-bbbb');
    h.sync.then(async () => {
      h.log.conflicts.push(next);
      return result();
    });
    await h.scheduler.trigger('manual');
    expect(h.announced).toEqual([[next]]);
  });

  it('announces conflicts a sync saved before failing further on', async () => {
    const h = setup();
    const found = conflict('2026-09-27-cccc');
    h.sync.then(async () => {
      h.log.conflicts.push(found);
      throw network();
    });
    await h.scheduler.trigger('manual');
    expect(h.announced).toEqual([[found]]);
    expect(h.last().conflicts).toBe(1);
  });
});

// --- status (7.3) -------------------------------------------------------------------------

describe('Scheduler: status', () => {
  it('says syncing while a sync runs, then idle', async () => {
    const h = setup();
    const held = h.sync.hold();
    const running = h.scheduler.trigger('manual');
    await flush();
    expect(h.last().status).toBe('syncing');
    expect((await h.scheduler.status()).status).toBe('syncing');
    held.resolve();
    await running;
    expect(h.last().status).toBe('idle');
    expect(h.statuses.map((s) => s.status)).toEqual(['syncing', 'idle']);
  });

  it('counts unresolved conflicts and library conflicts', async () => {
    const h = setup();
    h.log.conflicts = [conflict('2026-09-27-aaaa'), conflict('2026-09-27-bbbb')];
    h.log.libraryConflicts = [{ id: 'squat' } as LibraryConflict];
    const status = await h.scheduler.status();
    expect(status).toMatchObject({ conflicts: 2, libraryConflicts: 1 });
  });

  it('names the unreadable files of the last sync, and keeps them through a failed one', async () => {
    const h = setup();
    h.sync.then(result({ unreadable: ['sessions/2026/bad.json'] }), network(), result());
    await h.scheduler.trigger('manual');
    expect(h.last().unreadable).toEqual(['sessions/2026/bad.json']);
    await h.scheduler.trigger('manual');
    expect(h.last().unreadable).toEqual(['sessions/2026/bad.json']);
    await h.scheduler.trigger('manual');
    expect(h.last().unreadable).toEqual([]);
  });

  it('shows exposure from the paths that need syncing', async () => {
    const h = setup();
    expect((await h.scheduler.status()).exposure.level).toBe('safe');

    await h.store.exclusive((s) =>
      s.apply([{ op: 'content', path: 'lifter/bodyweight.csv', text: 'date,kg\n' }]),
    );
    h.timers.now += 2 * 60 * MINUTE;
    const status = await h.scheduler.status();
    expect(status.exposure).toMatchObject({
      level: 'at_risk',
      unsyncedDocuments: 1,
      oldestUnsyncedMinutes: 120,
    });

    h.startSession();
    expect((await h.scheduler.status()).exposure.level).toBe('pending');
  });

  it('shows unprotected exposure before setup', async () => {
    const h = setup({ setUp: false });
    const status = await h.scheduler.status();
    expect(status.status).toBe('not_set_up');
    expect(status.exposure.level).toBe('unprotected');
  });

  it('calls onStatus only when the status changes', async () => {
    const h = setup();
    await h.scheduler.status();
    await h.scheduler.status();
    expect(h.statuses).toHaveLength(1);

    h.log.conflicts = [conflict('2026-09-27-aaaa')];
    await h.scheduler.status();
    expect(h.statuses).toHaveLength(2);
    expect(h.last().conflicts).toBe(1);
  });

  it('keeps working after a status could not be read, and does not fail a sync over it', async () => {
    const h = setup();
    const library = vi.spyOn(h.log, 'library').mockRejectedValueOnce(new Error('disk'));
    await expect(h.scheduler.status()).rejects.toThrow('disk');
    expect((await h.scheduler.status()).status).toBe('idle');

    library.mockRejectedValue(new Error('disk'));
    await h.scheduler.trigger('manual');
    library.mockRestore();
    await h.scheduler.trigger('left');
    expect(h.sync.modes).toEqual(['full', 'full']);
    expect(h.last().status).toBe('idle');
  });
});
