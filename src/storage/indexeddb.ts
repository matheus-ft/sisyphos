import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
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
import { PATHS } from './paths';

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
 */

interface Schema extends DBSchema {
  sessions: { key: string; value: Session; indexes: { 'by-date': string } };
  templates: { key: string; value: Template };
  localExercises: { key: string; value: Exercise };
  oneRm: { key: string; value: OneRmEntry & { key: string } };
  manualRecords: { key: string; value: ManualRecord };
  bodyweight: { key: string; value: BodyweightEntry };
  dirty: { key: string; value: { path: string; changedAt: string; seq: number } };
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
    // Both requests are issued before anything is awaited. An IndexedDB
    // transaction commits as soon as the microtask queue drains without a new
    // request, so awaiting between two operations can close the transaction
    // early and silently drop the second — here, a session saved but never
    // marked for the remote.
    void tx.objectStore('sessions').put(session);
    void markDirty(tx, PATHS.session(session));
    await tx.done;
  }

  async deleteSession(id: string): Promise<void> {
    const existing = await this.db.get('sessions', id);
    if (!existing) return;
    const tx = this.db.transaction(['sessions', 'dirty'], 'readwrite');
    void tx.objectStore('sessions').delete(id);
    void markDirty(tx, PATHS.session(existing));
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
    void tx.objectStore('templates').delete(id);
    void markDirty(tx, PATHS.templates);
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
    void tx.objectStore('manualRecords').delete(id);
    void markDirty(tx, PATHS.manualRecords);
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

  async listDirty(): Promise<Array<{ path: string; body: string }>> {
    const rows = await this.db.getAll('dirty');
    const out: Array<{ path: string; body: string }> = [];
    for (const { path } of rows.sort((a, b) => a.seq - b.seq)) {
      out.push({ path, body: await this.serialize(path) });
    }
    return out;
  }

  async markClean(path: string, remoteSha: string): Promise<void> {
    const tx = this.db.transaction(['dirty', 'meta'], 'readwrite');
    void tx.objectStore('dirty').delete(path);
    void tx.objectStore('meta').put({ key: `sha:${path}`, value: remoteSha });
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
    if (path.startsWith('sessions/')) {
      const id = path
        .split('_')
        .pop()!
        .replace(/\.json$/, '');
      const s = await this.db.get('sessions', id);
      // A deleted session serialises as empty; the pusher turns that into a delete.
      return s ? JSON.stringify(s, null, 2) + '\n' : '';
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
    void (tx.objectStore(store) as never as { put(v: unknown): Promise<unknown> }).put(value);
    void markDirty(tx, path);
    await tx.done;
  }
}

async function markDirty(
  tx: {
    objectStore(name: 'dirty'): { put(v: { path: string; changedAt: string }): Promise<unknown> };
  },
  path: string,
): Promise<void> {
  await tx.objectStore('dirty').put({ path, changedAt: new Date().toISOString() });
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
