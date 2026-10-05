import type { ConflictRecord, Exercise, Session, TableRow, Template } from '../model';
import { classify } from '../storage/paths';
import { formatSet } from './session';

/**
 * A conflict as the sync screen shows it: what it is about, and both versions
 * as short lines a person can compare, rather than as JSON.
 */
export interface ConflictView {
  id: string;
  what: string;
  /** The version the data holds now: the log's. */
  current: string[];
  /** The version that did not stand, kept in the conflict record. */
  saved: string[];
  /** The two side by side, for highlighting what differs. */
  diff: DiffRow[];
}

/**
 * One row of the two versions laid side by side. A line only one side has
 * leaves the other cell null; two different lines in the same place share a row
 * so the screen can show them facing each other.
 */
export interface DiffRow {
  current: string | null;
  saved: string | null;
  /** Both cells hold the same line; every other row is highlighted. */
  same: boolean;
}

/**
 * Lines aligned by their longest common run, so one inserted line does not mark
 * every line after it as changed, which a comparison line by line would. Between
 * two matching lines, what each side has left over is paired off in order.
 */
export function diffLines(current: readonly string[], saved: readonly string[]): DiffRow[] {
  // lcs[i][j]: the longest common run of current[i..] and saved[j..].
  const lcs = Array.from({ length: current.length + 1 }, () =>
    new Array<number>(saved.length + 1).fill(0),
  );
  for (let i = current.length - 1; i >= 0; i--) {
    for (let j = saved.length - 1; j >= 0; j--) {
      lcs[i][j] =
        current[i] === saved[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let onlyCurrent: string[] = [];
  let onlySaved: string[] = [];
  const flush = () => {
    for (let k = 0; k < Math.max(onlyCurrent.length, onlySaved.length); k++) {
      rows.push({ current: onlyCurrent[k] ?? null, saved: onlySaved[k] ?? null, same: false });
    }
    onlyCurrent = [];
    onlySaved = [];
  };

  let i = 0;
  let j = 0;
  while (i < current.length || j < saved.length) {
    if (i < current.length && j < saved.length && current[i] === saved[j]) {
      flush();
      rows.push({ current: current[i], saved: saved[j], same: true });
      i++;
      j++;
    } else if (j >= saved.length || (i < current.length && lcs[i + 1][j] >= lcs[i][j + 1])) {
      onlyCurrent.push(current[i++]);
    } else {
      onlySaved.push(saved[j++]);
    }
  }
  flush();
  return rows;
}

type Version = Session | Template | TableRow | null;

export function describeConflict(
  record: ConflictRecord,
  current: Version,
  names: Map<string, string>,
): ConflictView {
  const kind = classify(record.path);
  const what =
    kind.kind === 'table'
      ? `${kind.table}: ${Object.values(record.key ?? {}).join(', ')}`
      : `${kind.kind} ${'id' in kind ? kind.id : record.path}`;
  const currentLines = linesOf(current, names);
  const savedLines = linesOf(record.version, names);
  return {
    id: record.id,
    what,
    current: currentLines,
    saved: savedLines,
    diff: diffLines(currentLines, savedLines),
  };
}

function linesOf(version: Version, names: Map<string, string>): string[] {
  if (version === null) return ['deleted'];
  if (isSession(version)) {
    return [
      version.date,
      ...version.exercises.map((e) => {
        const sets = e.performed.filter((s) => s.state === 'done').map((s) => formatSet(s));
        return `${names.get(e.exercise_id) ?? e.exercise_id}: ${sets.join(', ') || 'no sets'}`;
      }),
      ...(version.notes ? [`notes: ${version.notes}`] : []),
    ];
  }
  if (isTemplate(version)) {
    return [
      version.name,
      ...version.exercises.map(
        (e) => `${names.get(e.exercise_id) ?? e.exercise_id}: ${e.prescribed.length} sets`,
      ),
    ];
  }
  return Object.entries(version).map(([column, value]) => `${column}: ${value || '—'}`);
}

/** A session has exercises and a start; a template has exercises only; a table row neither. */
function isSession(v: Session | Template | TableRow): v is Session {
  return 'exercises' in v && 'started_at' in v;
}

function isTemplate(v: Session | Template | TableRow): v is Template {
  return 'exercises' in v && !('started_at' in v);
}

/** Names by id, for showing exercises in a conflict. */
export function exerciseNames(library: Exercise[]): Map<string, string> {
  return new Map(library.map((e) => [e.id, e.name]));
}
