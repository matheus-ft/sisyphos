import { describe, expect, it } from 'vitest';
import type { ManualRecord } from '../src/model';
import { recordBook } from '../src/metrics/records';
import {
  cellEdit,
  cellForm,
  cellName,
  cellProblem,
  handHidden,
  handRecord,
  recordTable,
  type TableCell,
} from '../src/ui/recordTable';
import { byId, library, sessionOf } from './analysis-fixtures';

const today = '2026-10-04';
const hand = (over: Partial<ManualRecord> = {}): ManualRecord => ({
  source: 'manual',
  exercise_id: 'low_bar_squat',
  reps: 1,
  weight_kg: 155,
  date: '2026-03-14',
  rpe: 9.5,
  context: 'Gym mock meet',
  ...over,
});

const squat = byId('low_bar_squat');
const logged = sessionOf({
  date: '2026-10-02',
  work: [[squat, [{ load: 150, reps: 3, rpe: 8 }]]],
});

function tableOf(manual: ManualRecord[]) {
  return recordTable(recordBook([logged], library, manual), manual, library, today);
}

const cellAt = (table: ReturnType<typeof tableOf>, reps: number, exerciseId: string): TableCell =>
  table.rows[reps - 1].cells.find((c) => c.exerciseId === exerciseId)!;

describe('the records table', () => {
  it('has the four record lifts for columns, under short heads, and rows for 1 to 10 reps', () => {
    const table = tableOf([]);
    expect(table.columns.map((c) => c.label)).toEqual(['Squat', 'Bench', 'Sumo', 'Conv.']);
    expect(table.columns.map((c) => c.exerciseId)).toEqual([
      'low_bar_squat',
      'bench',
      'sumo_deadlift',
      'conventional_deadlift',
    ]);
    expect(table.rows.map((r) => r.reps)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const row of table.rows) expect(row.cells).toHaveLength(4);
  });

  it('is empty where nothing was lifted or entered', () => {
    const table = tableOf([]);
    expect(cellAt(table, 1, 'bench')).toMatchObject({ best: null, hand: null });
  });

  it('shows a logged best, linking to the session that set it', () => {
    const cell = cellAt(tableOf([]), 3, 'low_bar_squat');
    expect(cell.best).toEqual({ weight: '150', date: '2 Oct', sessionId: logged.id });
    expect(cell.hand).toBeNull();
  });

  it('shows a hand-entered best with no session, dated with its year when it is not this one', () => {
    const cell = cellAt(tableOf([hand({ date: '2025-03-14' })]), 1, 'low_bar_squat');
    expect(cell.best).toEqual({ weight: '155', date: '14 Mar 2025', sessionId: null });
    expect(cell.hand).toEqual(hand({ date: '2025-03-14' }));
  });

  it('shows the heavier of a logged and a hand-entered value, and keeps the hand one to edit', () => {
    const lighter = cellAt(tableOf([hand({ reps: 3, weight_kg: 140 })]), 3, 'low_bar_squat');
    expect(lighter.best?.weight).toBe('150');
    expect(lighter.best?.sessionId).toBe(logged.id);
    expect(lighter.hand?.weight_kg).toBe(140);
    expect(handHidden(lighter)).toBe(true);

    const heavier = cellAt(tableOf([hand({ reps: 3, weight_kg: 160 })]), 3, 'low_bar_squat');
    expect(heavier.best).toMatchObject({ weight: '160', sessionId: null });
    expect(handHidden(heavier)).toBe(false);
  });

  it('follows the sessions: a logged value updates itself', () => {
    const heavier = sessionOf({
      date: '2026-10-03',
      work: [[squat, [{ load: 155, reps: 3, rpe: 8 }]]],
    });
    const manual: ManualRecord[] = [];
    const table = recordTable(
      recordBook([logged, heavier], library, manual),
      manual,
      library,
      today,
    );
    expect(cellAt(table, 3, 'low_bar_squat').best).toMatchObject({
      weight: '155',
      sessionId: heavier.id,
    });
  });

  it('leaves out a hand-entered record of an exercise with no column', () => {
    const table = tableOf([hand({ exercise_id: 'paused_squat' })]);
    expect(table.rows.flatMap((r) => r.cells).every((c) => c.hand === null)).toBe(true);
  });

  it('names a cell for a screen reader', () => {
    const table = tableOf([]);
    expect(cellName(cellAt(table, 1, 'bench'), table.columns)).toBe('Bench Press, 1 rep');
    expect(cellName(cellAt(table, 3, 'sumo_deadlift'), table.columns)).toBe(
      'Sumo Deadlift, 3 reps',
    );
  });
});

