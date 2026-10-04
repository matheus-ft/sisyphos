import { csvLine, parseCsvRecords, parseNumber, wellFormed } from '../csv';
import { exerciseFromRow } from '../library/parse';
import type {
  BodyweightEntry,
  CompetitionLift,
  ConflictRecord,
  Exercise,
  ExerciseAddition,
  Interval,
  IsoDate,
  Load,
  LoadPrescription,
  LoadUnit,
  ManualRecord,
  OneRmEntry,
  PerformedSet,
  PrescribedSet,
  ProgramLabel,
  Session,
  SetState,
  TableRow,
  Template,
  WeightPrescription,
} from '../model';
import { FormatError } from './errors';
import { sha1Hex } from './hash';
import { classify, TABLE_PATHS, type TableKind } from './paths';

/**
 * How every log-repo file is written and read (docs/DATA.md, Serialisation and
 * The files).
 *
 * Deterministic: the same data always serialises to the same bytes, because sync
 * compares content by hash. Every parser throws `FormatError` (errors.ts) for
 * content that is not a valid file of its kind.
 *
 * The writers throw a plain `Error` for a record they cannot write faithfully (a
 * NaN weight, a missing column). That is a bug in the caller, and failing the
 * write is better than committing a file no device can read back.
 */

export interface FormatMarker {
  format: number;
}

/** One kind of lifter table: its file, header, key, and the mapping to its record type. */
export interface TableSchema<R> {
  kind: TableKind;
  path: string;
  /** The header, in file order. A file with any other header is unreadable. */
  columns: readonly string[];
  /** Key columns, in sort order. At most one row per key. */
  key: readonly string[];
  /** Key columns compared numerically when sorting; the rest compare by code point. */
  numeric: readonly string[];
  /** Record to cells, each cell already in its serialised text form (DATA.md, Serialisation). */
  toRow(record: R): TableRow;
  /** Cells to record. Throws FormatError. */
  fromRow(row: TableRow): R;
  /**
   * A key on its own, as a conflict record holds one, read by the same rules
   * as the key cells of a whole row and returned in the app's own form: what
   * `toRow(fromRow(row))` holds in those cells. Other cells are ignored. Throws
   * FormatError.
   */
  readKey(key: TableRow): TableRow;
}

export interface Tables {
  bodyweight: TableSchema<BodyweightEntry>;
  oneRm: TableSchema<OneRmEntry>;
  manualRecords: TableSchema<ManualRecord>;
  additions: TableSchema<ExerciseAddition>;
}

export type RecordOf<K extends TableKind> = Tables[K] extends TableSchema<infer R> ? R : never;

/** The shipped columns of `src/library/exercises.csv`, in order. */
export const SHIPPED_EXERCISE_COLUMNS: readonly string[] = [
  'id',
  'name',
  'base_lift',
  'tier',
  'unilateral',
  'load_type',
  'default_unit',
  'primary',
  'aux',
];

// --- vocabularies ----------------------------------------------------------------

/** Every member of a string union, which the compiler checks is complete. */
function members<T extends string>(all: Record<T, true>): readonly T[] {
  return Object.keys(all) as T[];
}

const LIFTS = members<CompetitionLift>({ squat: true, bench: true, deadlift: true });
const LOAD_UNITS = members<LoadUnit>({ kg: true, lb: true, pins: true });
const LOAD_KINDS = members<Load['kind']>({ weight: true, time: true, distance: true });
const WEIGHT_MODES = members<WeightPrescription['mode']>({
  absolute: true,
  pct_1rm: true,
  rpe_driven: true,
  bw_plus: true,
});
const SET_STATES = members<SetState>({ pending: true, done: true, skipped: true });
const TIME_PRECISIONS = members<Session['time_precision']>({ instant: true, date_only: true });
const BODYWEIGHT_SOURCES = members<BodyweightEntry['source']>({ manual: true, import: true });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// --- cells ---------------------------------------------------------------------

/** A number as its cell: JavaScript's shortest round-trip form (DATA.md, Serialisation). */
function numberCell(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`cannot write ${n} as a number`);
  return String(n);
}

function optionalNumberCell(n: number | null): string {
  return n == null ? '' : numberCell(n);
}

