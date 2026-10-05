import { describe, expect, it } from 'vitest';
import { loadFactor } from '../src/metrics/rpe-chart';
import { bestSetOf, historyWeeks, monthGrid, shiftMonth } from '../src/ui/history';
import { byId, library, sessionOf, squat } from './analysis-fixtures';

const plank = byId('plank');
const bench = byId('bench');

const squatDay = (date: string, load = 140, extra = {}) =>
  sessionOf({ date, work: [[squat, [{ load, reps: 5, rpe: 8 }]]], ...extra });

describe('sessions by week', () => {
  const sessions = [
    squatDay('2026-09-21'),
    squatDay('2026-10-02'),
    squatDay('2026-09-29'),
    squatDay('2026-09-29', 100, { hour: 7 }),
  ];

  it('groups by week, newest first, labelling each by its Monday', () => {
    const weeks = historyWeeks(sessions, library);
    expect(weeks.map((w) => [w.start, w.label])).toEqual([
      ['2026-09-28', 'Week of 28 September'],
      ['2026-09-21', 'Week of 21 September'],
    ]);
  });

  it('lists a week newest first, the later session of a day before the earlier', () => {
    const [week] = historyWeeks(sessions, library);
    expect(week.rows.map((r) => r.session.date)).toEqual([
      '2026-10-02',
      '2026-09-29',
      '2026-09-29',
    ]);
    expect(week.rows[1].session.started_at! > week.rows[2].session.started_at!).toBe(true);
  });

  it('counts sessions and done working sets in each week', () => {
    const [week, older] = historyWeeks(sessions, library);
    expect(week.counts).toEqual({ sessions: 3, planned: 0, sets: 3, pending: 0 });
    expect(older.counts.sessions).toBe(1);
  });

  it('puts a week that straddles a year end in one group', () => {
    const weeks = historyWeeks([squatDay('2026-12-30'), squatDay('2027-01-02')], library);
    expect(weeks).toHaveLength(1);
    expect(weeks[0].label).toBe('Week of 28 December');
  });

  it('marks a session still holding pending sets', () => {
    const pending = sessionOf({
      date: '2026-09-29',
      work: [[squat, [{ load: 140, reps: 5, rpe: 8 }, { load: 140, reps: 5 }, {}]]],
    });
    const [week] = historyWeeks([pending, squatDay('2026-09-30')], library);
    const rows = Object.fromEntries(week.rows.map((r) => [r.session.date, r.pendingSets]));
    expect(rows).toEqual({ '2026-09-29': 2, '2026-09-30': 0 });
    expect(week.counts.pending).toBe(1);
  });

  it('does not count skipped sets as pending, or warm-ups as sets', () => {
    const s = sessionOf({
      date: '2026-09-29',
      work: [
        [
          squat,
          [
            { load: 60, reps: 5, warmup: true },
            { load: 140, reps: 5, rpe: 8 },
            { load: 140, reps: 5, rpe: 8, skip: true },
          ],
        ],
      ],
    });
    const [week] = historyWeeks([s], library);
    expect(week.rows[0].pendingSets).toBe(0);
    expect(week.counts.sets).toBe(1);
  });

  it('marks a session planned ahead, and counts it', () => {
    const plan = sessionOf({ date: '2026-10-06', planned: true, work: [[squat, [{}]]] });
    const [week] = historyWeeks([plan], library);
    expect(week.rows[0].planned).toBe(true);
    expect(week.counts).toMatchObject({ sessions: 1, planned: 1, pending: 1, sets: 0 });
  });

  it('is empty with no sessions', () => {
    expect(historyWeeks([], library)).toEqual([]);
  });
});

describe('filtered by an exercise', () => {
  const sessions = [
    sessionOf({
      date: '2026-09-29',
      work: [
        [
          squat,
          [
            { load: 100, reps: 5, rpe: 8 },
            { load: 140, reps: 3, rpe: 8 },
          ],
        ],
        [bench, [{ load: 90, reps: 5, rpe: 8 }]],
      ],
    }),
    sessionOf({ date: '2026-09-22', work: [[bench, [{ load: 90, reps: 5, rpe: 8 }]]] }),
  ];

  it('lists only the sessions that hold it', () => {
    const weeks = historyWeeks(sessions, library, { exerciseId: 'low_bar_squat' });
    expect(weeks).toHaveLength(1);
    expect(weeks[0].rows).toHaveLength(1);
  });

  it('shows its best set and e1RM on each row', () => {
    const [week] = historyWeeks(sessions, library, { exerciseId: 'low_bar_squat' });
    const best = week.rows[0].best!;
    expect(best.text).toBe('140 × 3 @ 8');
    expect(best.e1rm).toBeCloseTo(140 / loadFactor(8, 3)!, 6);
  });

  it('counts the filtered exercise sets only', () => {
    const [week] = historyWeeks(sessions, library, { exerciseId: 'low_bar_squat' });
    expect(week.counts.sets).toBe(2);
  });

  it('has no best set without a filter', () => {
    expect(historyWeeks(sessions, library)[0].rows[0].best).toBeNull();
  });

  it('has a row with no best set when the exercise has no done set', () => {
    const plan = sessionOf({ date: '2026-10-06', planned: true, work: [[squat, [{}]]] });
    const [week] = historyWeeks([plan], library, { exerciseId: 'low_bar_squat' });
    expect(week.rows[0].best).toBeNull();
  });
});

