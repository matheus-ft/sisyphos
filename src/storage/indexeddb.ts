import { openDB, unwrap, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  BodyweightEntry,
  Exercise,
  ManualRecord,
  Muscle,
  OneRmEntry,
  Session,
  Template,
} from '../model';
import { parseExercises, parseMuscles } from '../library/parse';
import musclesCsv from '../library/muscles.csv?raw';
import exercisesCsv from '../library/exercises.csv?raw';
import type { StorageAdapter } from './StorageAdapter';
import { PATHS, isSessionPath } from './paths';

/**
 * The on-device store.
 *
 * Sessions are one record each, mirroring how they sync — two devices editing
 * different sessions can never collide. Everything else is small enough to be a
 * single collection.
 *
 * Every write also stamps the document's path into `dirty`, which is the only
 * thing the sync layer reads. Marking a document dirty in the same transaction
 * as the write means a change can never be saved but forgotten.
 *
 * Nothing awaits inside a transaction. A transaction commits as soon as the
 * microtask queue drains without a new request, so awaiting between two
 * operations can close it early and silently drop the second. A write that
 * depends on a read is issued from the read's success event instead, where the
 * transaction is guaranteed to still be open.
 */

interface Schema extends DBSchema {
  sessions: { key: string; value: Session; indexes: { 'by-date': string } };
  templates: { key: string; value: Template };
  localExercises: { key: string; value: Exercise };
  oneRm: { key: string; value: OneRmEntry & { key: string } };
  manualRecords: { key: string; value: ManualRecord };
  bodyweight: { key: string; value: BodyweightEntry };
  dirty: { key: string; value: DirtyRow };
  meta: { key: string; value: { key: string; value: unknown } };
}

export const DB_NAME = 'sisyphos';
const DB_VERSION = 1;

export async function openLogDb(name = DB_NAME): Promise<IDBPDatabase<Schema>> {
  return openDB<Schema>(name, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('by-date', 'date');
      db.createObjectStore('templates', { keyPath: 'id' });
      db.createObjectStore('localExercises', { keyPath: 'id' });
      db.createObjectStore('oneRm', { keyPath: 'key' });
      db.createObjectStore('manualRecords', { keyPath: 'id' });
      db.createObjectStore('bodyweight', { keyPath: 'date' });
      db.createObjectStore('dirty', { keyPath: 'path' });
      db.createObjectStore('meta', { keyPath: 'key' });
    },
  });
}

/** The shipped library, parsed once. Muscles have no writer by design. */
const MUSCLES = parseMuscles(musclesCsv);
const SHIPPED_EXERCISES = parseExercises(exercisesCsv, new Set(MUSCLES.map((m) => m.id)));

export class IndexedDbStorage implements StorageAdapter {
  constructor(private db: IDBPDatabase<Schema>) {}

  static async open(name = DB_NAME): Promise<IndexedDbStorage> {
    return new IndexedDbStorage(await openLogDb(name));
  }

  // --- sessions ------------------------------------------------------------

  async getSession(id: string): Promise<Session | null> {
    return (await this.db.get('sessions', id)) ?? null;
  }

  async listSessions(fromDate: string, toDate: string): Promise<Session[]> {
    const range = IDBKeyRange.bound(fromDate, toDate);
    const rows = await this.db.getAllFromIndex('sessions', 'by-date', range);
    return rows.sort(
      (a, b) => a.date.localeCompare(b.date) || a.started_at.localeCompare(b.started_at),
    );
  }

  async listIncompleteSessions(): Promise<Session[]> {
    const all = await this.db.getAll('sessions');
    return all.filter((s) =>
      s.exercises.some((x) => x.performed.some((p) => p.state === 'pending')),
    );
  }

  async listOpenSessions(): Promise<Session[]> {
    const all = await this.db.getAll('sessions');
    return all.filter((s) => s.ended_at === null);
  }

  async putSession(session: Session): Promise<void> {
    const tx = this.db.transaction(['sessions', 'dirty'], 'readwrite');
    const raw = unwrap(tx);
    const path = PATHS.session(session);
    // The path carries the date, so a changed date moves the file. The old path
    // is marked too; it no longer serialises to anything, so the pusher removes
    // it instead of leaving a second copy on the remote. It is marked after the
    // new path, so the new file is pushed before the old one goes. Requests run
    // in order, so this read sees the session as it was before the put below.
    onResult<Session | undefined>(raw.objectStore('sessions').get(session.id), (before) => {
      if (before && PATHS.session(before) !== path) markDirty(raw, PATHS.session(before));
    });
    raw.objectStore('sessions').put(session);
    markDirty(raw, path);
    await tx.done;
  }

  async deleteSession(id: string): Promise<void> {
    const existing = await this.db.get('sessions', id);
    if (!existing) return;
    const tx = this.db.transaction(['sessions', 'dirty'], 'readwrite');
    const raw = unwrap(tx);
    raw.objectStore('sessions').delete(id);
    markDirty(raw, PATHS.session(existing));
    await tx.done;
  }

  // --- templates -----------------------------------------------------------