function readDate(row: TableRow, column: string): IsoDate {
  const cell = row[column];
  if (!ISO_DATE.test(cell)) throw new FormatError(`${column}: expected a date, got "${cell}"`);
  return cell;
}

/**
 * A number as a person writes one, and as `String(n)` does: decimal digits,
 * optionally signed, with a point and an exponent. `Number` alone also reads
 * `0x52`, `0b101` and `0o7`, so a weight typed `0x52` would be taken as 82 and
 * rewritten as such.
 */
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function readNumber(row: TableRow, column: string): number {
  const cell = row[column];
  const n = DECIMAL.test(cell) ? parseNumber(cell) : null;
  if (n === null) throw new FormatError(`${column}: expected a number, got "${cell}"`);
  return n;
}

/** An empty cell is null; that is also how an empty string is written, so both read as null. */
function readOptionalNumber(row: TableRow, column: string): number | null {
  return row[column] === '' ? null : readNumber(row, column);
}

function readOptionalText(row: TableRow, column: string): string | null {
  return row[column] === '' ? null : row[column];
}

function readText(row: TableRow, column: string): string {
  if (row[column] === '') throw new FormatError(`${column}: must not be empty`);
  return row[column];
}

function readOneOf<T extends string>(row: TableRow, column: string, allowed: readonly T[]): T {
  const cell = row[column] as T;
  if (!allowed.includes(cell)) {
    throw new FormatError(`${column}: expected one of ${allowed.join(', ')}, got "${cell}"`);
  }
  return cell;
}

/**
 * The submission workflow's rule for an exercise id. An addition with any other
 * id could never be proposed for the shipped library, and an empty one names no
 * exercise at all.
 */
const EXERCISE_ID = /^[a-z0-9_]+$/;

function readExerciseId(row: TableRow): string {
  const id = readText(row, 'id');
  if (!EXERCISE_ID.test(id)) {
    throw new FormatError(`id: expected lowercase letters, digits and _, got "${id}"`);
  }
  return id;
}

/**
 * A boolean cell of a lifter's addition. The spellings the shipped library's
 * reader (`parseBool`) takes as true, in any case, or empty for false. Anything
 * else is refused rather than read as false: a hand-typed `Y` meant yes, and
 * the next sync would otherwise rewrite it as empty, losing what was typed.
 */
/**
 * Only unambiguous spellings. The app writes `true` or empty, but a hand edit
 * saying `false`, `no` or `0` means false as clearly as an empty cell does, and
 * refusing it would turn a harmless edit into an unreadable file. Anything else
 * (`Y`, `banana`) is refused rather than guessed at.
 */
const FLAG_SPELLINGS = ['true', '1', 'yes', '', 'false', '0', 'no'];

function checkFlag(row: TableRow, column: string): void {
  const cell = row[column];
  if (!FLAG_SPELLINGS.includes(cell.trim().toLowerCase())) {
    throw new FormatError(`${column}: expected true, false or empty, got "${cell}"`);
  }
}

/**
 * An exercise's shipped columns as the app writes them. Defaults the shipped
 * file leaves blank (`external`, `kg`) are written out, so every exercise has
 * exactly one serialisation whichever file it came from.
 */
function exerciseRow(exercise: Exercise): TableRow {
  return {
    id: exercise.id,
    name: exercise.name,
    base_lift: exercise.base_lift ?? '',
    tier: exercise.tier,
    unilateral: exercise.unilateral ? 'true' : '',
    load_type: exercise.load_type,
    default_unit: exercise.default_unit,
    primary: exercise.muscles.primary.join('/'),
    aux: exercise.muscles.aux.join('/'),
  };
}

// --- tables --------------------------------------------------------------------

