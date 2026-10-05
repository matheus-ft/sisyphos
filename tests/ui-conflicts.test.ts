import { describe, expect, it } from 'vitest';
import type { ConflictRecord, Session } from '../src/model';
import { describeConflict } from '../src/ui/conflicts';

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
      rest_s: null,
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
