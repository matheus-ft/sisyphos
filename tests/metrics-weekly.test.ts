import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysBetween,
  daysInMonth,
  dayAndMonth,
  weekdayIndex,
  weekStart,
} from '../src/metrics/dates';
import { muscleWeights } from '../src/metrics/definitions';
import {
  setsBehindMuscle,
  shadeLevel,
  weeklyVolume,
  windowBounds,
  type VolumeWindow,
} from '../src/metrics/weekly';
import { bench, byId, library, muscles, sessionOf, squat } from './analysis-fixtures';

// 2026-10-04 is a Sunday, the last day of the week that began on Monday 28 September.
const today = '2026-10-04';

const working = (n: number, load = 100) =>
  Array.from({ length: n }, () => ({ load, reps: 5, rpe: 8 }));

describe('dates', () => {
  it('cuts weeks on Monday', () => {
    expect(weekdayIndex('2026-09-28')).toBe(0);
    expect(weekdayIndex('2026-10-04')).toBe(6);
    expect(weekStart('2026-10-04')).toBe('2026-09-28');
    expect(weekStart('2026-09-28')).toBe('2026-09-28');
    expect(weekStart('2026-10-05')).toBe('2026-10-05');
  });

  it('crosses month and year ends', () => {
    expect(weekStart('2027-01-01')).toBe('2026-12-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-09-28', '2026-10-04')).toBe(6);
    expect(daysBetween('2026-10-04', '2026-09-28')).toBe(-6);
  });

  it('is not moved by a daylight-saving change', () => {
    // Clocks went forward in Europe on 2026-03-29 and back on 2026-10-25.
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
  });

  it('moves by months, clamping to the last day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-01-15', -2)).toBe('2025-11-15');
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
  });

  it('writes a day and month', () => {
    expect(dayAndMonth('2026-09-28')).toBe('28 September');
    expect(dayAndMonth('2026-10-04')).toBe('4 October');
  });
});

describe('the windows', () => {
  it('is this week, Monday to Sunday', () => {
    expect(windowBounds('this_week', '2026-10-01')).toEqual({
      from: '2026-09-28',
      to: '2026-10-04',
    });
  });

  it('is the 28 days ending today for the last four weeks', () => {
    expect(windowBounds('last_4_weeks', today)).toEqual({ from: '2026-09-07', to: today });
    expect(daysBetween('2026-09-07', today)).toBe(27);
  });
});

describe('shading', () => {
  it.each([
    [0, 0],
    [0.5, 1],
    [4, 1],
    [4.5, 1],
    [5, 2],
    [9.5, 2],
    [10, 3],
    [14.5, 3],
    [15, 4],
    [30, 4],
  ])('puts %s weighted sets in a week at level %s', (sets, level) => {
    expect(shadeLevel(sets)).toBe(level);
  });

  it('divides four weeks by four, so a shade means the same weekly dose', () => {
    expect(shadeLevel(19, 4)).toBe(1);
    expect(shadeLevel(20, 4)).toBe(2);
    expect(shadeLevel(40, 4)).toBe(3);
    expect(shadeLevel(60, 4)).toBe(4);
    expect(shadeLevel(0, 4)).toBe(0);
  });
});