export const TABLES: Tables = {
  bodyweight: {
    kind: 'bodyweight',
    path: TABLE_PATHS.bodyweight,
    columns: ['date', 'weight_kg', 'source'],
    key: ['date'],
    numeric: [],
    toRow: (entry) => ({
      date: entry.date,
      weight_kg: numberCell(entry.weight_kg),
      source: entry.source,
    }),
    fromRow: (row) => ({
      date: readDate(row, 'date'),
      weight_kg: readNumber(row, 'weight_kg'),
      source: readOneOf(row, 'source', BODYWEIGHT_SOURCES),
    }),
    readKey: (key) => ({ date: readDate(key, 'date') }),
  },

  oneRm: {
    kind: 'oneRm',
    path: TABLE_PATHS.oneRm,
    columns: ['date', 'lift', 'weight_kg', 'note'],
    key: ['date', 'lift'],
    numeric: [],
    toRow: (entry) => ({
      date: entry.date,
      lift: entry.lift,
      weight_kg: numberCell(entry.weight_kg),
      note: entry.note ?? '',
    }),
    fromRow: (row) => ({
      date: readDate(row, 'date'),
      lift: readOneOf(row, 'lift', LIFTS),
      weight_kg: readNumber(row, 'weight_kg'),
      note: readOptionalText(row, 'note'),
    }),
    readKey: (key) => ({ date: readDate(key, 'date'), lift: readOneOf(key, 'lift', LIFTS) }),
  },

  manualRecords: {
    kind: 'manualRecords',
    path: TABLE_PATHS.manualRecords,
    columns: ['date', 'exercise_id', 'reps', 'weight_kg', 'rpe', 'context'],
    key: ['date', 'exercise_id', 'reps'],
    // So a 10-rep record sorts after a 2-rep one.
    numeric: ['reps'],
    toRow: (record) => ({
      date: record.date,
      exercise_id: record.exercise_id,
      reps: numberCell(record.reps),
      weight_kg: numberCell(record.weight_kg),
      rpe: optionalNumberCell(record.rpe),
      context: record.context ?? '',
    }),
    fromRow: (row) => ({
      source: 'manual',
      date: readDate(row, 'date'),
      exercise_id: readText(row, 'exercise_id'),
      reps: readNumber(row, 'reps'),
      weight_kg: readNumber(row, 'weight_kg'),
      rpe: readOptionalNumber(row, 'rpe'),
      context: readOptionalText(row, 'context'),
    }),
    readKey: (key) => ({
      date: readDate(key, 'date'),
      exercise_id: readText(key, 'exercise_id'),
      reps: numberCell(readNumber(key, 'reps')),
    }),
  },

  additions: {
    kind: 'additions',
    path: TABLE_PATHS.additions,
    columns: [...SHIPPED_EXERCISE_COLUMNS, 'based_on'],
    key: ['id'],
    numeric: [],
    toRow: (addition) => ({ ...exerciseRow(addition), based_on: addition.based_on ?? '' }),
    fromRow: (row) => {
      // Stricter than the shipped library, which is reviewed before it ships:
      // this file is the lifter's, may be edited by hand, and is rewritten from
      // what is read, so a cell read as something it does not say would be
      // silently replaced.
      readExerciseId(row);
      readText(row, 'name');
      checkFlag(row, 'unilateral');
      // Otherwise the shipped library's own rules, so an addition and the
      // shipped row it repeats read as the same exercise. Muscle ids are not
      // checked against `muscles.csv`: a muscle can be added to it, and an
      // addition written by a build that has it must stay readable by one that
      // does not yet, rather than make the whole file unreadable there.
      let exercise: Exercise;
      try {
        exercise = exerciseFromRow(row);
      } catch (e) {
        throw new FormatError(e instanceof Error ? e.message : String(e));
      }
      return { ...exercise, based_on: readOptionalText(row, 'based_on') };
    },
    readKey: (key) => ({ id: readExerciseId(key) }),
  },
};

/** The given columns' cells, in that order. A missing column is a caller's bug. */
function cells(row: TableRow, columns: readonly string[]): string[] {
  return columns.map((column) => {
    const cell = row[column];
    if (typeof cell !== 'string') throw new Error(`row has no ${column}: ${JSON.stringify(row)}`);
    return cell;
  });
}

/**
 * A row in the app's own form: read into its record and written back. Readers
 * return rows in this form, so `2.0` and `2` are one key and one row, and a hand
 * edited file is rewritten in the app's form by the next sync (DATA.md, Serialisation).
 */
function canonical(schema: TableSchema<unknown>, row: TableRow): TableRow {
  return schema.toRow(schema.fromRow(row));
}

/** By code point, as 1.4 says. `<` on strings compares UTF-16 units, which differ above U+FFFF. */
function byCodePoint(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return x[i].codePointAt(0)! - y[i].codePointAt(0)!;
  }
  return x.length - y.length;
}

