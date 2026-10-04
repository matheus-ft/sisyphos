import type {
  ConflictRecord,
  Exercise,
  ExerciseAddition,
  Id,
  IsoDate,
  Session,
  TableRow,
  Template,
} from '../model';
import { assembleLibrary, type AdditionFix, type AssembledLibrary } from '../library/assemble';
import type { SubmissionKind } from '../library/submission';
import {
  TABLES,
  exerciseRowHash,
  parseConflict,
  parseSession,
  parseTemplate,
  rowKey,
  serializeSession,
  serializeTemplate,
  tableRows,
  tableText,
  type RecordOf,
  type TableSchema,
} from './formats';
import { blobSha } from './hash';
import { newSessionId, newTemplateId } from './ids';
import { classify, conflictPath, sessionPath, templatePath, type TableKind } from './paths';
import type { Exclusive, LocalStore, StoreOp, StoreReader, SyncEntry } from './store/store';

/**
 * The lifter's records, over the store: what the app reads and writes.
 *
 * Every write goes through `store.exclusive` and is one `apply`, so it is on
 * disk when the promise resolves, and nothing is held in memory. Records
 * are serialised with formats.ts into the file content the store keeps; reads
 * parse it back, cached by content sha.
 */

export interface LogOptions {
  deviceId: string;
  /** The shipped exercise library, for `based_on` and `library()`. */
  shipped: Exercise[];
  now?: () => Date;
  random?: () => number;
}

export type ConflictChoice = 'keep_log' | 'use_saved';
export type LibraryConflictChoice = 'use_shipped' | 'keep_mine';

const ADDITIONS = TABLES.additions;

export class Log {
  /**
   * Parsed files by path, with the blob sha of the content they were parsed
   * from. A file is parsed again only once its content has changed, so listing
   * a thousand sessions costs one read of the sync entries, not a thousand
   * parses. Only reads use it: every write reads the file afresh in the queue.
   */
  private readonly parsed = new Map<string, { sha: string; value: unknown }>();
  private readonly shipped: Map<string, Exercise>;

  constructor(
    readonly store: LocalStore,
    readonly options: LogOptions,
  ) {
    this.shipped = new Map(options.shipped.map((exercise) => [exercise.id, exercise]));
  }

  // --- reads ----------------------------------------------------------------------

  async getSession(id: Id): Promise<Session | null> {
    const path = sessionPath(id);
    return this.read(path, await this.store.entry(path), parseSession);
  }

  /** Inclusive date range, ordered by date then `started_at`. */
  async listSessions(from: IsoDate, to: IsoDate): Promise<Session[]> {
    const sessions = await this.readAll('session', parseSession);
    return sessions.filter((s) => s.date >= from && s.date <= to).sort(bySessionOrder);
  }

  /** Sessions with `ended_at` null. */
  async listOpenSessions(): Promise<Session[]> {
    const sessions = await this.readAll('session', parseSession);
    return sessions.filter((s) => s.ended_at === null).sort(bySessionOrder);
  }

  /** Ordered by name, then id. */
  async getTemplates(): Promise<Template[]> {
    const templates = await this.readAll('template', parseTemplate);
    return templates.sort((a, b) => compare(a.name, b.name) || compare(a.id, b.id));
  }

  /** Every row of a table, in the file's order (sorted by key). A missing file is an empty table. */
  async getRows<K extends TableKind>(kind: K): Promise<RecordOf<K>[]> {
    const schema = TABLES[kind] as unknown as TableSchema<RecordOf<K>>;
    const rows = await this.read(schema.path, await this.store.entry(schema.path), (text) =>
      tableRows(schema, text).map((row) => schema.fromRow(row)),
    );
    return rows ?? [];
  }

  /** Every unresolved sync conflict, ordered by id: oldest first. */
  async getConflicts(): Promise<ConflictRecord[]> {
    const conflicts = await this.readAll('conflict', parseConflict);
    return conflicts.sort((a, b) => compare(a.id, b.id));
  }

