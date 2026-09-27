import type { ConflictRecord, Session } from '../model';
import type { Mode } from './decide';
import { exposure } from './durability';
import { SyncError, type SyncErrorKind } from './errors';
import type { Log } from './log';
import type { Remote } from './remote/remote';
import { describeSync, type StatusSnapshot } from './status';
import type { LocalStore, Settings } from './store/store';
import { runSync } from './sync';

/**
 * When syncing happens (docs/STORAGE.md section 7).
 *
 * | Moment                                          | What happens                     |
 * | A session ends / the lifter taps sync           | Full sync                        |
 * | The app is left while no session is in progress | Full sync                        |
 * | Launch, no session in progress                  | Full sync                        |
 * | Launch, a session in progress                   | Pull                             |
 * | A full sync failed                              | Retried, unless a session is in progress by then |
 *
 * One sync at a time across tabs (Web Locks, `sisyphos-sync`); a request during a
 * sync schedules exactly one more, a full sync outranking a pull; failed full
 * syncs back off from 30s, doubling, capped at 15 min, and retry at once on
 * `online`; `dispose` cancels every timer for good.
 *
 * How a sync ended decides what happens next (section 6): a retryable failure
 * is retried on the backoff, a rate limit when GitHub said, and a token, repo,
 * update or bug failure stops automatic syncing until the lifter taps sync or
 * the settings change (a new token, another repo).
 */

export type Trigger =
  | 'session_ended'
  | 'manual'
  /** `visibilitychange` to hidden, or `pagehide`. */
  | 'left'
  | 'launch'
  | 'online';

/** A session counts as in progress for this long after its last write (7.1). */
export const IN_PROGRESS_MS = 3 * 60 * 60 * 1000;

/** The first retry after a failed full sync; each further failure doubles it (7.2). */
const FIRST_RETRY_MS = 30_000;
const MAX_RETRY_MS = 15 * 60_000;

/** Failures after which automatic syncing stops until the lifter acts (section 6). */
const STOPS: ReadonlySet<SyncErrorKind> = new Set(['token', 'repo', 'update', 'bug']);

/** True when any session has `ended_at` null and was written (`updated_at`) within IN_PROGRESS_MS. */
export function sessionInProgress(sessions: Session[], now: Date): boolean {
  return sessions.some(
    (session) =>
      session.ended_at === null &&
      // Within, either side of now: a session stamped by another device whose
      // clock runs a little ahead is still being written right now.
      Math.abs(now.getTime() - Date.parse(session.updated_at)) < IN_PROGRESS_MS,
  );
}

/** The subset of the Web Locks API the scheduler uses; injectable for tests. */
export interface Locks {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export interface SchedulerDeps {
  store: LocalStore;
  log: Log;
  /** The configured remote, or null before setup. */
  remote: () => Promise<Remote | null>;
  deviceId: string;
  now?: () => Date;
  /** Defaults to `navigator.locks`; without it, the scheduler assumes one tab. */
  locks?: Locks | null;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  onStatus?: (status: StatusSnapshot) => void;
  /**
   * Called whenever a sync creates conflicts or pulls ones found elsewhere (5.2),
   * with those new records. The notice lists every unresolved conflict, which
   * `log.getConflicts()` gives.
   */
  onConflicts?: (conflicts: ConflictRecord[]) => void;
  /** Runs one sync. Defaults to `runSync`; injectable so tests can script outcomes. */
  sync?: typeof runSync;
}

/** A sync waiting to run, and everyone waiting for it. */
interface Job {
  mode: Mode;
  done: Promise<void>;
  resolve: () => void;
}

interface Failure {
  error: SyncError;
  mode: Mode;
  /** For a stopping failure: the settings it happened with. New ones lift the stop. */
  settings: Settings | null;
}

/** What the status shows about syncing, as it was when the status was asked for. */
interface Moment {
  syncing: boolean;
  failure: SyncError | null;
  nextRetryAt: Date | null;
  unreadable: string[];
}

export class Scheduler {
  private readonly now: () => Date;
  private readonly locks: Locks | null;
  private readonly sync: typeof runSync;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  /** The one sync waiting to run. Requests fold into it until it starts (7.2). */
  private queued: Job | null = null;
  private draining = false;
  private syncing = false;
  private disposed = false;