function compareKeys(schema: TableSchema<unknown>, a: TableRow, b: TableRow): number {
  for (const column of schema.key) {
    const order = schema.numeric.includes(column)
      ? Number(a[column]) - Number(b[column])
      : byCodePoint(a[column], b[column]);
    if (order !== 0) return order;
  }
  return 0;
}

/** A row's key, as one string: equal keys give equal strings, different keys different ones. */
export function rowKey(schema: TableSchema<unknown>, row: TableRow): string {
  // The key cells as a CSV line: unambiguous, since the reader reverses it exactly.
  return csvLine(cells(row, schema.key));
}

/** One row as its CSV line, without the newline. Rows are equal when their lines are. */
export function rowLine(schema: TableSchema<unknown>, row: TableRow): string {
  return csvLine(cells(row, schema.columns));
}

/** A row's cells as the file will hold them: lone surrogates as U+FFFD (`wellFormed`). */
function wellFormedRow(row: TableRow): TableRow {
  return Object.fromEntries(
    Object.entries(row).map(([column, cell]) => [column, wellFormed(cell)]),
  );
}

/** The whole file: header, rows sorted by key (DATA.md, Serialisation), trailing newline. */
export function tableText(schema: TableSchema<unknown>, given: TableRow[]): string {
  // Sorted and checked for one row per key as the file will hold them, as its
  // reader will see them: `a\uD83D` and `a\uDCAA` are one key there, and U+FFFD
  // sorts after U+E000 where the lone half sorted before it.
  const rows = given.map(wellFormedRow);

  // Only rows in the app's own form, so the file reads back as exactly these rows.
  for (const row of rows) {
    const line = rowLine(schema, row);
    let written: string;
    try {
      written = rowLine(schema, canonical(schema, row));
    } catch (e) {
      throw new Error(`cannot write ${line} to ${schema.path}: ${(e as Error).message}`, {
        cause: e,
      });
    }
    if (written !== line) {
      throw new Error(`cannot write ${line} to ${schema.path}: its own form is ${written}`);
    }
  }

  const sorted = [...rows].sort((a, b) => compareKeys(schema, a, b));
  for (let i = 1; i < sorted.length; i++) {
    if (compareKeys(schema, sorted[i - 1], sorted[i]) === 0) {
      throw new Error(`two rows for ${rowKey(schema, sorted[i])} in ${schema.path}`);
    }
  }
  const lines = [csvLine(schema.columns), ...sorted.map((row) => rowLine(schema, row))];
  return lines.map((line) => `${line}\n`).join('');
}

function rowOf(schema: TableSchema<unknown>, values: string[]): TableRow {
  const row: TableRow = {};
  schema.columns.forEach((column, i) => {
    row[column] = values[i];
  });
  return row;
}

/** Parses a table file. Throws FormatError: wrong header, bad quoting, wrong cell count, duplicate key. */
export function tableRows(schema: TableSchema<unknown>, text: string): TableRow[] {
  const [header, ...records] = parseCsvRecords(text, { strict: true });
  const headerMatches =
    header !== undefined &&
    header.length === schema.columns.length &&
    header.every((column, i) => column === schema.columns[i]);
  if (!headerMatches) {
    throw new FormatError(`the header must be ${csvLine(schema.columns)}`);
  }

  const seen = new Set<string>();
  return records.map((values, i) => {
    let row: TableRow;
    try {
      row = canonical(schema, rowOf(schema, values));
    } catch (e) {
      if (e instanceof FormatError) throw new FormatError(`row ${i + 1}: ${e.message}`);
      throw e;
    }
    const key = rowKey(schema, row);
    if (seen.has(key)) throw new FormatError(`row ${i + 1}: a second row for ${key}`);
    seen.add(key);
    return row;
  });
}

/**
 * A table file as the decision sees it: row key to row line. Null (no file) is
 * an empty map. Throws FormatError like `tableRows`.
 */
export function tableUnits(schema: TableSchema<unknown>, text: string | null): Map<string, string> {
  const units = new Map<string, string>();
  if (text === null) return units;
  for (const row of tableRows(schema, text)) units.set(rowKey(schema, row), rowLine(schema, row));
  return units;
}

