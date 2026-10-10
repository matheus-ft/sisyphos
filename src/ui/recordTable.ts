import { RECORD_MAX_REPS } from '../metrics/definitions';
import { recordAt } from '../metrics/records';
import type { Exercise, Id, IsoDate, ManualRecord, PersonalRecord } from '../model';
import { dateInYear, formatKg, liftTabs } from './athloi';
import { kgText, MAX_RANGE, parseKg, validDate } from './lifter';

/**
 * Agora's Records page: the best weight at each rep count from 1 to 10 for
 * the lifts that keep a record book, as a table (rows are rep counts, columns
 * the lifts). Each cell is the effective best, what the sessions set and what
 * was entered by hand together (`recordBook`); tapping it edits the cell's
 * hand-entered value, which is the only part of it that is entered at all.
 */

/** A column: a lift that keeps a record book, by its short head. */
export interface RecordColumn {
  exerciseId: string;
  /** "Squat", "Bench", "Sumo", "Conv.". */
  label: string;
  name: string;
}

export interface TableCell {
  exerciseId: string;
  reps: number;
  /** The effective best here; null when nothing has been lifted or entered at this rep count. */
  best: {
    weight: string;
    /** "12 Mar", with the year once it is not this one. */
    date: string;
    /** Set for a logged record: the date links to the session. Null for one entered by hand. */
    sessionId: Id | null;
  } | null;
  /** The cell's hand-entered value, shown or not: what a tap edits. */
  hand: ManualRecord | null;
}

export interface RecordTable {
  columns: RecordColumn[];
  rows: { reps: number; cells: TableCell[] }[];
}

/**
 * The cell's hand-entered value: of several entered for one rep count on
 * different days, the heaviest, the earlier on a tie, which is the one the
 * record book would show.
 */
export function handRecord(
  manual: readonly ManualRecord[],
  exerciseId: string,
  reps: number,
): ManualRecord | null {
  return manual
    .filter((m) => m.exercise_id === exerciseId && m.reps === reps)
    .reduce<ManualRecord | null>(
      (best, m) =>
        !best ||
        m.weight_kg > best.weight_kg ||
        (m.weight_kg === best.weight_kg && m.date < best.date)
          ? m
          : best,
      null,
    );
}

export function recordTable(
  book: readonly PersonalRecord[],
  manual: readonly ManualRecord[],
  library: readonly Exercise[],
  today: IsoDate,
): RecordTable {
  const tabs = liftTabs(library, () => null);
  return {
    columns: tabs.map((t) => ({
      exerciseId: t.exercise.id,
      label: t.label,
      name: t.exercise.name,
    })),
    rows: Array.from({ length: RECORD_MAX_REPS }, (_, i) => {
      const reps = i + 1;
      return {
        reps,
        cells: tabs.map((t): TableCell => {
          const record = recordAt(book, t.exercise.id, reps);
          return {
            exerciseId: t.exercise.id,
            reps,
            best: record && {
              weight: formatKg(record.weight_kg),
              date: dateInYear(record.date, today),
              sessionId: record.source === 'session' ? record.session_id : null,
            },
            hand: handRecord(manual, t.exercise.id, reps),
          };
        }),
      };
    }),
  };
}

/** "Squat, 3 reps". */
export function cellName(cell: TableCell, columns: readonly RecordColumn[]): string {
  const lift = columns.find((c) => c.exerciseId === cell.exerciseId)?.name ?? cell.exerciseId;
  return `${lift}, ${cell.reps} ${cell.reps === 1 ? 'rep' : 'reps'}`;
}

/** What the inline editor holds: the hand-entered value, or today and nothing. */
export interface CellForm {
  kg: string;
  date: string;
}

export function cellForm(cell: TableCell, today: IsoDate): CellForm {
  return cell.hand
    ? { kg: kgText(cell.hand.weight_kg), date: cell.hand.date }
    : { kg: '', date: today };
}

/** Why the cell cannot be saved, or null. */
export function cellProblem(form: CellForm, today: IsoDate): string | null {
  if (parseKg(form.kg, MAX_RANGE) === null)
    return `Enter the weight in kilograms, between ${MAX_RANGE.min} and ${MAX_RANGE.max}.`;
  if (!validDate(form.date, today)) return 'Pick a date that is not in the future.';
  return null;
}

/** What saving or clearing a cell writes: the row to put and the row to drop, either may be none. */
export interface CellEdit {
  put: ManualRecord | null;
  drop: ManualRecord | null;
}

/**
 * The edit a cell's form makes, or clearing it (`form` null). The weight and
 * the date are the cell's own; an RPE or a note the row had stays with it. A
 * row is keyed by its date, so moving the date puts the new row and drops the
 * old one. Call only once `cellProblem` is null.
 */
export function cellEdit(cell: TableCell, form: CellForm | null): CellEdit {
  if (form === null) return { put: null, drop: cell.hand };
  const kg = parseKg(form.kg, MAX_RANGE);
  if (kg === null) throw new Error('cellEdit needs a valid form');
  const put: ManualRecord = {
    source: 'manual',
    exercise_id: cell.exerciseId,
    reps: cell.reps,
    weight_kg: kg,
    date: form.date,
    rpe: cell.hand?.rpe ?? null,
    context: cell.hand?.context ?? null,
  };
  return { put, drop: cell.hand && cell.hand.date !== form.date ? cell.hand : null };
}

/** True when the hand-entered value is lighter than what is shown, so it is kept but not visible. */
export function handHidden(cell: TableCell): boolean {
  return (
    cell.hand !== null && cell.best !== null && cell.best.weight !== formatKg(cell.hand.weight_kg)
  );
}
