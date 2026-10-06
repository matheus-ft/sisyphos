import { csvLine } from '../csv';
import { toKg } from '../metrics/load';
import { compareSessions } from '../metrics/flatten';
import type { PerformedSet, Session } from '../model';
import { sessionMinutes } from './format';

/**
 * sets.csv and sessions.csv, the export DATA.md, Exports describes. Generated
 * on demand and never read back, so nothing here is a source of truth.
 *
 * Cells follow DATA.md, Serialisation, so the two tables read like the log's
 * own: an empty cell for null, a boolean as `true` or empty, numbers in
 * JavaScript's shortest form, `\n` line endings and one final newline. Rows are
 * in the order lifted rather than key-sorted, which is what a notebook wants
 * and what makes `set_n` mean something.
 */

export const SETS_COLUMNS = [
  'session_id',
  'date',
  'exercise_id',
  'set_n',
  'reps',
  'rpe',
  'load_kg',
  'is_warmup',
  'state',
] as const;

/**
 * The program label as its five `ProgramLabel` fields, one column each, so a
 * block or a week can be filtered on without parsing a cell.
 */
export const SESSIONS_COLUMNS = [
  'session_id',
  'date',
  'tz',
  'duration_min',
  'program_name',
  'program_block',
  'program_week',
  'program_day',
  'program_weekday',
  'bodyweight_kg',
  'notes',
] as const;

const cell = (n: number | null | undefined): string => (n == null ? '' : String(n));

/**
 * The load in kilograms. A pound weight is converted and rounded to the
 * centigram, as the record book is, so 225 lb reads 102.06 and not a float's
 * tail. Empty where there is no mass to give: a pin setting (a stack position,
 * not a weight), a timed set and a distance set. The doc has no column for
 * those, so their numbers are not exported; the log still holds them. A
 * bodyweight-plus set exports the load added, not the lifter's weight with it:
 * the session's `bodyweight_kg` is in sessions.csv for whoever wants the sum.
 */
function loadKg(set: PerformedSet): string {
  if (set.load?.kind !== 'weight') return '';
  const kg = toKg(set.load.value, set.load.unit);
  if (kg === null) return '';
  return cell(set.load.unit === 'kg' ? kg : Math.round(kg * 100) / 100);
}

function table(columns: readonly string[], rows: string[][]): string {
  return [columns, ...rows].map((row) => `${csvLine(row)}\n`).join('');
}

const inOrder = (sessions: readonly Session[]) => [...sessions].sort(compareSessions);

/**
 * Every set of every session, pending and skipped ones included, which is what
 * the `state` column is for. `set_n` counts from 1 across the session's
 * exercise and continues if the same exercise appears again, so
 * (session_id, exercise_id, set_n) is a key.
 */
export function setsCsv(sessions: readonly Session[]): string {
  const rows: string[][] = [];
  for (const session of inOrder(sessions)) {
    const counts = new Map<string, number>();
    for (const instance of session.exercises) {
      for (const set of instance.performed) {
        const n = (counts.get(instance.exercise_id) ?? 0) + 1;
        counts.set(instance.exercise_id, n);
        rows.push([
          session.id,
          session.date,
          instance.exercise_id,
          String(n),
          cell(set.reps),
          cell(set.rpe),
          loadKg(set),
          set.is_warmup ? 'true' : '',
          set.state,
        ]);
      }
    }
  }
  return table(SETS_COLUMNS, rows);
}

/**
 * Minutes from start to end, whole. Empty for a session that is planned or
 * still open, and for one entered after the fact (`date_only`), whose clock
 * times are not when it happened.
 */
export function durationMin(session: Session): number | null {
  // The app's one rule for a session's minutes (sessionMinutes), so the export
  // says what the screens say.
  if (session.ended_at === null || session.started_at === null) return null;
  // An end before the start is a broken record, not a zero-minute session.
  if (Date.parse(session.ended_at) < Date.parse(session.started_at)) return null;
  return sessionMinutes(session);
}

export function sessionsCsv(sessions: readonly Session[]): string {
  return table(
    SESSIONS_COLUMNS,
    inOrder(sessions).map((s) => [
      s.id,
      s.date,
      s.tz,
      cell(durationMin(s)),
      s.label.name ?? '',
      cell(s.label.block),
      cell(s.label.week),
      cell(s.label.day),
      s.label.weekday ?? '',
      cell(s.bodyweight_kg),
      s.notes ?? '',
    ]),
  );
}