/** The inverse of `tableUnits`: the file holding exactly these rows, sorted. */
export function unitsText(schema: TableSchema<unknown>, units: Map<string, string>): string {
  const rows = [...units].map(([key, line]) => {
    const row = lineRow(schema, line);
    if (rowKey(schema, row) !== key) throw new Error(`row ${line} is filed under key ${key}`);
    return row;
  });
  return tableText(schema, rows);
}

/** Parses one row line back to cells (for conflict records and resolution). */
export function lineRow(schema: TableSchema<unknown>, line: string): TableRow {
  const records = parseCsvRecords(line, { strict: true });
  if (records.length !== 1 || records[0].length !== schema.columns.length) {
    throw new FormatError(`not one row of ${schema.columns.length} cells: ${line}`);
  }
  return canonical(schema, rowOf(schema, records[0]));
}

// --- JSON files: writing -----------------------------------------------------------
//
// Each record is rebuilt key by key before stringifying, so the key order is the
// one written here, never the order the object happened to be built in, and a
// property the type does not have is never written.

function json(value: unknown): string {
  const text = JSON.stringify(
    value,
    (_key, v: unknown) => {
      // Absent is null, never omitted (DATA.md, Serialisation).
      if (v === undefined) return null;
      if (typeof v === 'number' && !Number.isFinite(v)) {
        throw new Error(`cannot write ${v} as a number`);
      }
      return v;
    },
    2,
  );
  return `${text}\n`;
}

/** For a union tag the types rule out but a caller's bug can still produce. */
function unknownTag(what: string, value: never): never {
  throw new Error(`cannot write ${what} ${JSON.stringify(value)}`);
}

function intervalJson(interval: Interval | null) {
  return interval == null ? null : [interval[0], interval[1]];
}

function weightJson(weight: WeightPrescription) {
  switch (weight.mode) {
    case 'absolute':
      return { mode: weight.mode, kg: intervalJson(weight.kg) };
    case 'pct_1rm':
      return { mode: weight.mode, pct: intervalJson(weight.pct), lift: weight.lift };
    case 'rpe_driven':
      return { mode: weight.mode };
    case 'bw_plus':
      return { mode: weight.mode, added_kg: intervalJson(weight.added_kg) };
  }
  return unknownTag('weight prescription', weight);
}

function loadPrescriptionJson(load: LoadPrescription) {
  switch (load.kind) {
    case 'weight':
      return { kind: load.kind, weight: weightJson(load.weight) };
    case 'time':
      return { kind: load.kind, seconds: intervalJson(load.seconds) };
    case 'distance':
      return { kind: load.kind, meters: intervalJson(load.meters) };
  }
  return unknownTag('load prescription', load);
}

function prescriptionJson(set: Omit<PrescribedSet, 'id'>) {
  return {
    reps: intervalJson(set.reps),
    rpe: intervalJson(set.rpe),
    load: loadPrescriptionJson(set.load),
    is_warmup: set.is_warmup,
    notes: set.notes,
  };
}

function loadJson(load: Load | null) {
  if (load == null) return null;
  switch (load.kind) {
    case 'weight':
      return { kind: load.kind, value: load.value, unit: load.unit };
    case 'time':
      return { kind: load.kind, seconds: load.seconds };
    case 'distance':
      return { kind: load.kind, meters: load.meters };
  }
  return unknownTag('load', load);
}

function performedJson(set: PerformedSet) {
  return {
    id: set.id,
    prescribed_id: set.prescribed_id,
    state: set.state,
    reps: set.reps,
    rpe: set.rpe,
    load: loadJson(set.load),
    is_warmup: set.is_warmup,
    notes: set.notes,
  };
}

function sessionJson(session: Session) {
  const label = session.label;
  return {
    id: session.id,
    date: session.date,
    started_at: session.started_at,
    tz: session.tz,
    time_precision: session.time_precision,
    ended_at: session.ended_at,
    label: {
      name: label.name,
      block: label.block,
      week: label.week,
      day: label.day,
      weekday: label.weekday,
    },
    bodyweight_kg: session.bodyweight_kg,
    notes: session.notes,
    exercises: session.exercises.map((instance) => ({
      id: instance.id,
      exercise_id: instance.exercise_id,
      prescribed: instance.prescribed.map((set) => ({ id: set.id, ...prescriptionJson(set) })),
      performed: instance.performed.map(performedJson),
      notes: instance.notes,
    })),
    created_at: session.created_at,
    updated_at: session.updated_at,
    device_id: session.device_id,
  };
}

