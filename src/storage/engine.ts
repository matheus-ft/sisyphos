import type { Session } from '../model';
import type { StorageAdapter } from './StorageAdapter';
import { Conflict, type SyncAdapter } from './SyncAdapter';
import { SaveScheduler, type PushReason, type SchedulerState } from './scheduler';
import { exposure, requestPersistence, type Exposure } from './durability';
import { isSessionPath } from './paths';

/**
 * Ties the three pieces together: edits go in, disk and the remote stay in step.
 *
 * Nothing else in the app talks to the storage or sync adapters directly. The UI
 * calls `edit()` on every keystroke and is otherwise uninvolved — when the write
 * happens, when the push happens, and what to do when the remote moved are all
 * decided here.
 */

export interface EngineOptions {
  storage: StorageAdapter & {
    knownSha(path: string): Promise<string | null>;
    oldestDirtyAt(): Promise<Date | null>;
  };
  sync: SyncAdapter;
  /** Commit subject for a pushed document. */
  describe?: (path: string) => string;
  onConflict?: (c: ConflictReport) => void;
  onStateChange?: (s: EngineState) => void;
  localDebounceMs?: number;
  quiescenceMs?: number;
}

export interface ConflictReport {
  path: string;
  /** What this device holds. */
  mine: string;
  /** What the remote holds now. Null when it was deleted there. */
  theirs: string | null;
  remoteSha: string;
}

export interface EngineState extends SchedulerState {
  syncConfigured: boolean;
  conflicts: ConflictReport[];
}

const defaultDescribe = (path: string) =>
  isSessionPath(path)
    ? `log: ${path
        .split('/')
        .pop()
        ?.replace(/\.json$/, '')}`
    : `update ${path}`;

export class LogEngine {
  private scheduler: SaveScheduler;
  private pending = new Map<string, Session>();
  private conflicts: ConflictReport[] = [];

  constructor(private opts: EngineOptions) {
    this.scheduler = new SaveScheduler({
      localDebounceMs: opts.localDebounceMs,
      quiescenceMs: opts.quiescenceMs,
      saveLocal: () => this.writePending(),
      pushRemote: (reason) => this.pushDirty(reason),
      onStateChange: (s) =>
        this.opts.onStateChange?.({
          ...s,
          syncConfigured: this.opts.sync.isConfigured(),
          conflicts: [...this.conflicts],
        }),
    });
  }

  /**
   * Call on every change. Coalescing several edits of one session into a single
   * write is the scheduler's job, so there is no cost to calling this per
   * keystroke — which is the point, because a change the UI holds back is a
   * change that can be lost.
   */
  edit(session: Session): void {
    this.pending.set(session.id, { ...session, updated_at: new Date().toISOString() });
    this.scheduler.changed();
  }

  /**
   * Deletes a session and schedules the removal.
   *
   * Everything below exists so that storage is never written behind the
   * scheduler's back. A change made straight to the adapter would still be
   * queued — the dirty queue is the authority — but nothing would arm the timer
   * that eventually sends it.
   */
  async deleteSession(id: string): Promise<void> {
    // An edit still waiting out the debounce would write the session straight back.
    this.pending.delete(id);
    await this.opts.storage.deleteSession(id);
    this.scheduler.changed();
  }

  async saveBodyweight(e: Parameters<StorageAdapter['putBodyweightEntry']>[0]): Promise<void> {
    await this.opts.storage.putBodyweightEntry(e);
    this.scheduler.changed();
  }

  async saveOneRm(e: Parameters<StorageAdapter['putOneRmEntry']>[0]): Promise<void> {
    await this.opts.storage.putOneRmEntry(e);
    this.scheduler.changed();
  }

  async saveManualRecord(r: Parameters<StorageAdapter['putManualRecord']>[0]): Promise<void> {
    await this.opts.storage.putManualRecord(r);
    this.scheduler.changed();
  }

  async saveTemplate(t: Parameters<StorageAdapter['putTemplate']>[0]): Promise<void> {
    await this.opts.storage.putTemplate(t);
    this.scheduler.changed();
  }

  async addLocalExercise(e: Parameters<StorageAdapter['addLocalExercise']>[0]): Promise<void> {
    await this.opts.storage.addLocalExercise(e);
    this.scheduler.changed();
  }

  /** Writes anything held in memory, without waiting out the debounce. */
  async saveNow(): Promise<void> {
    await this.scheduler.saveNow();
  }

  /** Saves, then pushes. Wire to visibilitychange, session end, launch, reconnect. */
  async flush(reason: PushReason): Promise<void> {
    await this.scheduler.flush(reason);
  }

  /**
   * Call once at launch: asks for persistent storage, then pushes whatever the
   * last run could not send.
   */
  async start(): Promise<void> {
    await requestPersistence();
    await this.flush('launch');
  }