describe('the best set of a session', () => {
  it('is the one with the highest e1RM, which is not always the heaviest', () => {
    const s = sessionOf({
      date: '2026-09-29',
      work: [
        [
          squat,
          [
            { load: 140, reps: 5, rpe: 7 },
            { load: 130, reps: 3, rpe: 10 },
          ],
        ],
      ],
    });
    const e = (kg: number, rpe: number, reps: number) => kg / loadFactor(rpe, reps)!;
    expect(e(140, 7, 5)).toBeGreaterThan(e(130, 10, 3));
    expect(bestSetOf(s, squat)!.text).toBe('140 × 5 @ 7');
  });

  it('prefers a set the estimate can price over a heavier one it cannot', () => {
    const s = sessionOf({
      date: '2026-09-29',
      work: [
        [
          squat,
          [
            { load: 100, reps: 15, rpe: 8 },
            { load: 60, reps: 5, rpe: 8 },
          ],
        ],
      ],
    });
    expect(bestSetOf(s, squat)!.text).toBe('60 × 5 @ 8');
  });

  it('prices a bodyweight-plus set with the weigh-in when the session holds no bodyweight', () => {
    const dips = byId('dips');
    const s = sessionOf({ date: '2026-09-29', work: [[dips, [{ load: 10, reps: 8, rpe: 8 }]]] });
    expect(bestSetOf(s, dips)!.e1rm).toBeNull();
    const priced = bestSetOf(s, dips, () => 84)!.e1rm;
    expect(priced).toBeGreaterThan(94);
    expect(bestSetOf({ ...s, bodyweight_kg: 80 }, dips, () => 84)!.e1rm).toBeLessThan(priced!);
  });

  it('falls back to the heaviest, then the most reps, where nothing has an e1RM', () => {
    const pins = byId('adductor_machine');
    const s = sessionOf({
      date: '2026-09-29',
      work: [
        [
          pins,
          [
            { load: 8, unit: 'pins', reps: 12, rpe: 8 },
            { load: 9, unit: 'pins', reps: 10, rpe: 8 },
            { load: 9, unit: 'pins', reps: 11, rpe: 8 },
          ],
        ],
      ],
    });
    const best = bestSetOf(s, pins)!;
    expect(best.text).toBe('9 pins × 11 @ 8');
    expect(best.e1rm).toBeNull();
  });

  it('is the longest hold for a timed exercise', () => {
    const s = sessionOf({
      date: '2026-09-29',
      work: [[plank, [{ load: 45 }, { load: 75 }, { load: 60 }]]],
    });
    expect(bestSetOf(s, plank)!.text).toBe('1:15');
  });

  it('ignores warm-ups and sets not done', () => {
    const s = sessionOf({
      date: '2026-09-29',
      work: [
        [
          squat,
          [
            { load: 60, reps: 5, warmup: true },
            { load: 200, reps: 5 },
          ],
        ],
      ],
    });
    expect(bestSetOf(s, squat)).toBeNull();
  });
});

describe('the month calendar', () => {
  const today = '2026-10-04';

  it('lays a month in whole weeks, Monday first, with the days around it', () => {
    const month = monthGrid(2026, 10, [], { today });
    expect(month.title).toBe('October 2026');
    // 1 October 2026 is a Thursday and 31 October a Saturday.
    expect(month.weeks).toHaveLength(5);
    expect(month.weeks.every((w) => w.length === 7)).toBe(true);
    expect(month.weeks[0][0]).toMatchObject({ date: '2026-09-28', day: 28, inMonth: false });
    expect(month.weeks[0][3]).toMatchObject({ date: '2026-10-01', day: 1, inMonth: true });
    expect(month.weeks[4][6]).toMatchObject({ date: '2026-11-01', day: 1, inMonth: false });
    expect(month.weeks[4][5]).toMatchObject({ date: '2026-10-31', inMonth: true });
  });

  it('is exactly four weeks for a February that starts on a Monday', () => {
    const month = monthGrid(2027, 2, [], { today });
    expect(month.weeks).toHaveLength(4);
    expect(month.weeks.flat().every((d) => d.inMonth)).toBe(true);
  });

  it('can need six weeks', () => {
    // 1 August 2026 is a Saturday, and the month has 31 days.
    expect(monthGrid(2026, 8, [], { today }).weeks).toHaveLength(6);
  });

  it('marks today', () => {
    const days = monthGrid(2026, 10, [], { today }).weeks.flat();
    expect(days.filter((d) => d.today).map((d) => d.date)).toEqual(['2026-10-04']);
  });

  it('shows sessions that happened apart from those planned', () => {
    const a = squatDay('2026-10-02');
    const b = squatDay('2026-10-02', 100, { hour: 8 });
    const plan = sessionOf({ date: '2026-10-06', planned: true, work: [] });
    const days = monthGrid(2026, 10, [a, b, plan], { today }).weeks.flat();
    const at = (date: string) => days.find((d) => d.date === date)!;
    // Earlier session first, as they happened.
    expect(at('2026-10-02').sessions).toEqual([b.id, a.id]);
    expect(at('2026-10-02').planned).toEqual([]);
    expect(at('2026-10-06').sessions).toEqual([]);
    expect(at('2026-10-06').planned).toEqual([plan.id]);
    expect(at('2026-10-03')).toMatchObject({ sessions: [], planned: [], record: false });
  });

  it('shows sessions on the days around the month too', () => {
    const s = squatDay('2026-09-29');
    const first = monthGrid(2026, 10, [s], { today }).weeks[0][1];
    expect(first.sessions).toEqual([s.id]);
    expect(first.inMonth).toBe(false);
  });

  it('marks record days from the dates given', () => {
    const days = monthGrid(2026, 10, [], {
      today,
      recordDays: new Set(['2026-10-02']),
    }).weeks.flat();
    expect(days.filter((d) => d.record).map((d) => d.date)).toEqual(['2026-10-02']);
  });

  it('moves between months across year ends', () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth({ year: 2026, month: 10 }, -13)).toEqual({ year: 2025, month: 9 });
  });
});