function templateJson(template: Template) {
  return {
    id: template.id,
    name: template.name,
    intention: template.intention,
    exercises: template.exercises.map((exercise) => ({
      exercise_id: exercise.exercise_id,
      prescribed: exercise.prescribed.map(prescriptionJson),
    })),
    created_at: template.created_at,
    updated_at: template.updated_at,
  };
}

/** A table row as a JSON object, columns in the given order. */
function rowJson(row: TableRow, columns: readonly string[]) {
  const values = cells(row, columns);
  return Object.fromEntries(columns.map((column, i) => [column, values[i]]));
}

// --- JSON files: reading -----------------------------------------------------------
//
// Enough checking that garbage is a FormatError naming where it went wrong, and
// that everything read has the type it claims. A missing field is an error, not
// a null: the writer never omits one. Unknown fields are dropped.

/** Reads one JSON value, `path` naming it in errors (`session.exercises[2].load`). */
type Read<T> = (value: unknown, path: string) => T;

const fail = (path: string, expected: string): never => {
  throw new FormatError(`${path}: expected ${expected}`);
};

const str: Read<string> = (v, path) => (typeof v === 'string' ? v : fail(path, 'a string'));
const num: Read<number> = (v, path) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fail(path, 'a number');
const bool: Read<boolean> = (v, path) => (typeof v === 'boolean' ? v : fail(path, 'a boolean'));
const date: Read<IsoDate> = (v, path) =>
  typeof v === 'string' && ISO_DATE.test(v) ? v : fail(path, 'a YYYY-MM-DD date');
const nothing: Read<null> = (v, path) => (v === null ? null : fail(path, 'null'));

const nullable =
  <T>(read: Read<T>): Read<T | null> =>
  (v, path) =>
    v === null ? null : read(v, path);

const oneOf =
  <T extends string>(allowed: readonly T[]): Read<T> =>
  (v, path) =>
    allowed.includes(v as T) ? (v as T) : fail(path, `one of ${allowed.join(', ')}`);

const array =
  <T>(read: Read<T>): Read<T[]> =>
  (v, path) =>
    Array.isArray(v) ? v.map((item, i) => read(item, `${path}[${i}]`)) : fail(path, 'an array');

const interval: Read<Interval> = (v, path) => {
  if (!Array.isArray(v) || v.length !== 2) return fail(path, 'an interval [low, high]');
  return [nullable(num)(v[0], `${path}[0]`), nullable(num)(v[1], `${path}[1]`)];
};

/** An object's fields, each read by the reader given for it. */
function fields(v: unknown, path: string) {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'an object');
  const object = v as Record<string, unknown>;
  return <T>(key: string, read: Read<T>): T => {
    if (!Object.hasOwn(object, key)) throw new FormatError(`${path}.${key}: missing`);
    return read(object[key], `${path}.${key}`);
  };
}

const weightPrescription: Read<WeightPrescription> = (v, path) => {
  const field = fields(v, path);
  const mode = field('mode', oneOf(WEIGHT_MODES));
  switch (mode) {
    case 'absolute':
      return { mode, kg: field('kg', interval) };
    case 'pct_1rm':
      return { mode, pct: field('pct', interval), lift: field('lift', oneOf(LIFTS)) };
    case 'rpe_driven':
      return { mode };
    case 'bw_plus':
      return { mode, added_kg: field('added_kg', interval) };
  }
};

const loadPrescription: Read<LoadPrescription> = (v, path) => {
  const field = fields(v, path);
  const kind = field('kind', oneOf(LOAD_KINDS));
  switch (kind) {
    case 'weight':
      return { kind, weight: field('weight', weightPrescription) };
    case 'time':
      return { kind, seconds: field('seconds', interval) };
    case 'distance':
      return { kind, meters: field('meters', interval) };
  }
};