  /**
   * The exercise library with the lifter's additions applied. Applies the
   * rule's fixes (rebase, drop) as writes before returning.
   */
  async library(): Promise<AssembledLibrary> {
    const assembled = assembleLibrary(
      this.options.shipped,
      await this.getRows('additions'),
      exerciseRowHash,
    );
    // The common case writes nothing, and need not wait in the queue.
    if (assembled.fixes.length === 0) return assembled;

    return this.store.exclusive(async (store) => {
      const table = await readTable(store, ADDITIONS);
      const current = assembleLibrary(
        this.options.shipped,
        table.rows.map((row) => ADDITIONS.fromRow(row)),
        exerciseRowHash,
      );
      await applyIfAny(store, tableOps(ADDITIONS, table.text, fixed(table.rows, current.fixes)));
      return current;
    });
  }

  // --- writes ---------------------------------------------------------------------

  async newSessionId(date: IsoDate): Promise<Id> {
    const held = await this.heldPaths();
    return newSessionId(date, (id) => held.has(sessionPath(id)), this.options.random);
  }

  async newTemplateId(name: string): Promise<Id> {
    const held = await this.heldPaths();
    return newTemplateId(name, (id) => held.has(templatePath(id)), this.options.random);
  }

  /**
   * Sets `updated_at` and `device_id`. A write whose only change would be a new
   * `updated_at` is skipped.
   */
  async putSession(session: Session): Promise<void> {
    const path = pathOf('session', session.id);
    await this.store.exclusive(async (store) => {
      const text = serializeSession({
        ...session,
        updated_at: this.now(),
        device_id: this.options.deviceId,
      });
      const current = parsedOrNull(await store.content(path), parseSession);
      // Who wrote last and when are about the write, not the session: a write
      // that changes nothing else is no change, and syncing it could only make
      // a conflict out of nothing.
      if (
        current !== null &&
        serializeSession({
          ...session,
          updated_at: current.updated_at,
          device_id: current.device_id,
        }) === serializeSession(current)
      ) {
        return;
      }
      await store.apply([{ op: 'content', path, text }]);
    });
  }

  async deleteSession(id: Id): Promise<void> {
    await this.deleteFile(pathOf('session', id));
  }

  /** Sets `updated_at`, with the same skip rule as sessions. */
  async putTemplate(template: Template): Promise<void> {
    const path = pathOf('template', template.id);
    await this.store.exclusive(async (store) => {
      const text = serializeTemplate({ ...template, updated_at: this.now() });
      const current = parsedOrNull(await store.content(path), parseTemplate);
      if (
        current !== null &&
        serializeTemplate({ ...template, updated_at: current.updated_at }) ===
          serializeTemplate(current)
      ) {
        return;
      }
      await store.apply([{ op: 'content', path, text }]);
    });
  }

  async deleteTemplate(id: Id): Promise<void> {
    await this.deleteFile(pathOf('template', id));
  }

  /** Replaces the row with the record's key. Not for additions: use `saveExercise`. */
  async putRow<K extends Exclude<TableKind, 'additions'>>(
    kind: K,
    record: RecordOf<K>,
  ): Promise<void> {
    const schema = TABLES[kind] as unknown as TableSchema<RecordOf<K>>;
    const row = schema.toRow(record);
    const key = rowKey(schema, row);
    await this.store.exclusive(async (store) => {
      const table = await readTable(store, schema);
      const rows = [...table.rows.filter((r) => rowKey(schema, r) !== key), row];
      await applyIfAny(store, tableOps(schema, table.text, rows));
    });
  }

  /** Removes the row with the record's key, if there is one. */
  async deleteRow<K extends TableKind>(kind: K, record: RecordOf<K>): Promise<void> {
    const schema = TABLES[kind] as unknown as TableSchema<RecordOf<K>>;
    const key = rowKey(schema, schema.toRow(record));
    await this.store.exclusive(async (store) => {
      const table = await readTable(store, schema);
      const rows = table.rows.filter((r) => rowKey(schema, r) !== key);
      await applyIfAny(store, tableOps(schema, table.text, rows));
    });
  }

