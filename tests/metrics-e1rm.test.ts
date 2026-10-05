import { describe, expect, it } from 'vitest';
import { bestRecentE1rm, e1rmSeries, epley, rangeStart, setE1rm } from '../src/metrics/e1rm';
import { loadFactor } from '../src/metrics/rpe-chart';
import type { PerformedSet } from '../src/model';
import { bench, byId, deadlift, library, sessionOf, squat } from './analysis-fixtures';

const bwPlus = byId('dips');
const plank = byId('plank');

const set = (over: Partial<PerformedSet> = {}): PerformedSet => ({
  id: 's1',
  prescribed_id: null,
  state: 'done',
  reps: 5,
  rpe: 8,
  load: { kind: 'weight', value: 140, unit: 'kg' },
  is_warmup: false,
  notes: null,
  ...over,
});

describe('the e1RM of a set', () => {
  it('reads the RPE chart when the set has an RPE it covers', () => {
    expect(setE1rm(set(), squat, null)).toBeCloseTo(140 / loadFactor(8, 5)!, 6);
  });

  it('falls back to Epley without an RPE', () => {
    expect(setE1rm(set({ rpe: null }), squat, null)).toBeCloseTo(140 * (1 + 5 / 30), 6);
    expect(epley(100, 3)).toBeCloseTo(110, 6);
  });

  it('falls back to Epley when the chart does not cover the RPE and reps', () => {
    expect(loadFactor(0, 9)).toBeNull();
    expect(setE1rm(set({ rpe: 0, reps: 9 }), squat, null)).toBeCloseTo(140 * (1 + 9 / 30), 6);
  });

  it('gives Epley up to 12 reps and nothing beyond', () => {
    expect(setE1rm(set({ rpe: null, reps: 12 }), squat, null)).not.toBeNull();
    expect(setE1rm(set({ rpe: null, reps: 13 }), squat, null)).toBeNull();
    expect(setE1rm(set({ rpe: 10, reps: 13 }), squat, null)).toBeNull();
  });

  it('is nothing for a warm-up, or a set that is not done', () => {
    expect(setE1rm(set({ is_warmup: true, rpe: null }), squat, null)).toBeNull();
    expect(setE1rm(set({ state: 'pending', rpe: null }), squat, null)).toBeNull();
    expect(
      setE1rm(set({ state: 'skipped', load: null, reps: null, rpe: null }), squat, null),
    ).toBeNull();
  });

  it('is nothing for pins or a timed set, which are not a mass', () => {
    expect(
      setE1rm(set({ load: { kind: 'weight', value: 9, unit: 'pins' } }), squat, null),
    ).toBeNull();
    expect(
      setE1rm(set({ reps: null, rpe: null, load: { kind: 'time', seconds: 60 } }), plank, null),
    ).toBeNull();
  });

  it('converts pounds', () => {
    const lb = set({ load: { kind: 'weight', value: 225, unit: 'lb' } });
    expect(setE1rm(lb, squat, null)).toBeCloseTo(225 / 2.2046226218 / loadFactor(8, 5)!, 6);
  });

  it('counts a bodyweight-plus set at bodyweight plus the added load', () => {
    const dip = set({ load: { kind: 'weight', value: 20, unit: 'kg' } });
    expect(setE1rm(dip, bwPlus, 80)).toBeCloseTo(100 / loadFactor(8, 5)!, 6);
    expect(setE1rm(dip, bwPlus, null)).toBeNull();
    // Assisted work lowers the load.
    const assisted = set({ load: { kind: 'weight', value: -20, unit: 'kg' } });
    expect(setE1rm(assisted, bwPlus, 80)).toBeCloseTo(60 / loadFactor(8, 5)!, 6);
  });
});

