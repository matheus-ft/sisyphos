import { expect } from 'vitest';
import type { ConflictRecord, IsoDate, Session, Template } from '../src/model';
import type { Mode } from '../src/storage/decide';
import { SyncError } from '../src/storage/errors';
import {
  parseConflict,
  serializeFormatMarker,
  serializeSession,
  serializeTemplate,
  TABLES,
  tableRows,
  tableText,
} from '../src/storage/formats';
import { classify, FORMAT_PATH, isOurs, sessionPath, templatePath } from '../src/storage/paths';
import { MemoryRemote } from '../src/storage/remote/memory';
import type { Exclusive, LocalStore, StoreOp } from '../src/storage/store/store';
import { MemoryStore } from '../src/storage/store/memory';
import { runSync, type SyncDeps, type SyncResult } from '../src/storage/sync';

/**
 * Devices and a log repo for the sync tests: in-memory store and remote, a
 * fixed clock and a seeded random per device, so every run is the same.
 */

export const T0 = '2026-09-27T10:00:00.000Z';
export const TODAY = T0.slice(0, 10);

export const MARKER = serializeFormatMarker({ format: 1 });
export const README = '# sisyphos-log\n';

/** Mulberry32: a small seeded PRNG. */
export function prng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A log repo just after setup: the README the lifter ticked, and the format marker. */
export function newLog(): MemoryRemote {
  const remote = new MemoryRemote();
  remote.externalCommit([{ path: FORMAT_PATH, content: MARKER }], 'Start the training log');
  return remote;
}

/** What a device is killed with: an error thrown where the app would have died. */
export function killed(): SyncError {
  return new SyncError('retryable', 'killed');
}

// --- records ---------------------------------------------------------------------

export function session(id: string, notes: string | null = null): Session {
  const date = id.slice(0, 10);
  return {
    id,
    date,
    started_at: `${date}T07:00:00.000Z`,
    tz: 'Europe/Lisbon',
    time_precision: 'instant',
    ended_at: `${date}T08:30:00.000Z`,
    label: { name: null, block: null, week: null, day: null, weekday: null },
    bodyweight_kg: null,
    notes,
    exercises: [],
    created_at: `${date}T07:00:00.000Z`,
    updated_at: `${date}T08:30:00.000Z`,
    device_id: 'dev-a',
  };
}

export function template(id: string, intention: string | null = null): Template {
  return { id, name: 'Squat day A', intention, exercises: [], created_at: T0, updated_at: T0 };
}

export const sessionFile = (s: Session): [string, string] => [
  sessionPath(s.id),
  serializeSession(s),
];
export const templateFile = (t: Template): [string, string] => [
  templatePath(t.id),
  serializeTemplate(t),
];

export const BODYWEIGHT = TABLES.bodyweight.path;

/** The bodyweight table holding these weigh-ins, or null for none. */
export function bodyweight(rows: Record<IsoDate, number>): string | null {
  const schema = TABLES.bodyweight;
  const entries = Object.entries(rows);
  if (entries.length === 0) return null;
  return tableText(
    schema,
    entries.map(([date, weight_kg]) => schema.toRow({ date, weight_kg, source: 'manual' })),
  );
}

/** A bodyweight row as a conflict record holds it. */
export function weighIn(date: IsoDate, weight: number) {
  return { date, weight_kg: String(weight), source: 'manual' };
}

/** A file as a change for `MemoryRemote.externalCommit`. */
export const change = ([path, content]: [string, string | null]) => ({ path, content });

// --- devices ---------------------------------------------------------------------

/** A store that dies on its Nth `apply`, as the app killed at that moment would. */
class CrashingStore implements LocalStore {
  private applies = 0;

  constructor(
    private readonly inner: MemoryStore,
    private readonly crashAt: number,
  ) {}

  content = (path: string) => this.inner.content(path);
  paths = () => this.inner.paths();
  entry = (path: string) => this.inner.entry(path);
  entries = () => this.inner.entries();
  meta = () => this.inner.meta();
  inflight = () => this.inner.inflight();
  settings = () => this.inner.settings();
  saveSettings: LocalStore['saveSettings'] = (patch) => this.inner.saveSettings(patch);
  resetSync = () => this.inner.resetSync();

  exclusive<T>(fn: (store: Exclusive) => Promise<T>): Promise<T> {
    return this.inner.exclusive((s) =>
      fn({
        content: s.content,
        paths: s.paths,
        entry: s.entry,
        entries: s.entries,
        meta: s.meta,
        inflight: s.inflight,
        apply: async (ops: StoreOp[]) => {
          if (++this.applies === this.crashAt) throw new Error('killed');
          await s.apply(ops);
        },
      }),
    );
  }
}

export interface DeviceOptions {
  seed?: number;
  now?: () => Date;
}

export class Device {
  /** What survives the app being killed. */
  disk: MemoryStore;
  readonly random: () => number;
  readonly now: () => Date;
  private crashAt: number | null = null;