  async getTemplates(): Promise<Template[]> {
    return this.db.getAll('templates');
  }

  async putTemplate(t: Template): Promise<void> {
    await this.write('templates', t, PATHS.templates);
  }

  async deleteTemplate(id: string): Promise<void> {
    const tx = this.db.transaction(['templates', 'dirty'], 'readwrite');
    const raw = unwrap(tx);
    raw.objectStore('templates').delete(id);
    markDirty(raw, PATHS.templates);
    await tx.done;
  }

  // --- library -------------------------------------------------------------

  async getMuscles(): Promise<Muscle[]> {
    return MUSCLES;
  }

  /**
   * The shipped library plus local additions. A local row wins on id collision,
   * which is what makes a merged upstream PR a no-op: the id is the same either
   * way, so the row simply stops being an addition.
   */
  async getExercises(): Promise<Exercise[]> {
    const local = await this.db.getAll('localExercises');
    const byId = new Map(SHIPPED_EXERCISES.map((e) => [e.id, e]));
    for (const e of local) byId.set(e.id, e);
    return [...byId.values()];
  }

  async getLocalExercises(): Promise<Exercise[]> {
    return this.db.getAll('localExercises');
  }

  async addLocalExercise(e: Exercise): Promise<void> {
    await this.write('localExercises', e, PATHS.localExercises);
  }

  // --- reference maxes -----------------------------------------------------

  async getOneRmHistory(): Promise<OneRmEntry[]> {
    const rows = await this.db.getAll('oneRm');
    return rows.map(({ key: _key, ...e }) => e).sort((a, b) => a.date.localeCompare(b.date));
  }

  async putOneRmEntry(e: OneRmEntry): Promise<void> {
    await this.write('oneRm', { ...e, key: `${e.lift}:${e.date}` }, PATHS.oneRm);
  }

  /**
   * The entry in force on a date: the latest one dated on or before it. Later
   * entries are invisible, so raising your 1RM never changes what a past session
   * asked for.
   */
  async oneRmAsOf(lift: string, date: string): Promise<number | null> {
    const rows = await this.getOneRmHistory();
    const eligible = rows.filter((r) => r.lift === lift && r.date <= date);
    return eligible.length ? eligible[eligible.length - 1].weight_kg : null;
  }

  // --- records -------------------------------------------------------------

  async getManualRecords(): Promise<ManualRecord[]> {
    return this.db.getAll('manualRecords');
  }

  async putManualRecord(r: ManualRecord): Promise<void> {
    await this.write('manualRecords', r, PATHS.manualRecords);
  }

  async deleteManualRecord(id: string): Promise<void> {
    const tx = this.db.transaction(['manualRecords', 'dirty'], 'readwrite');
    const raw = unwrap(tx);
    raw.objectStore('manualRecords').delete(id);
    markDirty(raw, PATHS.manualRecords);
    await tx.done;
  }

  // --- bodyweight ----------------------------------------------------------

  async getBodyweightHistory(): Promise<BodyweightEntry[]> {
    const rows = await this.db.getAll('bodyweight');
    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }

  async putBodyweightEntry(e: BodyweightEntry): Promise<void> {
    await this.write('bodyweight', e, PATHS.bodyweight);
  }

  /**
   * The most recent reading within `maxAgeDays` of the given date, looking
   * backwards only. Never returns a future weigh-in, and never pre-fills — the
   * caller shows this as a hint the lifter has to actively accept.
   */
  async bodyweightHintFor(date: string, maxAgeDays: number): Promise<BodyweightEntry | null> {
    const rows = await this.getBodyweightHistory();
    const target = Date.parse(date);
    let best: BodyweightEntry | null = null;
    for (const r of rows) {
      if (r.date > date) continue;
      const ageDays = (target - Date.parse(r.date)) / 86_400_000;
      if (ageDays <= maxAgeDays) best = r;
    }
    return best;
  }

  // --- sync bookkeeping ----------------------------------------------------