describe('the best e1RM per day', () => {
  const day = (date: string, kg: number, rpe = 8) =>
    sessionOf({ date, work: [[squat, [{ load: kg, reps: 5, rpe }]]] });

  it('keeps one point per day, the best of its sets, oldest first', () => {
    const sessions = [
      sessionOf({
        date: '2026-09-10',
        work: [
          [
            squat,
            [
              { load: 100, reps: 5, rpe: 8 },
              { load: 120, reps: 5, rpe: 8 },
              { load: 110, reps: 5, rpe: 8 },
            ],
          ],
        ],
      }),
      day('2026-09-01', 100),
    ];
    const series = e1rmSeries(sessions, squat);
    expect(series.map((p) => p.date)).toEqual(['2026-09-01', '2026-09-10']);
    expect(series[1].e1rm).toBeCloseTo(120 / loadFactor(8, 5)!, 6);
  });

  it('points at the set behind each day', () => {
    const s = day('2026-09-01', 100);
    const [point] = e1rmSeries([s], squat);
    expect(point.session_id).toBe(s.id);
    expect(point.exercise_instance_id).toBe(s.exercises[0].id);
    expect(point.set_id).toBe(s.exercises[0].performed[0].id);
  });

  it('flags a day that beats every earlier one, and never the first', () => {
    const series = e1rmSeries(
      [
        day('2026-09-01', 100),
        day('2026-09-08', 90),
        day('2026-09-15', 110),
        day('2026-09-22', 110),
      ],
      squat,
    );
    expect(series.map((p) => p.record)).toEqual([false, false, true, false]);
  });

  it('judges records over the whole history, whatever range is shown', () => {
    const sessions = [day('2026-06-01', 150), day('2026-09-01', 100), day('2026-10-01', 110)];
    const shown = e1rmSeries(sessions, squat, { from: '2026-08-01' });
    expect(shown.map((p) => p.date)).toEqual(['2026-09-01', '2026-10-01']);
    expect(shown.map((p) => p.record)).toEqual([false, false]);
  });

  it('bounds the range inclusively', () => {
    const sessions = [day('2026-09-01', 100), day('2026-09-08', 100), day('2026-09-15', 100)];
    const shown = e1rmSeries(sessions, squat, { from: '2026-09-01', to: '2026-09-08' });
    expect(shown).toHaveLength(2);
  });

  it('leaves out other exercises and days with no estimate', () => {
    const sessions = [
      sessionOf({ date: '2026-09-01', work: [[bench, [{ load: 100, reps: 5, rpe: 8 }]]] }),
      sessionOf({ date: '2026-09-02', work: [[squat, [{ load: 100, reps: 5 }]]] }),
      sessionOf({
        date: '2026-09-03',
        work: [[squat, [{ load: 60, reps: 5, warmup: true }]]],
      }),
    ];
    expect(e1rmSeries(sessions, squat)).toEqual([]);
  });

  it('takes a bodyweight from outside for a bodyweight-plus lift with none on the session', () => {
    const dip = sessionOf({
      date: '2026-09-01',
      work: [[bwPlus, [{ load: 20, reps: 5, rpe: 8 }]]],
    });
    expect(e1rmSeries([dip], bwPlus)).toEqual([]);
    const [point] = e1rmSeries([dip], bwPlus, { bodyweightAt: () => 80 });
    expect(point.e1rm).toBeCloseTo(100 / loadFactor(8, 5)!, 6);
  });

  it('prefers the session bodyweight over the outside one', () => {
    const dip = sessionOf({
      date: '2026-09-01',
      bodyweightKg: 90,
      work: [[bwPlus, [{ load: 10, reps: 5, rpe: 8 }]]],
    });
    const [point] = e1rmSeries([dip], bwPlus, { bodyweightAt: () => 50 });
    expect(point.e1rm).toBeCloseTo(100 / loadFactor(8, 5)!, 6);
  });
});

describe('ranges', () => {
  it('counts back in calendar months from today', () => {
    expect(rangeStart('3M', '2026-10-04')).toBe('2026-07-04');
    expect(rangeStart('6M', '2026-10-04')).toBe('2026-04-04');
    expect(rangeStart('1Y', '2026-10-04')).toBe('2025-10-04');
    expect(rangeStart('all', '2026-10-04')).toBeNull();
  });

  it('lands on the last day of a shorter month', () => {
    expect(rangeStart('3M', '2026-05-31')).toBe('2026-02-28');
  });
});

describe('the best recent e1RM of a competition lift', () => {
  const today = '2026-10-04';
  const sets = (kg: number) => [{ load: kg, reps: 3, rpe: 8 }];

  it('takes the best within the last eight weeks', () => {
    const sessions = [
      sessionOf({ date: '2026-08-01', work: [[squat, sets(200)]] }),
      sessionOf({ date: '2026-09-20', work: [[squat, sets(140)]] }),
      sessionOf({ date: '2026-10-02', work: [[squat, sets(150)]] }),
    ];
    const best = bestRecentE1rm(sessions, library, 'squat', today)!;
    expect(best.date).toBe('2026-10-02');
    expect(best.exercise_id).toBe('low_bar_squat');
    expect(best.e1rm).toBeCloseTo(150 / loadFactor(8, 3)!, 6);
  });

  it('includes the first day of the window and excludes the day before it', () => {
    // Eight weeks ending 2026-10-04 start on 2026-08-10.
    const inside = sessionOf({ date: '2026-08-10', work: [[squat, sets(150)]] });
    const outside = sessionOf({ date: '2026-08-09', work: [[squat, sets(300)]] });
    expect(bestRecentE1rm([inside, outside], library, 'squat', today)!.date).toBe('2026-08-10');
    expect(bestRecentE1rm([outside], library, 'squat', today)).toBeNull();
  });

  it('ignores sessions after today', () => {
    const future = sessionOf({ date: '2026-10-05', work: [[squat, sets(150)]] });
    expect(bestRecentE1rm([future], library, 'squat', today)).toBeNull();
  });

  it('counts only comp-tier exercises of that event', () => {
    const paused = byId('paused_squat');
    const sessions = [
      sessionOf({ date: '2026-10-01', work: [[paused, sets(250)]] }),
      sessionOf({ date: '2026-10-02', work: [[bench, sets(100)]] }),
    ];
    expect(bestRecentE1rm(sessions, library, 'squat', today)).toBeNull();
  });

  it('lets either deadlift supply the deadlift', () => {
    const sumo = byId('sumo_deadlift');
    const sessions = [
      sessionOf({ date: '2026-09-28', work: [[deadlift, sets(180)]] }),
      sessionOf({ date: '2026-10-01', work: [[sumo, sets(190)]] }),
    ];
    expect(bestRecentE1rm(sessions, library, 'deadlift', today)!.exercise_id).toBe('sumo_deadlift');
  });

  it('takes a window of the given length', () => {
    const sessions = [sessionOf({ date: '2026-09-01', work: [[squat, sets(150)]] })];
    expect(bestRecentE1rm(sessions, library, 'squat', today, { weeks: 2 })).toBeNull();
    expect(bestRecentE1rm(sessions, library, 'squat', today, { weeks: 6 })).not.toBeNull();
  });
});
