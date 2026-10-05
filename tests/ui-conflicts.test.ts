import { describe, expect, it } from 'vitest';
import type { ConflictRecord, Session } from '../src/model';
import { describeConflict, diffLines } from '../src/ui/conflicts';

const names = new Map([['low_bar_squat', 'Low-Bar Squat']]);

const session = (rpe: number): Session => ({
  id: '2026-10-04-k3f9',
  date: '2026-10-04',
  started_at: '2026-10-04T17:30:00.000Z',
  tz: 'Europe/Lisbon',
  time_precision: 'instant',
  ended_at: null,
  label: { name: null, block: null, week: null, day: null, weekday: null },
  bodyweight_kg: null,
  notes: null,
  exercises: [
    {
      id: 'e1',
      exercise_id: 'low_bar_squat',
      prescribed: [],
      performed: [
        {
          id: 's1',
          prescribed_id: null,
          state: 'done',
          reps: 5,
          rpe,
          load: { kind: 'weight', value: 140, unit: 'kg' },
          is_warmup: false,
          notes: null,
        },
      ],
      notes: null,
    },
  ],
  created_at: '2026-10-04T17:30:00.000Z',
  updated_at: '2026-10-04T17:30:00.000Z',
  device_id: 'phone',
});

const record = (over: Partial<ConflictRecord>): ConflictRecord => ({
  id: '2026-10-04-c0n1',
  path: 'sessions/2026/2026-10-04-k3f9.json',
  key: null,
  found_at: '2026-10-04T18:00:00.000Z',
  device_id: 'phone',
  version: session(8.5),
  ...over,
});

describe('a conflict, as the sync screen shows it', () => {
  it('sets a session beside the saved one, set by set', () => {
    const view = describeConflict(record({}), session(8), names);
    expect(view.what).toBe('session 2026-10-04-k3f9');
    expect(view.current).toEqual(['2026-10-04', 'Low-Bar Squat: 140 × 5 @ 8']);
    expect(view.saved).toEqual(['2026-10-04', 'Low-Bar Squat: 140 × 5 @ 8.5']);
  });

  it('shows a version that was deleted as deleted', () => {
    expect(describeConflict(record({}), null, names).current).toEqual(['deleted']);
  });

  it('shows a table row by its key and its cells', () => {
    const view = describeConflict(
      record({
        path: 'lifter/bodyweight.csv',
        key: { date: '2026-10-04' },
        version: { date: '2026-10-04', weight_kg: '82.5', source: 'manual' },
      }),
      { date: '2026-10-04', weight_kg: '83', source: 'manual' },
      names,
    );
    expect(view.what).toBe('bodyweight: 2026-10-04');
    expect(view.current).toContain('weight_kg: 83');
    expect(view.saved).toContain('weight_kg: 82.5');
  });
});

describe('the lines of two versions, side by side', () => {
  const same = (line: string) => ({ current: line, saved: line, same: true });

  it('matches identical versions line for line', () => {
    expect(diffLines(['a', 'b'], ['a', 'b'])).toEqual([same('a'), same('b')]);
  });

  it('faces two different lines in the same place', () => {
    expect(diffLines(['date', 'squat: 8'], ['date', 'squat: 8.5'])).toEqual([
      same('date'),
      { current: 'squat: 8', saved: 'squat: 8.5', same: false },
    ]);
  });

  it('does not mark every later line changed when one is inserted', () => {
    const rows = diffLines(['date', 'squat', 'bench'], ['date', 'squat', 'row', 'bench']);
    expect(rows).toEqual([
      same('date'),
      same('squat'),
      { current: null, saved: 'row', same: false },
      same('bench'),
    ]);
  });

  it('leaves the other side empty for a line only one has', () => {
    expect(diffLines(['a', 'b', 'c'], ['a', 'c'])).toEqual([
      same('a'),
      { current: 'b', saved: null, same: false },
      same('c'),
    ]);
  });

  it('pairs what is left over in order when a run differs', () => {
    expect(diffLines(['a', 'x1', 'x2', 'x3', 'z'], ['a', 'y1', 'z'])).toEqual([
      same('a'),
      { current: 'x1', saved: 'y1', same: false },
      { current: 'x2', saved: null, same: false },
      { current: 'x3', saved: null, same: false },
      same('z'),
    ]);
  });

  it('handles repeated lines and empty sides', () => {
    expect(diffLines(['a', 'a', 'b'], ['a', 'b'])).toEqual([
      same('a'),
      { current: 'a', saved: null, same: false },
      same('b'),
    ]);
    expect(diffLines([], [])).toEqual([]);
    expect(diffLines(['deleted'], [])).toEqual([{ current: 'deleted', saved: null, same: false }]);
    expect(diffLines([], ['a'])).toEqual([{ current: null, saved: 'a', same: false }]);
  });

  it('keeps every line of both sides, in order', () => {
    const current = ['a', 'b', 'c', 'd', 'e'];
    const saved = ['a', 'x', 'c', 'y', 'z', 'e'];
    const rows = diffLines(current, saved);
    expect(rows.flatMap((r) => (r.current === null ? [] : [r.current]))).toEqual(current);
    expect(rows.flatMap((r) => (r.saved === null ? [] : [r.saved]))).toEqual(saved);
  });

  it('comes with a conflict, so the screen can highlight what differs', () => {
    const view = describeConflict(record({}), session(8), names);
    expect(view.diff).toEqual([
      same('2026-10-04'),
      { current: 'Low-Bar Squat: 140 × 5 @ 8', saved: 'Low-Bar Squat: 140 × 5 @ 8.5', same: false },
    ]);
  });

  it('shows a deletion as every line of the other version changed', () => {
    const view = describeConflict(record({ version: null }), session(8), names);
    expect(view.diff.every((r) => !r.same)).toBe(true);
    expect(view.diff[0].saved).toBe('deleted');
  });
});