describe('a cell’s hand-entered value', () => {
  it('is the heaviest for the rep count, the earlier on a tie', () => {
    const manual = [
      hand({ date: '2026-03-14', weight_kg: 150 }),
      hand({ date: '2026-05-01', weight_kg: 155 }),
      hand({ date: '2026-02-01', weight_kg: 155 }),
      hand({ reps: 2, weight_kg: 190 }),
      hand({ exercise_id: 'bench', weight_kg: 200 }),
    ];
    expect(handRecord(manual, 'low_bar_squat', 1)).toEqual(
      hand({ date: '2026-02-01', weight_kg: 155 }),
    );
    expect(handRecord(manual, 'low_bar_squat', 5)).toBeNull();
  });

  it('opens the form on it, or on today with nothing', () => {
    const table = tableOf([hand()]);
    expect(cellForm(cellAt(table, 1, 'low_bar_squat'), today)).toEqual({
      kg: '155',
      date: '2026-03-14',
    });
    expect(cellForm(cellAt(table, 2, 'low_bar_squat'), today)).toEqual({ kg: '', date: today });
  });

  it('says what is wrong with a weight or a date', () => {
    expect(cellProblem({ kg: '155', date: '2026-03-14' }, today)).toBeNull();
    expect(cellProblem({ kg: '', date: '2026-03-14' }, today)).toMatch(/between 20 and 700/);
    expect(cellProblem({ kg: '12', date: '2026-03-14' }, today)).toMatch(/between 20 and 700/);
    expect(cellProblem({ kg: '155', date: '2026-12-01' }, today)).toMatch(/future/);
    expect(cellProblem({ kg: '155', date: '' }, today)).toMatch(/date/);
    expect(cellProblem({ kg: '20', date: today }, today)).toBeNull();
  });
});

describe('editing a cell', () => {
  const entered = cellAt(tableOf([hand()]), 1, 'low_bar_squat');
  const blank = cellAt(tableOf([]), 2, 'low_bar_squat');

  it('puts a new record for an empty cell, and drops nothing', () => {
    expect(cellEdit(blank, { kg: '147,5', date: '2026-09-01' })).toEqual({
      put: hand({
        reps: 2,
        weight_kg: 147.5,
        date: '2026-09-01',
        rpe: null,
        context: null,
      }),
      drop: null,
    });
  });

  it('changes a weight in place, keeping the RPE and the note the row had', () => {
    expect(cellEdit(entered, { kg: '160', date: '2026-03-14' })).toEqual({
      put: hand({ weight_kg: 160 }),
      drop: null,
    });
  });

  it('moves a record to another date by putting it there and dropping the old row', () => {
    expect(cellEdit(entered, { kg: '155', date: '2026-04-01' })).toEqual({
      put: hand({ date: '2026-04-01' }),
      drop: hand(),
    });
  });

  it('clears the hand-entered value, and only that', () => {
    expect(cellEdit(entered, null)).toEqual({ put: null, drop: hand() });
    expect(cellEdit(blank, null)).toEqual({ put: null, drop: null });
  });

  it('can be for a cell whose shown value is logged, and does not touch the log', () => {
    const over = cellAt(tableOf([]), 3, 'low_bar_squat');
    expect(over.best?.sessionId).toBe(logged.id);
    expect(cellEdit(over, { kg: '160', date: today }).put).toMatchObject({
      reps: 3,
      weight_kg: 160,
      date: today,
    });
  });

  it('refuses a form that was not checked', () => {
    expect(() => cellEdit(blank, { kg: 'heavy', date: today })).toThrow();
  });
});