  /**
   * Saves an exercise the lifter created or changed as an addition, with
   * `based_on` set to the current shipped row with its id. Returns the
   * submission to open: 'new', 'change', or null when it equals the shipped row.
   *
   * An exercise equal to its shipped row needs no addition, and any addition
   * the lifter had made for it is removed: otherwise the change they just
   * undid would stay in use.
   */
  async saveExercise(exercise: Exercise): Promise<SubmissionKind | null> {
    const shipped = this.shipped.get(exercise.id) ?? null;
    const based_on = shipped === null ? null : exerciseRowHash(shipped);
    const kind: SubmissionKind | null =
      shipped === null ? 'new' : exerciseRowHash(exercise) === based_on ? null : 'change';

    await this.store.exclusive(async (store) => {
      const table = await readTable(store, ADDITIONS);
      const rows = table.rows.filter((r) => r.id !== exercise.id);
      if (kind !== null) {
        const addition: ExerciseAddition = { ...exercise, based_on };
        rows.push(ADDITIONS.toRow(addition));
      }
      await applyIfAny(store, tableOps(ADDITIONS, table.text, rows));
    });
    return kind;
  }

  // --- conflicts ------------------------------------------------------------------

  /**
   * Keep the log's version, or write the saved one; either way the
   * record goes, in the same apply. A record that is already gone was resolved,
   * here or on another device, and resolving it again does nothing.
   */
  async resolveConflict(id: Id, choice: ConflictChoice): Promise<void> {
    const path = conflictPath(id);
    await this.store.exclusive(async (store) => {
      const text = await store.content(path);
      if (text === null) return;
      const ops: StoreOp[] =
        choice === 'use_saved' ? await savedVersionOps(store, parseConflict(text)) : [];
      ops.push({ op: 'content', path, text: null });
      await store.apply(ops);
    });
  }

  /**
   * 'use_shipped' deletes the addition; 'keep_mine' moves its
   * `based_on` to the current shipped row and returns 'change' so the caller opens
   * a new submission. Without both an addition and a shipped row with this id
   * there is no conflict, and nothing is written.
   */
  async resolveLibraryConflict(
    exerciseId: string,
    choice: LibraryConflictChoice,
  ): Promise<SubmissionKind | null> {
    const shipped = this.shipped.get(exerciseId);
    if (!shipped) return null;

    return this.store.exclusive(async (store) => {
      const table = await readTable(store, ADDITIONS);
      if (!table.rows.some((r) => r.id === exerciseId)) return null;

      const rows =
        choice === 'use_shipped'
          ? table.rows.filter((r) => r.id !== exerciseId)
          : table.rows.map((r) =>
              r.id === exerciseId ? { ...r, based_on: exerciseRowHash(shipped) } : r,
            );
      await applyIfAny(store, tableOps(ADDITIONS, table.text, rows));
      return choice === 'keep_mine' ? 'change' : null;
    });
  }

  // --- internals ------------------------------------------------------------------

  private now(): string {
    return (this.options.now ?? (() => new Date()))().toISOString();
  }

  /**
   * Every path the device holds, including those deleted here but not yet
   * synced and those a conflict record would write back: a new id must not
   * land on any of them.
   */
  private async heldPaths(): Promise<Set<string>> {
    const held = new Set(await this.store.paths());
    for (const conflict of await this.getConflicts()) held.add(conflict.path);
    return held;
  }

  /** A file's parsed content, from the cache while its sha is unchanged. A copy, so callers may edit it. */
  private async read<T>(
    path: string,
    entry: SyncEntry | null,
    parse: (text: string) => T,
  ): Promise<T | null> {
    if (entry?.local_sha == null) return null;
    const cached = this.parsed.get(path);
    if (cached?.sha === entry.local_sha) return structuredClone(cached.value as T);

    const text = await this.store.content(path);
    if (text === null) return null;
    const value = parse(text);
    // Filed under the sha of what was actually read, which a write made since
    // the entry was read may have changed.
    this.parsed.set(path, { sha: blobSha(text), value });
    return structuredClone(value);
  }