  async listDirty(): Promise<Array<{ path: string; body: string; version: number }>> {
    // Rows are read before bodies, so a write in between can only make a body
    // newer than its version claims. That document is pushed again next time,
    // which is harmless; the reverse would drop a change.
    const rows = await this.db.getAll('dirty');
    const out: Array<{ path: string; body: string; version: number }> = [];
    for (const { path, version } of rows.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))) {
      out.push({ path, body: await this.serialize(path), version: version ?? 0 });
    }
    return out;
  }

  async markClean(path: string, remoteSha: string, version?: number): Promise<void> {
    const tx = this.db.transaction(['dirty', 'meta'], 'readwrite');
    const raw = unwrap(tx);
    // Whatever happens to the dirty mark, the remote is now at this sha.
    raw.objectStore('meta').put({ key: `sha:${path}`, value: remoteSha });
    const dirty = raw.objectStore('dirty');
    onResult<DirtyRow | undefined>(dirty.get(path), (row) => {
      if (row && (version === undefined || (row.version ?? 0) === version)) dirty.delete(path);
    });
    await tx.done;
  }

  /** The sha the remote had when we last agreed with it, for compare-and-swap writes. */
  async knownSha(path: string): Promise<string | null> {
    const row = await this.db.get('meta', `sha:${path}`);
    return (row?.value as string) ?? null;
  }

  /** Age of the oldest unpushed change, for the exposure indicator. */
  async oldestDirtyAt(): Promise<Date | null> {
    const rows = await this.db.getAll('dirty');
    if (rows.length === 0) return null;
    return new Date(rows.map((r) => r.changedAt).sort()[0]);
  }

  // --- serialising a path back to its file ---------------------------------

  private async serialize(path: string): Promise<string> {
    if (isSessionPath(path)) {
      const id = path
        .split('_')
        .pop()!
        .replace(/\.json$/, '');
      const s = await this.db.get('sessions', id);
      // A session that is gone, or has moved to another date, serialises as empty
      // at this path; the pusher turns that into a delete.
      return s && PATHS.session(s) === path ? JSON.stringify(s, null, 2) + '\n' : '';
    }
    if (path === PATHS.templates) {
      return JSON.stringify(await this.getTemplates(), null, 2) + '\n';
    }
    if (path === PATHS.localExercises) return exercisesToCsv(await this.getLocalExercises());
    if (path === PATHS.oneRm) return oneRmToCsv(await this.getOneRmHistory());
    if (path === PATHS.manualRecords) return manualRecordsToCsv(await this.getManualRecords());
    if (path === PATHS.bodyweight) return bodyweightToCsv(await this.getBodyweightHistory());
    throw new Error(`No serialiser for ${path}`);
  }

  private async write<
    K extends 'templates' | 'localExercises' | 'oneRm' | 'manualRecords' | 'bodyweight',
  >(store: K, value: Schema[K]['value'], path: string): Promise<void> {
    const tx = this.db.transaction([store, 'dirty'], 'readwrite');
    const raw = unwrap(tx);
    raw.objectStore(store).put(value);
    markDirty(raw, path);
    await tx.done;
  }
}

/**
 * One document waiting for the remote.
 *
 * `seq` and `changedAt` belong to the first unpushed change and survive later
 * writes: push order is oldest change first, and exposure ages from when the
 * device first held something the remote did not. `version` belongs to the
 * latest write, so markClean can tell whether a push carried it.
 */
interface DirtyRow {
  path: string;
  changedAt: string;
  seq: number;
  version: number;
}

let lastSeq = 0;

/**
 * Increasing across reloads because it starts from the clock, and within one
 * millisecond because it never repeats: documents written in the same
 * millisecond still get a definite order.
 */
function nextSeq(): number {
  lastSeq = Math.max(lastSeq + 1, Date.now() * 1000);
  return lastSeq;
}

/** Runs `then` in the request's success event, while its transaction is still open. */
function onResult<T>(req: IDBRequest, then: (value: T) => void): void {
  req.addEventListener('success', () => then(req.result as T));
}

function markDirty(tx: IDBTransaction, path: string): void {
  const dirty = tx.objectStore('dirty');
  const seq = nextSeq();
  const now = new Date().toISOString();
  onResult<DirtyRow | undefined>(dirty.get(path), (before) => {
    dirty.put({
      path,
      changedAt: before?.changedAt ?? now,
      seq: before?.seq ?? seq,
      version: seq,
    } satisfies DirtyRow);
  });
}

// --- CSV writers: the mirror of library/parse.ts ---------------------------

const esc = (v: string | null | undefined) => (v ?? '').replace(/,/g, ' ');

function exercisesToCsv(rows: Exercise[]): string {
  const head = 'id,name,base_lift,tier,unilateral,load_type,default_unit,primary,aux';
  const body = rows.map((e) =>
    [
      e.id,
      esc(e.name),
      e.base_lift ?? '',
      e.tier,
      e.unilateral ? 'true' : '',
      e.load_type === 'external' ? '' : e.load_type,
      e.default_unit === 'kg' ? '' : e.default_unit,
      e.muscles.primary.join('/'),
      e.muscles.aux.join('/'),
    ].join(','),
  );
  return [head, ...body].join('\n') + '\n';
}

function oneRmToCsv(rows: OneRmEntry[]): string {
  return (
    [
      'date,lift,weight_kg,note',
      ...rows.map((r) => `${r.date},${r.lift},${r.weight_kg},${esc(r.note)}`),
    ].join('\n') + '\n'
  );
}

function manualRecordsToCsv(rows: ManualRecord[]): string {
  return (
    [
      'id,exercise_id,reps,weight_kg,date,rpe,context',
      ...rows.map((r) =>
        [r.id, r.exercise_id, r.reps, r.weight_kg, r.date, r.rpe ?? '', esc(r.context)].join(','),
      ),
    ].join('\n') + '\n'
  );
}

function bodyweightToCsv(rows: BodyweightEntry[]): string {
  return (
    ['date,weight_kg,source', ...rows.map((r) => `${r.date},${r.weight_kg},${r.source}`)].join(
      '\n',
    ) + '\n'
  );
}