describe('weekly volume per muscle', () => {
  const volume = (
    sessions: ReturnType<typeof sessionOf>[],
    window: VolumeWindow = 'this_week',
    weights = muscleWeights(),
  ) => {
    const rows = weeklyVolume(sessions, library, muscles, window, today, weights);
    return new Map(rows.map((r) => [r.muscle.id, r]));
  };

  it('counts primary muscles in full and aux at the active preset', () => {
    const rows = volume([sessionOf({ date: '2026-09-29', work: [[squat, working(4)]] })]);
    expect(rows.get('quads')).toMatchObject({ sets: 4, level: 1 });
    // Aux counts half under the shipped preset.
    expect(rows.get('glutes')!.sets).toBe(2);
  });

  it('counts aux per the preset given', () => {
    const sessions = [sessionOf({ date: '2026-09-29', work: [[squat, working(4)]] })];
    expect(volume(sessions, 'this_week', { primary: 1, aux: 0 }).get('glutes')!.sets).toBe(0);
    expect(volume(sessions, 'this_week', { primary: 1, aux: 1 }).get('glutes')!.sets).toBe(4);
  });

  it('lists every muscle, most worked first, the rested ones at level 0', () => {
    const rows = weeklyVolume(
      [sessionOf({ date: '2026-09-29', work: [[bench, working(5)]] })],
      library,
      muscles,
      'this_week',
      today,
    );
    expect(rows).toHaveLength(muscles.length);
    expect(rows[0].muscle.id).toBe('pecs');
    expect(rows[0]).toMatchObject({ sets: 5, level: 2 });
    expect(rows.at(-1)).toMatchObject({ sets: 0, level: 0 });
  });

  it('keeps the library order among equals', () => {
    const rows = weeklyVolume([], library, muscles, 'this_week', today);
    expect(rows.map((r) => r.muscle.id)).toEqual(muscles.map((m) => m.id));
  });

  it('counts a week from Monday to Sunday and no further', () => {
    const rows = volume([
      sessionOf({ date: '2026-09-27', work: [[bench, working(3)]] }),
      sessionOf({ date: '2026-09-28', work: [[bench, working(2)]] }),
      sessionOf({ date: '2026-10-04', work: [[bench, working(1)]] }),
    ]);
    expect(rows.get('pecs')!.sets).toBe(3);
  });

  it('counts the last four weeks as 28 days ending today', () => {
    const rows = volume(
      [
        sessionOf({ date: '2026-09-06', work: [[bench, working(7)]] }),
        sessionOf({ date: '2026-09-07', work: [[bench, working(10)]] }),
        sessionOf({ date: '2026-10-01', work: [[bench, working(10)]] }),
      ],
      'last_4_weeks',
    );
    expect(rows.get('pecs')).toMatchObject({ sets: 20, level: 2 });
  });

  it('shades the four weeks by the weekly average', () => {
    const rows = volume(
      [sessionOf({ date: '2026-09-20', work: [[bench, working(19)]] })],
      'last_4_weeks',
    );
    expect(rows.get('pecs')).toMatchObject({ sets: 19, level: 1 });
  });

  it('leaves out warm-ups, pending sets and sets of exercises the library lacks', () => {
    const s = sessionOf({
      date: '2026-09-29',
      work: [[bench, [{ load: 40, reps: 5, warmup: true }, { load: 100, reps: 5 }, ...working(1)]]],
    });
    const ghost = { ...s, exercises: [{ ...s.exercises[0], exercise_id: 'gone' }] };
    expect(volume([s]).get('pecs')!.sets).toBe(1);
    expect(volume([ghost]).get('pecs')!.sets).toBe(0);
  });

  it('counts a set of a unilateral exercise once', () => {
    const split = byId('bulgarian_split_squat');
    const rows = volume([sessionOf({ date: '2026-09-29', work: [[split, working(3)]] })]);
    expect(rows.get('quads')!.sets).toBe(3);
  });
});

describe('the sets behind a muscle', () => {
  const sessions = [
    sessionOf({ date: '2026-09-29', work: [[squat, working(2)]] }),
    sessionOf({
      date: '2026-10-02',
      work: [
        [squat, working(1)],
        [bench, working(3)],
      ],
    }),
    sessionOf({ date: '2026-09-20', work: [[squat, working(5)]] }),
  ];

  it('lists them newest first with what each added', () => {
    const behind = setsBehindMuscle(sessions, library, 'glutes', 'this_week', today);
    expect(behind.map((b) => [b.date, b.counted])).toEqual([
      ['2026-10-02', 0.5],
      ['2026-09-29', 0.5],
      ['2026-09-29', 0.5],
    ]);
    expect(behind[0].exercise_id).toBe('low_bar_squat');
    expect(behind[0].set.state).toBe('done');
  });

  it('adds up to the muscle number in the weekly volume', () => {
    for (const window of ['this_week', 'last_4_weeks'] as const) {
      const total = (id: string) =>
        setsBehindMuscle(sessions, library, id, window, today).reduce((n, b) => n + b.counted, 0);
      for (const row of weeklyVolume(sessions, library, muscles, window, today)) {
        expect(total(row.muscle.id)).toBeCloseTo(row.sets, 9);
      }
    }
  });

  it('keeps the sets of a day in the order lifted, and points back at the session', () => {
    const [first, second] = setsBehindMuscle([sessions[0]], library, 'quads', 'this_week', today);
    expect(first.set.id).toBe(sessions[0].exercises[0].performed[0].id);
    expect(second.set.id).toBe(sessions[0].exercises[0].performed[1].id);
    expect(first.session_id).toBe(sessions[0].id);
    expect(first.exercise_instance_id).toBe(sessions[0].exercises[0].id);
  });

  it('is empty for a muscle not worked', () => {
    expect(setsBehindMuscle(sessions, library, 'calves', 'this_week', today)).toEqual([]);
  });
});
