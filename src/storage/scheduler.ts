/**
 * Two cadences, one scheduler.
 *
 * Local saves are cheap and frequent: a second after you stop typing, so at most
 * a second of input is ever at risk. Remote pushes are expensive and coarse:
 * after ten minutes of quiet, or at a moment that means you are done — leaving
 * the app, ending a session, launching it, regaining signal, or asking.
 *
 * That split is the whole design. Frequent local writes make the phone reliable;
 * coarse remote pushes make the archive reliable without a network call per rep.
 */

export type PushReason =
  | 'quiet' // nothing touched for a while
  | 'hidden' // switched away from the app
  | 'session_ended'
  | 'launch'
  | 'online' // signal came back
  | 'manual';

export interface SchedulerOptions {
  /** Save locally this long after the last change. */
  localDebounceMs?: number;
  /** Push remotely after this much quiet. */
  quiescenceMs?: number;
  /** First retry delay after a failed push; doubles up to maxBackoffMs. */
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  saveLocal: () => Promise<void>;
  /**
   * Pushes whatever is outstanding and reports how much still is. The count is
   * what drives `pushPending` — the scheduler never decides for itself whether
   * work exists, because a flag it owns can fall out of step with the queue it
   * describes.
   */
  pushRemote: (reason: PushReason) => Promise<{ remaining: number }>;
  /** Called whenever pending state changes, so the UI can show exposure. */
  onStateChange?: (state: SchedulerState) => void;
}

export interface SchedulerState {
  /** Local changes not yet written to disk. */
  savePending: boolean;
  /** Documents saved locally that the remote has not accepted. Reported by the pusher. */
  pushPending: boolean;
  /** When the oldest unpushed change was made. */
  oldestUnpushedAt: Date | null;
  /** Consecutive failed pushes. Zero once one succeeds. */
  failures: number;
  pushing: boolean;
}

const DEFAULTS = {
  localDebounceMs: 1_000,
  quiescenceMs: 10 * 60_000,
  baseBackoffMs: 30_000,
  maxBackoffMs: 15 * 60_000,
};

export class SaveScheduler {
  private opts: Required<Omit<SchedulerOptions, 'onStateChange'>> &
    Pick<SchedulerOptions, 'onStateChange'>;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private state: SchedulerState = {
    savePending: false,
    pushPending: false,
    oldestUnpushedAt: null,
    failures: 0,
    pushing: false,
  };

  constructor(options: SchedulerOptions) {
    this.opts = { ...DEFAULTS, ...options };
  }

  getState(): SchedulerState {
    return { ...this.state };
  }

  /** Something changed. Starts the local save clock and the coarse push clock. */
  changed(): void {
    this.state.savePending = true;
    if (!this.state.oldestUnpushedAt) this.state.oldestUnpushedAt = new Date();
    this.emit();

    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.saveNow(), this.opts.localDebounceMs);

    // Quiet means quiet: every change pushes the remote deadline back.
    this.armQuietPush();
  }

  /** Writes to disk immediately, without waiting out the debounce. */
  async saveNow(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.state.savePending) return;
    await this.opts.saveLocal();
    this.state.savePending = false;
    this.state.pushPending = true;
    this.emit();
  }

  /**
   * Push now. Always saves locally first, so an interrupted push never loses the
   * change it was carrying.
   *
   * This does not check whether it believes there is work: the pusher owns the
   * queue and answers that question. Anything written to storage directly — a
   * deleted session, a weigh-in, a manual record — is outstanding whether or not
   * this object was told about it, and a flag here that said otherwise would
   * silently strand it.
   */
  async flush(reason: PushReason): Promise<void> {
    await this.saveNow();
    if (this.state.pushing) return;

    this.clearPushTimer();
    this.state.pushing = true;
    this.emit();

    try {
      const { remaining } = await this.opts.pushRemote(reason);
      this.state.pushPending = remaining > 0;
      if (remaining === 0) this.state.oldestUnpushedAt = null;
      this.state.failures = 0;
    } catch {
      // Keep the pending flag and the original timestamp: exposure should grow
      // with the age of the change, not reset on every failed attempt.
      this.state.failures += 1;
      this.armBackoff();
    } finally {
      this.state.pushing = false;
      this.emit();
    }
  }

  /** Wire to visibilitychange, session end, launch and reconnection. */
  onHidden = () => void this.flush('hidden');
  onSessionEnded = () => void this.flush('session_ended');
  onLaunch = () => void this.flush('launch');
  onOnline = () => void this.flush('online');

  /** Stops every timer. Call when tearing the app down. */
  dispose(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.clearPushTimer();
    this.saveTimer = null;
  }

  private armQuietPush(): void {
    this.clearPushTimer();
    this.pushTimer = setTimeout(() => void this.flush('quiet'), this.opts.quiescenceMs);
  }

  private armBackoff(): void {
    const delay = Math.min(
      this.opts.baseBackoffMs * 2 ** (this.state.failures - 1),
      this.opts.maxBackoffMs,
    );
    this.clearPushTimer();
    this.pushTimer = setTimeout(() => void this.flush('quiet'), delay);
  }

  private clearPushTimer(): void {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = null;
  }

  private emit(): void {
    this.opts.onStateChange?.(this.getState());
  }
}
