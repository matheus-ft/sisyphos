import exercisesCsv from '../library/exercises.csv?raw';
import musclesCsv from '../library/muscles.csv?raw';
import type { LibraryConflict } from '../library/assemble';
import { parseExercises, parseMuscles } from '../library/parse';
import type { ConflictRecord, Exercise } from '../model';
import { requestPersistence } from './durability';
import { Log } from './log';
import { GitHubRemote } from './remote/github';
import type { Remote } from './remote/remote';
import { Scheduler } from './scheduler';
import { setUp, type SetupInput, type SetupResult } from './setup';
import type { StatusSnapshot } from './status';
import { IndexedDbStore } from './store/indexeddb';
import type { LocalStore, Settings } from './store/store';

/**
 * The app's storage, built once at startup: the device store, the log over it,
 * the remote the settings name, and the scheduler that decides when to sync
 * (docs/STORAGE.md sections 2, 7 and 8). Whatever shows the data (the UI) gets
 * these objects and calls `dispose` on teardown.
 */

/** What a remote is built from: the settings a setup stores, `branch` null before the repo has been read. */
export type RemoteConfig = SetupInput & { branch: string | null };

export type MakeRemote = (config: RemoteConfig) => Remote;

/** The store the app opens, which it closes on teardown. */
export type ClosableStore = LocalStore & { close(): void };

/** Builds the GitHub adapter; `fetch` is injectable so a test can watch every request. */
export function githubRemote(fetchImpl?: typeof fetch): MakeRemote {
  return (config) => new GitHubRemote({ ...config, fetch: fetchImpl });
}

/**
 * The remote the settings describe, or null when the device is not set up: a
 * setup stores owner, repo, token and branch together, and the branch only once
 * the repo has been read (section 8).
 */
export function remoteFromSettings(
  settings: Settings,
  make: MakeRemote = githubRemote(),
): Remote | null {
  const { owner, repo, token, branch } = settings;
  if (!owner || !repo || !token || !branch) return null;
  return make({ owner, repo, token, branch });
}

/**
 * `owner/repo` from what a lifter types or pastes: the name itself, or the
 * repository's address on github.com. Null when it names no repository.
 */
export function parseRepo(text: string): { owner: string; repo: string } | null {
  const name = text
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^(www\.)?github\.com\//i, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
  // GitHub's own rules: owners are letters, digits and hyphens; repositories
  // may also hold dots and underscores.
  const match = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(name);
  return match ? { owner: match[1], repo: match[2] } : null;
}

/** GitHub's token prefixes, which say what kind of token it is and nothing secret. */
const TOKEN_PREFIX = /^(github_pat_|gh[pousr]_)/;

/**
 * A token as it may be shown or logged: its kind, and its last four characters
 * when it is long enough that they give nothing away. Never more.
 */
export function maskToken(token: string | null): string {
  if (!token) return 'none';
  const prefix = TOKEN_PREFIX.exec(token)?.[0] ?? '';
  const secret = token.slice(prefix.length);
  return `${prefix}…${secret.length >= 16 ? secret.slice(-4) : ''}`;
}

/** The shipped exercise library (docs/STORAGE.md 9), as the app reads it. */
export function shippedExercises(): Exercise[] {
  const muscles = new Set(parseMuscles(musclesCsv).map((muscle) => muscle.id));
  return parseExercises(exercisesCsv, muscles);
}

export interface StartOptions {
  /** Where leaving the app and a returning connection are heard (7.1). */
  target: Window;
  onStatus?: (status: StatusSnapshot) => void;
  /** Conflicts a sync found or pulled, to announce (5.2). */
  onConflicts?: (conflicts: ConflictRecord[]) => void;
  /** Library conflicts (9.1) a sync brought, announced the same way (5.2). */
  onLibraryConflicts?: (conflicts: LibraryConflict[]) => void;
  /** Injectable for tests; default: parsed from `src/library/exercises.csv`. */
  shipped?: Exercise[];
  /** Injectable for tests; default: the GitHub adapter. */
  makeRemote?: MakeRemote;
  /** Injectable for tests; default: IndexedDB. */
  openStore?: () => Promise<ClosableStore>;
}

export interface AppStorage {
  store: LocalStore;
  log: Log;
  scheduler: Scheduler;
  shipped: Exercise[];
  /** Whether the browser agreed not to evict this app's storage under disk pressure. */
  persisted: Promise<boolean>;
  /**
   * Points the device at a log repo (section 8). It waits for any sync running
   * first, and no sync starts until it is done. Once that succeeds, the first
   * full sync starts, which `status` follows; the result does not wait for it.
   */
  connect(input: SetupInput): Promise<SetupResult>;
  /** Stops syncing for good and closes the store. */
  dispose(): void;
}

export async function startStorage(options: StartOptions): Promise<AppStorage> {
  const store = await (options.openStore ?? (() => IndexedDbStore.open()))();
  const { device_id: deviceId } = await store.settings();
  const shipped = options.shipped ?? shippedExercises();
  const makeRemote = options.makeRemote ?? githubRemote();
  const log = new Log(store, { deviceId, shipped });
  const scheduler = new Scheduler({
    store,
    log,
    deviceId,
    // Read afresh every time, so a new token or repo applies to the very next sync.
    remote: async () => remoteFromSettings(await store.settings(), makeRemote),
    onStatus: options.onStatus,
    onConflicts: options.onConflicts,
    onLibraryConflicts: options.onLibraryConflicts,
  });

  // Not awaited: a browser may ask the lifter first, and the launch sync need not wait for that.
  const persisted = requestPersistence();
  void scheduler.trigger('launch');
  scheduler.attach(options.target);

  return {
    store,
    log,
    scheduler,
    shipped,
    persisted,
    async connect(input) {
      // Never while a sync runs, in this tab or another: one that started
      // against the old repo and finished after the reset would write that
      // repo's history back as the new one's bases, and the first sync with the
      // new repo would then delete from the device every record it lacks.
      const result = await scheduler.whileNotSyncing(() => setUp(input, { store, makeRemote }));
      if (result.ok) void scheduler.trigger('manual');
      return result;
    },
    dispose() {
      scheduler.dispose();
      store.close();
    },
  };
}
