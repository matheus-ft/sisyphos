import type {
  BodyweightEntry,
  ConflictRecord,
  Exercise,
  ExerciseAddition,
  ManualRecord,
  OneRmEntry,
  Session,
  TableRow,
  Template,
} from '../model';
import type { TableKind } from './paths';

/**
 * How every log-repo file is written and read (docs/STORAGE.md 1.4; columns and
 * keys in docs/DATA.md).
 *
 * Deterministic: the same data always serialises to the same bytes, because sync
 * compares content by hash. Every parser throws `FormatError` (errors.ts) for
 * content that is not a valid file of its kind.
 *
 * STUB — implemented by the formats work package.
 */

const todo = (): never => {
  throw new Error('not implemented: storage/formats');
};

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
  /** Record to cells, each cell already in its serialised text form (1.4). */
  toRow(record: R): TableRow;
  /** Cells to record. Throws FormatError. */
  fromRow(row: TableRow): R;
}

export interface Tables {
  bodyweight: TableSchema<BodyweightEntry>;
  oneRm: TableSchema<OneRmEntry>;
  manualRecords: TableSchema<ManualRecord>;
  additions: TableSchema<ExerciseAddition>;
}

export type RecordOf<K extends TableKind> = Tables[K] extends TableSchema<infer R> ? R : never;

export const TABLES: Tables = new Proxy({} as Tables, { get: todo });

// --- tables --------------------------------------------------------------------

/** A row's key, as one string: equal keys give equal strings, different keys different ones. */
export function rowKey(_schema: TableSchema<unknown>, _row: TableRow): string {
  return todo();
}

/** One row as its CSV line, without the newline. Rows are equal when their lines are. */
export function rowLine(_schema: TableSchema<unknown>, _row: TableRow): string {
  return todo();
}

/** The whole file: header, rows sorted by key (1.4), trailing newline. */
export function tableText(_schema: TableSchema<unknown>, _rows: TableRow[]): string {
  return todo();
}

/** Parses a table file. Throws FormatError: wrong header, bad quoting, wrong cell count, duplicate key. */
export function tableRows(_schema: TableSchema<unknown>, _text: string): TableRow[] {
  return todo();
}

/**
 * A table file as the decision sees it: row key to row line. Null (no file) is
 * an empty map. Throws FormatError like `tableRows`.
 */
export function tableUnits(
  _schema: TableSchema<unknown>,
  _text: string | null,
): Map<string, string> {
  return todo();
}

/** The inverse of `tableUnits`: the file holding exactly these rows, sorted. */
export function unitsText(_schema: TableSchema<unknown>, _units: Map<string, string>): string {
  return todo();
}

/** Parses one row line back to cells (for conflict records and resolution). */
export function lineRow(_schema: TableSchema<unknown>, _line: string): TableRow {
  return todo();
}

// --- JSON files ------------------------------------------------------------------

export function serializeSession(_session: Session): string {
  return todo();
}
export function parseSession(_text: string): Session {
  return todo();
}

export function serializeTemplate(_template: Template): string {
  return todo();
}
export function parseTemplate(_text: string): Template {
  return todo();
}

export function serializeConflict(_conflict: ConflictRecord): string {
  return todo();
}
export function parseConflict(_text: string): ConflictRecord {
  return todo();
}

export function serializeFormatMarker(_marker: FormatMarker): string {
  return todo();
}
export function parseFormatMarker(_text: string): FormatMarker {
  return todo();
}

// --- the exercise library ------------------------------------------------------

/**
 * `based_on` (9.1): the first 12 hex characters of the SHA-1 of the exercise's
 * row as the app serialises it, shipped columns only.
 */
export function exerciseRowHash(_exercise: Exercise): string {
  return todo();
}

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