  /** Every file of one kind the device holds, parsed. */
  private async readAll<T>(
    kind: 'session' | 'template' | 'conflict',
    parse: (text: string) => T,
  ): Promise<T[]> {
    const entries = (await this.store.entries()).filter(
      (e) => e.local_sha !== null && classify(e.path).kind === kind,
    );
    const values = await Promise.all(entries.map((e) => this.read(e.path, e, parse)));
    return values.filter((v) => v !== null) as T[];
  }

  private async deleteFile(path: string): Promise<void> {
    await this.store.exclusive(async (store) => {
      if ((await store.content(path)) === null) return;
      await store.apply([{ op: 'content', path, text: null }]);
    });
  }
}

/**
 * The file a record's id names, refusing an id that would file it where sync
 * never looks (a session id not starting with a year, a `/` in an id).
 */
function pathOf(kind: 'session' | 'template', id: Id): string {
  const path = kind === 'session' ? sessionPath(id) : templatePath(id);
  if (classify(path).kind !== kind) throw new Error(`not a ${kind} id: "${id}"`);
  return path;
}

function parsedOrNull<T>(text: string | null, parse: (text: string) => T): T | null {
  return text === null ? null : parse(text);
}

/** Plain string order: the same on every device, which `localeCompare` is not. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function bySessionOrder(a: Session, b: Session): number {
  return compare(a.date, b.date) || compare(a.started_at, b.started_at) || compare(a.id, b.id);
}

/** A table's file and rows, read in the queue. A missing file is an empty table. */
async function readTable(
  store: StoreReader,
  schema: TableSchema<unknown>,
): Promise<{ text: string | null; rows: TableRow[] }> {
  const text = await store.content(schema.path);
  return { text, rows: text === null ? [] : tableRows(schema, text) };
}

/** The op writing a table with exactly these rows; none when that would change nothing. */
function tableOps(schema: TableSchema<unknown>, text: string | null, rows: TableRow[]): StoreOp[] {
  // A table with no rows is no file, the form the sync writes too (sync.ts), so
  // emptying a table here and syncing it never disagree about which it is.
  const next = rows.length === 0 ? null : tableText(schema, rows);
  return next === text ? [] : [{ op: 'content', path: schema.path, text: next }];
}

async function applyIfAny(store: Exclusive, ops: StoreOp[]): Promise<void> {
  if (ops.length > 0) await store.apply(ops);
}

/** Additions' rows with the library rule's fixes applied. */
function fixed(rows: TableRow[], fixes: AdditionFix[]): TableRow[] {
  const byId = new Map(fixes.map((fix) => [fix.id, fix]));
  return rows.flatMap((row) => {
    const fix = byId.get(row.id);
    if (!fix) return [row];
    return fix.op === 'drop' ? [] : [{ ...row, based_on: fix.based_on }];
  });
}

/** The ops that write a conflict record's saved version into the data. */
async function savedVersionOps(store: StoreReader, conflict: ConflictRecord): Promise<StoreOp[]> {
  const target = classify(conflict.path);
  switch (target.kind) {
    case 'session':
      return [
        {
          op: 'content',
          path: conflict.path,
          text: conflict.version === null ? null : serializeSession(conflict.version as Session),
        },
      ];
    case 'template':
      return [
        {
          op: 'content',
          path: conflict.path,
          text: conflict.version === null ? null : serializeTemplate(conflict.version as Template),
        },
      ];
    case 'table': {
      const schema: TableSchema<unknown> = TABLES[target.table];
      if (conflict.key === null) throw new Error(`conflict ${conflict.id} names no row`);
      const key = rowKey(schema, conflict.key);
      const table = await readTable(store, schema);
      const rows = table.rows.filter((r) => rowKey(schema, r) !== key);
      if (conflict.version !== null) {
        // In the app's own form, as the table's other rows are.
        rows.push(schema.toRow(schema.fromRow(conflict.version as TableRow)));
      }
      return tableOps(schema, table.text, rows);
    }
    default:
      throw new Error(`conflict ${conflict.id} is on ${conflict.path}, which holds no record`);
  }
}
