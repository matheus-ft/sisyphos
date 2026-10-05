import { describe, expect, it } from 'vitest';
import type { Exercise, Session } from '../src/model';
import { recordBook } from '../src/metrics/records';
import { historyWeeks, monthGrid } from '../src/ui/history';
import {
  dayAria,
  dayTap,
  e1rmText,
  exerciseHistory,
  exerciseSets,
  exerciseSummary,
  exercisesInLog,
  filteredLead,
  matchExercises,
  recordMarks,
  weekSummary,
} from '../src/ui/history-view';
import { bench, deadlift, library, sessionOf, squat, type SetSpec } from './analysis-fixtures';

type Work = Array<[Exercise, SetSpec[]]>;
const squatSet: Work = [[squat, [{ load: 140, reps: 5, rpe: 8 }]]];
const day = (
  date: string,
  work: Work = squatSet,
  extra: { planned?: boolean; hour?: number } = {},
): Session => sessionOf({ date, work, ...extra });

describe('the exercise filter', () => {
  const sessions = [day('2026-09-29'), day('2026-09-30', [[bench, [{ load: 90, reps: 5 }]]])];

  it('offers only exercises that appear in the log, by name', () => {
    expect(exercisesInLog(sessions, library).map((e) => e.id)).toEqual([bench.id, squat.id]);
  });

  it('matches every word of the query, in any case and order', () => {
    const list = [squat, bench, deadlift];
    expect(matchExercises(list, 'SQUAT low').map((e) => e.id)).toEqual([squat.id]);
    expect(matchExercises(list, '  ')).toHaveLength(3);
    expect(matchExercises(list, 'zzz')).toEqual([]);
  });
});

describe('row and week lines', () => {
  const names = new Map(library.map((e) => [e.id, e.name]));

  it('lists the exercises in order, or says there are none', () => {
    const s = day('2026-09-29', [
      [squat, [{ load: 140, reps: 5 }]],
      [bench, [{ load: 90, reps: 5 }]],
    ]);
    expect(exerciseSummary(s, names)).toBe(`${squat.name}, ${bench.name}`);
    expect(exerciseSummary({ ...s, exercises: [] }, names)).toBe('No exercises');
  });

  it('counts the working sets of one exercise, not warm-ups or pending ones', () => {
    const s = day('2026-09-29', [
      [squat, [{ load: 60, reps: 5, warmup: true }, { load: 140, reps: 5, rpe: 8 }, {}]],
    ]);
    expect(exerciseSets(s, squat.id)).toBe(1);
    expect(exerciseSets(s, bench.id)).toBe(0);
  });

  it('summarises a week by sessions and sets, planned apart', () => {
    const [week] = historyWeeks(
      [day('2026-09-29'), day('2026-09-30'), day('2026-10-01', [[squat, [{}]]], { planned: true })],
      library,
    );
    expect(weekSummary(week, false)).toBe('2 sessions · 1 planned · 2 sets');
    const [only] = historyWeeks([day('2026-10-01', [[squat, [{}]]], { planned: true })], library);
    expect(weekSummary(only, false)).toBe('1 planned');
  });

  it('summarises a filtered week by its best e1RM', () => {
    const [week] = historyWeeks([day('2026-09-29'), day('2026-09-30')], library, {
      exerciseId: squat.id,
    });
    expect(weekSummary(week, true)).toMatch(/^best e1RM \d+$/);
    expect(filteredLead(week.rows[0], squat.id)).toBe('1 set · best');
  });

  it('falls back to a count when nothing in a filtered week can be priced', () => {
    const [week] = historyWeeks([day('2026-09-29', [[squat, [{}]]])], library, {
      exerciseId: squat.id,
    });
    expect(weekSummary(week, true)).toBe('1 session');
  });

  it('rounds an e1RM to whole kilos', () => {
    expect(e1rmText(111.6)).toBe('112');
  });
});