  constructor(
    readonly remote: MemoryRemote,
    readonly id: string,
    options: DeviceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date(T0));
    this.random = prng(options.seed ?? id.length);
    this.disk = new MemoryStore({ now: this.now, deviceId: id });
  }

  /** The next sync's store dies on its Nth apply. */
  crashAtApply(n: number): void {
    this.crashAt = n;
  }

  /** Killed and relaunched: only what reached the disk survives. */
  restart(): void {
    this.disk = this.disk.restart();
  }

  deps(overrides: Partial<SyncDeps> = {}): SyncDeps {
    const store = this.crashAt === null ? this.disk : new CrashingStore(this.disk, this.crashAt);
    this.crashAt = null;
    return {
      store,
      remote: this.remote,
      deviceId: this.id,
      now: this.now,
      random: this.random,
      ...overrides,
    };
  }

  sync(mode: Mode = 'full', overrides: Partial<SyncDeps> = {}): Promise<SyncResult> {
    return runSync(this.deps(overrides), mode);
  }

  /** A local write, as the log's write queue makes one. */
  async write(path: string, text: string | null): Promise<void> {
    await this.disk.exclusive((s) => s.apply([{ op: 'content', path, text }]));
  }

  put(file: [string, string]): Promise<void> {
    return this.write(file[0], file[1]);
  }

  /** Logs a weigh-in over whatever the table holds now, as the log's `putRow` would. */
  async weigh(date: IsoDate, weight_kg: number): Promise<void> {
    const schema = TABLES.bodyweight;
    const text = await this.disk.content(BODYWEIGHT);
    const rows = text === null ? [] : tableRows(schema, text).filter((row) => row.date !== date);
    rows.push(schema.toRow({ date, weight_kg, source: 'manual' }));
    await this.write(BODYWEIGHT, tableText(schema, rows));
  }

  /** Every file the device holds, path to content. */
  async files(): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    for (const path of await this.disk.paths()) {
      const text = await this.disk.content(path);
      if (text !== null) files.set(path, text);
    }
    return files;
  }

  async conflicts(): Promise<ConflictRecord[]> {
    return conflictsIn(await this.files());
  }
}

// --- checks ----------------------------------------------------------------------

/** The app's files at the remote head: everything but foreign files. */
export function remoteFiles(remote: MemoryRemote): Map<string, string> {
  return new Map([...remote.files()].filter(([path]) => isOurs(path)));
}

export function conflictsIn(files: Map<string, string>): ConflictRecord[] {
  return [...files]
    .filter(([path]) => classify(path).kind === 'conflict')
    .map(([, text]) => parseConflict(text));
}

/** The files, conflict records left out. */
export function withoutConflicts(files: Map<string, string>): Map<string, string> {
  return new Map([...files].filter(([path]) => classify(path).kind !== 'conflict'));
}

/**
 * Every device holds exactly the app's files at the head, agrees with it on
 * every base, has recorded it, and has nothing in flight.
 */
export async function expectConverged(remote: MemoryRemote, ...devices: Device[]): Promise<void> {
  const head = await remote.head();
  const expected = remoteFiles(remote);
  for (const device of devices) {
    expect(await device.files(), device.id).toEqual(expected);
    for (const entry of await device.disk.entries()) {
      expect(entry.local_sha, `${device.id} ${entry.path}`).toBe(entry.base_sha);
      expect(entry.unsynced_since).toBeNull();
    }
    expect((await device.disk.meta()).last_synced_head, device.id).toBe(head);
    expect(await device.disk.inflight(), device.id).toBeNull();
  }
}

// --- a log two devices agree on ------------------------------------------------------

export const S1 = session('2026-09-14-aaaa', 'v0');
export const S2 = session('2026-09-16-bbbb', 'v0');
export const T1 = template('squat-day-a-k3f9', 'v0');
export const ROWS: Record<IsoDate, number> = {
  '2026-09-01': 80,
  '2026-09-02': 81,
  '2026-09-03': 82,
};

/** Two devices in agreement with a log holding two sessions, a template and three weigh-ins. */
export async function synced() {
  const remote = newLog();
  const a = new Device(remote, 'dev-a', { seed: 1 });
  const b = new Device(remote, 'dev-b', { seed: 2 });
  await a.put(sessionFile(S1));
  await a.put(sessionFile(S2));
  await a.put(templateFile(T1));
  await a.write(BODYWEIGHT, bodyweight(ROWS));
  await a.sync();
  await b.sync();
  await expectConverged(remote, a, b);
  return { remote, a, b };
}

/** Syncs every device in turn until a whole pass takes and pushes nothing. */
export async function syncUntilQuiet(...devices: Device[]): Promise<void> {
  for (let pass = 0; pass < 10; pass++) {
    let changed = false;
    for (const device of devices) {
      const result = await device.sync();
      if (result.committed !== null || result.taken.length > 0) changed = true;
    }
    if (!changed) return;
  }
  throw new Error('the devices never stopped syncing');
}

/** The remote operations `work` makes. */
export async function callsDuring(remote: MemoryRemote, work: () => Promise<unknown>) {
  const before = remote.calls.length;
  await work();
  return remote.calls.slice(before);
}

/** A sync with nothing to do on either side makes one request and no commit (4.2 step 2). */
export async function expectQuiet(device: Device): Promise<void> {
  let result: SyncResult | undefined;
  const calls = await callsDuring(device.remote, async () => {
    result = await device.sync();
  });
  expect(calls, device.id).toEqual(['head']);
  expect(result!.committed).toBeNull();
  expect(result!.taken).toEqual([]);
}

/** The error a promise rejects with. */
export async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: unknown) => e,
  );
}

/** The kind of SyncError a promise rejects with. */
export async function failure(promise: Promise<unknown>): Promise<string> {
  const error = await rejection(promise);
  expect(error).toBeInstanceOf(SyncError);
  return (error as SyncError).kind;
}