  /** How the last finished sync failed; null after a success. */
  private failure: Failure | null = null;
  /** Failed full syncs in a row, which sets the backoff. */
  private attempts = 0;
  private retry: { at: Date; handle: unknown } | null = null;
  /** From the last sync that completed: a failed one says nothing about them. */
  private unreadable: string[] = [];

  private readonly unwires = new Set<() => void>();
  private statusQueue: Promise<unknown> = Promise.resolve();
  private lastStatus: string | null = null;

  constructor(private readonly deps: SchedulerDeps) {
    this.now = deps.now ?? (() => new Date());
    this.locks = deps.locks === undefined ? browserLocks() : deps.locks;
    this.sync = deps.sync ?? runSync;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer =
      deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  /**
   * Asks for whatever the trigger calls for; resolves when that sync (or the one it folded into) ends.
   * It resolves however the sync ended: the outcome is in `status()`.
   */
  async trigger(trigger: Trigger): Promise<void> {
    const mode = await this.modeFor(trigger);
    if (mode === null || this.disposed) return;
    return this.request(mode);
  }

  /**
   * Also passes the snapshot to `onStatus` if it differs from the last one
   * passed, so a caller refreshing after a local write (which changes exposure)
   * keeps every listener current.
   */
  status(): Promise<StatusSnapshot> {
    // Captured now and computed in turn, so every snapshot shows the moment it
    // was asked for, and they reach `onStatus` in that order.
    const moment: Moment = {
      syncing: this.syncing,
      failure: this.failure?.error ?? null,
      nextRetryAt: this.retry?.at ?? null,
      unreadable: this.unreadable,
    };
    const snapshot = this.statusQueue.then(() => this.snapshot(moment));
    // Never left rejected, or no later snapshot would be computed. Whoever asked
    // gets the error; a listener that throws is the listener's problem.
    this.statusQueue = snapshot.then((status) => this.emit(status)).catch(() => undefined);
    return snapshot;
  }

  /** Wires `visibilitychange`, `pagehide` and `online`. Returns a function that unwires them. */
  attach(target: Window): () => void {
    if (this.disposed) return () => {};
    const { document } = target;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void this.trigger('left');
    };
    const onPageHide = () => void this.trigger('left');
    const onOnline = () => void this.trigger('online');
    document.addEventListener('visibilitychange', onVisibility);
    target.addEventListener('pagehide', onPageHide);
    target.addEventListener('online', onOnline);
    const unwire = () => {
      document.removeEventListener('visibilitychange', onVisibility);
      target.removeEventListener('pagehide', onPageHide);
      target.removeEventListener('online', onOnline);
      this.unwires.delete(unwire);
    };
    this.unwires.add(unwire);
    return unwire;
  }

  /**
   * App teardown (7.2): cancels every timer, and nothing can arm one again. A
   * sync already running cannot be stopped midway; it finishes, and tells no one.
   */
  dispose(): void {
    this.disposed = true;
    this.cancelRetry();
    for (const unwire of [...this.unwires]) unwire();
    // The sync they were waiting for will not run now; nobody is left hanging.
    this.queued?.resolve();
    this.queued = null;
  }

  // --- what to run --------------------------------------------------------------

  /** What a trigger calls for (7.1), or null for nothing. */
  private async modeFor(trigger: Trigger): Promise<Mode | null> {
    if (this.disposed) return null;
    // The lifter asking is the one thing that overrides a stop (section 6).
    if (trigger === 'manual') return 'full';

    let mode: Mode | null;
    if (trigger === 'session_ended') {
      mode = 'full';
    } else {
      // Leaving looks the same whether the app was closed or the phone locked
      // between sets, so neither it nor a returning connection syncs during a
      // session; launching then only pulls what other devices wrote.
      const inProgress = await this.inProgress();
      if (trigger === 'launch') mode = inProgress ? 'pull' : 'full';
      else if (trigger === 'left') mode = inProgress ? null : 'full';
      // `online` retries a sync that failed for want of it, at once (7.2).
      else mode = !inProgress && this.failure?.error.kind === 'retryable' ? 'full' : null;
    }
    if (mode === null || (await this.held())) return null;
    return mode;
  }