  /** Wire these to the browser. Each is a moment that means "you are done for now". */
  attach(target: Window = window): () => void {
    const onHide = () => {
      if (target.document.visibilityState === 'hidden') void this.flush('hidden');
    };
    const onOnline = () => void this.flush('online');
    target.document.addEventListener('visibilitychange', onHide);
    target.addEventListener('online', onOnline);
    return () => {
      target.document.removeEventListener('visibilitychange', onHide);
      target.removeEventListener('online', onOnline);
    };
  }

  /** What would be lost if this device vanished right now. */
  async exposure(): Promise<Exposure> {
    const dirty = await this.opts.storage.listDirty();
    return exposure({
      syncConfigured: this.opts.sync.isConfigured(),
      unsyncedDocuments: dirty.length,
      oldestUnsyncedAt: await this.opts.storage.oldestDirtyAt(),
    });
  }

  getConflicts(): ConflictReport[] {
    return [...this.conflicts];
  }

  /**
   * Resolve a conflict by declaring a winner. Nothing is chosen automatically —
   * the two versions are a person's call, and guessing is how a session quietly
   * disappears.
   */
  async resolveConflict(path: string, keep: 'mine' | 'theirs'): Promise<void> {
    const c = this.conflicts.find((x) => x.path === path);
    if (!c) return;
    if (keep === 'mine') {
      // The report is a snapshot from when the conflict was found. Anything
      // edited since is part of "mine", so resolve with what the device holds now.
      const current = (await this.opts.storage.listDirty()).find((d) => d.path === path);
      const body = current?.body ?? c.mine;
      const base = c.remoteSha || null;
      if (body === '') {
        // Mine is a deletion: remove the remote copy rather than write an empty file.
        if (base) await this.opts.sync.remove?.(path, base, `remove ${path} (resolved)`);
        await this.opts.storage.markClean(path, '', current?.version);
      } else {
        const { sha } = await this.opts.sync.push(
          path,
          body,
          base,
          `${this.describe(path)} (resolved)`,
        );
        // The remote is at the sha this push produced, not the one it replaced.
        await this.opts.storage.markClean(path, sha, current?.version);
      }
    } else {
      // Keeping theirs means accepting the remote as the new base; the caller
      // reloads from it.
      await this.opts.storage.markClean(path, c.remoteSha);
    }
    this.conflicts = this.conflicts.filter((x) => x.path !== path);
  }

  // --- the two callbacks the scheduler drives -------------------------------

  /**
   * A session leaves `pending` only once it is on disk, and only if no newer
   * edit replaced it while it was being written. A failed write leaves it and
   * everything after it pending for the retry.
   */
  private async writePending(): Promise<void> {
    for (const [id, s] of [...this.pending]) {
      await this.opts.storage.putSession(s);
      if (this.pending.get(id) === s) this.pending.delete(id);
    }
  }

  /**
   * Pushes every dirty document, oldest first.
   *
   * One failure does not abandon the rest: a conflict on Tuesday's session
   * should not keep Wednesday's off the remote. Conflicts are collected and
   * surfaced; anything else rethrows, so the scheduler backs off and retries.
   */
  private async pushDirty(_reason: PushReason): Promise<{ remaining: number }> {
    if (!this.opts.sync.isConfigured()) {
      return { remaining: (await this.opts.storage.listDirty()).length };
    }

    const dirty = await this.opts.storage.listDirty();
    let firstError: unknown = null;

    for (const { path, body, version } of dirty) {
      try {
        const baseSha = await this.opts.storage.knownSha(path);
        if (body === '') {
          // An emptied document is a deletion: the session was removed here.
          if (baseSha) await this.opts.sync.remove?.(path, baseSha, `remove ${path}`);
          await this.opts.storage.markClean(path, '', version);
          continue;
        }
        const { sha } = await this.opts.sync.push(path, body, baseSha, this.describe(path));
        await this.opts.storage.markClean(path, sha, version);
      } catch (err) {
        if (err instanceof Conflict) {
          await this.recordConflict(path, body, err);
          continue;
        }
        firstError ??= err;
      }
    }

    if (firstError) throw firstError;
    return { remaining: (await this.opts.storage.listDirty()).length };
  }

  private async recordConflict(path: string, mine: string, err: Conflict): Promise<void> {
    const remote = await this.opts.sync.pull(path).catch(() => null);
    const report: ConflictReport = {
      path,
      mine,
      theirs: remote?.body ?? null,
      remoteSha: remote?.sha ?? err.remoteSha,
    };
    this.conflicts = [...this.conflicts.filter((c) => c.path !== path), report];
    this.opts.onConflict?.(report);
  }

  private describe(path: string): string {
    return (this.opts.describe ?? defaultDescribe)(path);
  }

  dispose(): void {
    this.scheduler.dispose();
  }
}
