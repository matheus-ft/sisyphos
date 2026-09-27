import type { ConflictRecord, Session } from '../model';
import type { Log } from './log';
import type { Remote } from './remote/remote';
import type { StatusSnapshot } from './status';
import type { LocalStore } from './store/store';

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
 * STUB — implemented by the scheduling work package.
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

/** True when any session has `ended_at` null and was written (`updated_at`) within IN_PROGRESS_MS. */
export function sessionInProgress(_sessions: Session[], _now: Date): boolean {
  throw new Error('not implemented: storage/scheduler');
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
  /** Called whenever a sync creates conflicts or pulls ones found elsewhere (5.2). */
  onConflicts?: (conflicts: ConflictRecord[]) => void;
}

export class Scheduler {
  constructor(_deps: SchedulerDeps) {}

  /** Asks for whatever the trigger calls for; resolves when that sync (or the one it folded into) ends. */
  trigger(_trigger: Trigger): Promise<void> {
    throw new Error('not implemented: storage/scheduler');
  }

  status(): Promise<StatusSnapshot> {
    throw new Error('not implemented: storage/scheduler');
  }

  /** Wires `visibilitychange`, `pagehide` and `online`. Returns a function that unwires them. */
  attach(_target: Window): () => void {
    throw new Error('not implemented: storage/scheduler');
  }

  dispose(): void {
    throw new Error('not implemented: storage/scheduler');
  }
}