  /**
   * Whether automatic syncing is held back (section 6): after a stopping failure,
   * until the settings change; after a rate limit, until the time GitHub gave.
   */
  private async held(): Promise<boolean> {
    const failure = this.failure;
    if (failure === null) return false;
    const { error } = failure;
    if (error.kind === 'rate_limit') return error.retryAt !== null && error.retryAt > this.now();
    if (!STOPS.has(error.kind)) return false;
    return sameSettings(failure.settings, await this.deps.store.settings());
  }

  private inProgress(): Promise<boolean> {
    return this.deps.log.listOpenSessions().then((open) => sessionInProgress(open, this.now()));
  }

  // --- one at a time ------------------------------------------------------------

  private request(mode: Mode): Promise<void> {
    if (this.queued) {
      // Exactly one sync waits however many ask, and a full sync serves a pull
      // too, so the waiting one becomes full if anyone wants that (7.2).
      if (mode === 'full') this.queued.mode = 'full';
      return this.queued.done;
    }
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    this.queued = { mode, done, resolve };
    if (!this.draining) void this.drain();
    return done;
  }

  private async drain(): Promise<void> {
    this.draining = true;
    while (this.queued && !this.disposed) {
      const job = this.queued;
      try {
        await this.withLock(async () => {
          // Taken off the queue only once it holds the lock: a request made
          // while it waited is served by it, since it has read nothing yet.
          if (this.queued === job) this.queued = null;
          if (!this.disposed) await this.runOne(job.mode);
        });
      } catch (error) {
        // `runOne` records its own failures, so this is the lock failing.
        if (this.queued === job) this.queued = null;
        this.failure = { error: asSyncError(error), mode: job.mode, settings: null };
        await this.refresh();
      }
      job.resolve();
    }
    this.draining = false;
  }

  /** Runs `fn` holding `sisyphos-sync`, so two tabs never sync at once (7.2). */
  private withLock(fn: () => Promise<void>): Promise<void> {
    return this.locks ? this.locks.request('sisyphos-sync', fn) : fn();
  }

  /** One sync, from finding the remote to telling the lifter how it went. */
  private async runOne(mode: Mode): Promise<void> {
    const { store, log, deviceId } = this.deps;
    let before: Set<string> | null = null;
    let created: ConflictRecord[] = [];
    let settings: Settings | null = null;
    let error: SyncError | null = null;
    try {
      // What this sync runs with: a token pasted while it runs is a new one to try.
      settings = await store.settings();
      const remote = await this.deps.remote();
      if (remote === null) {
        // Nowhere to sync to. The status says so, and there is nothing to retry.
        await this.refresh();
        return;
      }
      // This sync supersedes a retry waiting to do the same.
      if (mode === 'full') this.cancelRetry();
      this.syncing = true;
      void this.refresh();
      before = new Set((await log.getConflicts()).map((conflict) => conflict.id));
      const result = await this.sync({ store, remote, deviceId, now: this.now }, mode);
      created = result.conflicts;
      this.unreadable = result.unreadable;
    } catch (caught) {
      error = asSyncError(caught);
    }
    this.syncing = false;
    await this.settle(mode, error, settings);
    if (before) await this.announce(before, created);
    await this.refresh();
  }

  // --- after a sync -------------------------------------------------------------

  /** Records how a sync ended and arms whatever retry that calls for (section 6, 7.2). */
  private async settle(
    mode: Mode,
    error: SyncError | null,
    settings: Settings | null,
  ): Promise<void> {
    this.cancelRetry();
    if (error === null) {
      this.failure = null;
      this.attempts = 0;
      return;
    }
    this.failure = { error, mode, settings: STOPS.has(error.kind) ? settings : null };
    // Only a full sync is retried (7.1). A pull runs during a session, and
    // ending the session syncs anyway.
    if (mode !== 'full') return;
    if (error.kind === 'retryable') {
      this.attempts++;
      const delay = Math.min(FIRST_RETRY_MS * 2 ** (this.attempts - 1), MAX_RETRY_MS);
      await this.armRetry(new Date(this.now().getTime() + delay));
    } else if (error.kind === 'rate_limit') {
      await this.armRetry(error.retryAt ?? new Date(this.now().getTime() + FIRST_RETRY_MS));
    }
  }