const prescription: Read<Omit<PrescribedSet, 'id'>> = (v, path) => {
  const field = fields(v, path);
  return {
    reps: field('reps', nullable(interval)),
    rpe: field('rpe', nullable(interval)),
    load: field('load', loadPrescription),
    is_warmup: field('is_warmup', bool),
    notes: field('notes', nullable(str)),
  };
};

const prescribedSet: Read<PrescribedSet> = (v, path) => ({
  id: fields(v, path)('id', str),
  ...prescription(v, path),
});

const load: Read<Load> = (v, path) => {
  const field = fields(v, path);
  const kind = field('kind', oneOf(LOAD_KINDS));
  switch (kind) {
    case 'weight':
      return { kind, value: field('value', num), unit: field('unit', oneOf(LOAD_UNITS)) };
    case 'time':
      return { kind, seconds: field('seconds', num) };
    case 'distance':
      return { kind, meters: field('meters', num) };
  }
};

const performedSet: Read<PerformedSet> = (v, path) => {
  const field = fields(v, path);
  return {
    id: field('id', str),
    prescribed_id: field('prescribed_id', nullable(str)),
    state: field('state', oneOf(SET_STATES)),
    reps: field('reps', nullable(num)),
    rpe: field('rpe', nullable(num)),
    load: field('load', nullable(load)),
    is_warmup: field('is_warmup', bool),
    notes: field('notes', nullable(str)),
  };
};

const programLabel: Read<ProgramLabel> = (v, path) => {
  const field = fields(v, path);
  return {
    name: field('name', nullable(str)),
    block: field('block', nullable(num)),
    week: field('week', nullable(num)),
    day: field('day', nullable(num)),
    weekday: field('weekday', nullable(str)),
  };
};

const session: Read<Session> = (v, path) => {
  const field = fields(v, path);
  return {
    id: field('id', str),
    date: field('date', date),
    started_at: field('started_at', str),
    tz: field('tz', str),
    time_precision: field('time_precision', oneOf(TIME_PRECISIONS)),
    ended_at: field('ended_at', nullable(str)),
    label: field('label', programLabel),
    bodyweight_kg: field('bodyweight_kg', nullable(num)),
    notes: field('notes', nullable(str)),
    exercises: field(
      'exercises',
      array((x, p) => {
        const f = fields(x, p);
        return {
          id: f('id', str),
          exercise_id: f('exercise_id', str),
          prescribed: f('prescribed', array(prescribedSet)),
          performed: f('performed', array(performedSet)),
          notes: f('notes', nullable(str)),
        };
      }),
    ),
    created_at: field('created_at', str),
    updated_at: field('updated_at', str),
    device_id: field('device_id', str),
  };
};

const template: Read<Template> = (v, path) => {
  const field = fields(v, path);
  return {
    id: field('id', str),
    name: field('name', str),
    intention: field('intention', nullable(str)),
    exercises: field(
      'exercises',
      array((x, p) => {
        const f = fields(x, p);
        return {
          exercise_id: f('exercise_id', str),
          prescribed: f('prescribed', array(prescription)),
        };
      }),
    ),
    created_at: field('created_at', str),
    updated_at: field('updated_at', str),
  };
};

/**
 * Runs a table read on part of a JSON file, naming that part in its error. Any
 * error: what the table's readers cannot read is a file that does not parse.
 */