describe('a tapped calendar day', () => {
  const grid = monthGrid(
    2026,
    10,
    [
      day('2026-10-01'),
      day('2026-10-02'),
      day('2026-10-02', squatSet, { hour: 7 }),
      day('2026-10-05', squatSet, { planned: true }),
    ],
    { today: '2026-10-05', recordDays: new Set(['2026-10-01']) },
  );
  const at = (date: string) => grid.weeks.flat().find((d) => d.date === date)!;

  it('does nothing on an empty day, opens one session, offers several', () => {
    expect(dayTap(at('2026-10-03'))).toEqual({ kind: 'none' });
    expect(dayTap(at('2026-10-01'))).toMatchObject({ kind: 'open' });
    expect(dayTap(at('2026-10-02'))).toMatchObject({ kind: 'choose' });
    expect(dayTap(at('2026-10-05'))).toMatchObject({ kind: 'open' });
  });

  it('describes a day in words, since the disc is only a picture', () => {
    expect(dayAria(at('2026-10-05'), 'Monday 5 October')).toBe(
      'Monday 5 October, 1 planned, today',
    );
    expect(dayAria(at('2026-10-02'), 'Friday 2 October')).toBe('Friday 2 October, 2 sessions');
    expect(dayAria(at('2026-10-01'), 'Thursday 1 October')).toBe(
      'Thursday 1 October, 1 session, record set',
    );
  });
});

describe("one exercise's history", () => {
  const sessions = [
    day('2026-09-29', [
      [
        squat,
        [
          { load: 60, reps: 5, warmup: true },
          { load: 140, reps: 5, rpe: 8 },
          { load: 140, reps: 5, rpe: 8 },
          { load: 142.5, reps: 5, rpe: 8.5 },
        ],
      ],
    ]),
    day('2026-10-02', [[squat, [{ load: 145, reps: 5, rpe: 8 }]]]),
    day('2026-10-03', [[bench, [{ load: 90, reps: 5 }]]]),
    day('2026-10-04', [[squat, [{}]]]),
  ];
  const view = exerciseHistory(squat, sessions, recordBook(sessions, library, []));

  it('lists the visits newest first by month, leaving out sessions with no done sets', () => {
    expect(view.sessions).toBe(2);
    expect(view.months.map((m) => [m.label, m.visits.length])).toEqual([
      ['October 2026', 1],
      ['September 2026', 1],
    ]);
  });

  it('writes the sets compactly, folding repeats and leaving warm-ups out', () => {
    const visit = view.months[1].visits[0];
    expect(visit.sets).toEqual(['140 × 5 @ 8 ×2', '142.5 × 5 @ 8.5']);
    expect(visit.warmups).toBe(1);
    expect(visit.best?.text).toBe('142.5 × 5 @ 8.5');
  });

  it('finds the best e1RM and when it was set', () => {
    expect(view.bestE1rm?.date).toBe('2026-10-02');
    expect(view.bestE1rm!.kg).toBeGreaterThan(160);
  });

  it('counts the rep counts that hold a record', () => {
    const book = [
      { exercise_id: squat.id, reps: 5 },
      { exercise_id: squat.id, reps: 3 },
      { exercise_id: bench.id, reps: 5 },
    ] as never;
    expect(exerciseHistory(squat, sessions, book).records).toBe(2);
  });

  it('is empty for an exercise never done', () => {
    const none = exerciseHistory(deadlift, sessions, []);
    expect(none).toMatchObject({ months: [], sessions: 0, bestE1rm: null, records: 0 });
  });
});

describe('record marks', () => {
  const events = [
    { session_id: 'a', date: '2026-10-01', exercise_id: squat.id },
    { session_id: 'b', date: '2026-10-02', exercise_id: bench.id },
  ] as never;

  it('marks every record day, or only those of the filtered exercise', () => {
    expect(recordMarks(events).days).toEqual(new Set(['2026-10-01', '2026-10-02']));
    const squats = recordMarks(events, squat.id);
    expect(squats.sessions).toEqual(new Set(['a']));
    expect(squats.days).toEqual(new Set(['2026-10-01']));
  });
});