  private async armRetry(at: Date): Promise<void> {
    if (this.disposed) return;
    // Retries stop while a session is in progress; ending it syncs anyway (7.2).
    const inProgress = await this.inProgress();
    if (inProgress || this.disposed) return;
    const delay = Math.max(0, at.getTime() - this.now().getTime());
    this.retry = { at, handle: this.setTimer(() => void this.retryNow(), delay) };
  }

  private async retryNow(): Promise<void> {
    this.retry = null;
    if (this.disposed) return;
    if (await this.inProgress()) {
      // A session started since the failure: the retry gives way to it.
      await this.refresh();
      return;
    }
    await this.request('full');
  }

  private cancelRetry(): void {
    if (this.retry) this.clearTimer(this.retry.handle);
    this.retry = null;
  }

  /**
   * Tells the lifter about conflicts this sync created, and ones it pulled that
   * another device found (5.2). Pulled ones show as records the log did not hold
   * before; comparing also catches records a sync wrote before failing further on.
   */
  private async announce(before: Set<string>, created: ConflictRecord[]): Promise<void> {
    let after: ConflictRecord[];
    try {
      after = await this.deps.log.getConflicts();
    } catch {
      // The records are on the device whatever happens here, and every launch
      // puts them in front of the lifter again (5.2).
      after = [];
    }
    const fresh = new Map(created.map((conflict) => [conflict.id, conflict]));
    for (const conflict of after) if (!before.has(conflict.id)) fresh.set(conflict.id, conflict);
    if (fresh.size > 0 && !this.disposed) this.deps.onConflicts?.([...fresh.values()]);
  }

  // --- status -------------------------------------------------------------------

  private async snapshot(moment: Moment): Promise<StatusSnapshot> {
    const { store, log } = this.deps;
    const [remote, entries, open, conflicts, library] = await Promise.all([
      this.deps.remote(),
      store.entries(),
      log.listOpenSessions(),
      log.getConflicts(),
      log.library(),
    ]);
    const now = this.now();
    const inProgress = sessionInProgress(open, now);
    return {
      ...describeSync({
        setUp: remote !== null,
        syncing: moment.syncing,
        failure: moment.failure,
        nextRetryAt: moment.nextRetryAt,
        sessionInProgress: inProgress,
      }),
      conflicts: conflicts.length,
      libraryConflicts: library.conflicts.length,
      unreadable: [...moment.unreadable],
      exposure: exposure({
        syncConfigured: remote !== null,
        entries,
        sessionInProgress: inProgress,
        now,
      }),
    };
  }

  /** Tells `onStatus`, if anything changed. */
  private emit(status: StatusSnapshot): void {
    if (this.disposed) return;
    const key = JSON.stringify(status);
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    this.deps.onStatus?.(status);
  }

  /**
   * Publishes the status after a change. A status that cannot be read now is
   * not a sync failure: the next change tries again, and whoever calls
   * `status()` sees the error.
   */
  private async refresh(): Promise<void> {
    await this.status().catch(() => undefined);
  }
}

/** `navigator.locks`, where the browser has it (secure contexts only). */
function browserLocks(): Locks | null {
  const native = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!native) return null;
  return {
    request: <T>(name: string, callback: () => Promise<T>) =>
      native.request(name, callback) as Promise<T>,
  };
}

/**
 * Every failure is one of the classes of section 6. `runSync` throws nothing
 * else; anything that gets here otherwise is a broken invariant, and syncing
 * stops rather than guess past it.
 */
function asSyncError(error: unknown): SyncError {
  if (error instanceof SyncError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new SyncError('bug', message, { cause: error });
}

function sameSettings(a: Settings | null, b: Settings): boolean {
  return (
    a !== null &&
    a.owner === b.owner &&
    a.repo === b.repo &&
    a.branch === b.branch &&
    a.token === b.token
  );
}