function within<T>(path: string, read: () => T): T {
  try {
    return read();
  } catch (e) {
    throw new FormatError(`${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** A table row as a JSON object: exactly these columns, each a string. */
const row =
  (columns: readonly string[]): Read<TableRow> =>
  (v, path) => {
    const field = fields(v, path);
    return Object.fromEntries(columns.map((column) => [column, field(column, str)]));
  };

/**
 * One leading byte-order mark is dropped first. The app never writes one (DATA.md, Serialisation),
 * but an editor may, and the remote keeps it so the content still hashes to its
 * sha. `JSON.parse` refuses it, which would make a file whose data is fine
 * unreadable; taken without it, the file is rewritten in the app's form by the
 * next sync, like any other file the app did not write. The CSV reader needs no
 * such step: it trims the BOM with the whitespace of the first cell.
 */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text.startsWith('\uFEFF') ? text.slice(1) : text);
  } catch (e) {
    throw new FormatError(`not JSON: ${(e as Error).message}`);
  }
}

// --- JSON files --------------------------------------------------------------------

export function serializeSession(session: Session): string {
  return json(sessionJson(session));
}
export function parseSession(text: string): Session {
  return session(parseJson(text), 'session');
}

export function serializeTemplate(template: Template): string {
  return json(templateJson(template));
}
export function parseTemplate(text: string): Template {
  return template(parseJson(text), 'template');
}

/**
 * The saved version is written in its own file's form: a session or template
 * as its file would hold it, a table row with its columns in the table's order.
 * What it is follows from `path`.
 */
export function serializeConflict(conflict: ConflictRecord): string {
  const target = classify(conflict.path);
  let key: Record<string, string> | null = null;
  let version: unknown = null;

  if (target.kind === 'table') {
    const schema = TABLES[target.table];
    if (conflict.key == null) throw new Error(`a conflict on ${conflict.path} needs the row's key`);
    key = rowJson(conflict.key, schema.key);
    version =
      conflict.version == null ? null : rowJson(conflict.version as TableRow, schema.columns);
  } else if (target.kind === 'session' || target.kind === 'template') {
    if (conflict.key != null) throw new Error(`a conflict on ${conflict.path} has no row key`);
    if (conflict.version != null) {
      version =
        target.kind === 'session'
          ? sessionJson(conflict.version as Session)
          : templateJson(conflict.version as Template);
    }
  } else {
    throw new Error(`cannot record a conflict on ${conflict.path}`);
  }

  return json({
    id: conflict.id,
    path: conflict.path,
    key,
    found_at: conflict.found_at,
    device_id: conflict.device_id,
    version,
  });
}
export function parseConflict(text: string): ConflictRecord {
  const field = fields(parseJson(text), 'conflict');
  const path = field('path', str);
  const target = classify(path);

  let key: TableRow | null;
  let version: Session | Template | TableRow | null;
  if (target.kind === 'table') {
    // Resolving finds the row to replace by `key` and writes `version` into the
    // table, so both are read into the app's own form, as the table's rows
    // are: a key reading `2.0` would match no row `2`, and one naming another
    // row than its version would leave two rows, or fail, when resolved.
    const schema: TableSchema<unknown> = TABLES[target.table];
    const givenKey = field('key', row(schema.key));
    const givenVersion = field('version', nullable(row(schema.columns)));
    const own = within('conflict.key', () => schema.readKey(givenKey));
    const saved =
      givenVersion === null
        ? null
        : within('conflict.version', () => canonical(schema, givenVersion));
    if (saved !== null && schema.key.some((column) => saved[column] !== own[column])) {
      fail('conflict.version', `the row conflict.key names, ${rowKey(schema, own)}`);
    }
    key = own;
    version = saved;
  } else if (target.kind === 'session' || target.kind === 'template') {
    key = field('key', nothing);
    const saved: Session | Template | null =
      target.kind === 'session'
        ? field('version', nullable(session))
        : field('version', nullable(template));
    // Resolving writes the saved record to `path`, and a file is named by the
    // id of the record it holds (DATA.md, Ids): one holding another id would be a second
    // file claiming that record.
    if (saved !== null && saved.id !== target.id) {
      fail('conflict.version.id', `"${target.id}", the id conflict.path names`);
    }
    version = saved;
  } else {
    return fail('conflict.path', 'a session, template or table path');
  }

  return {
    id: field('id', str),
    path,
    key,
    found_at: field('found_at', str),
    device_id: field('device_id', str),
    version,
  };
}

export function serializeFormatMarker(marker: FormatMarker): string {
  return json({ format: marker.format });
}
export function parseFormatMarker(text: string): FormatMarker {
  const field = fields(parseJson(text), 'sisyphos.json');
  const format = field('format', num);
  if (!Number.isInteger(format) || format < 1) fail('sisyphos.json.format', 'a format number');
  return { format };
}

// --- the exercise library ------------------------------------------------------

const encoder = new TextEncoder();

/**
 * `based_on`: the first 12 hex characters of the SHA-1 of the exercise's
 * row as the app serialises it, shipped columns only.
 */
export function exerciseRowHash(exercise: Exercise): string {
  const line = csvLine(cells(exerciseRow(exercise), SHIPPED_EXERCISE_COLUMNS));
  return sha1Hex(encoder.encode(line)).slice(0, 12);
}
