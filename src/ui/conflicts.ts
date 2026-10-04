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
  return {
    id: record.id,
    what,
    current: linesOf(current, names),
    saved: linesOf(record.version, names),
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
