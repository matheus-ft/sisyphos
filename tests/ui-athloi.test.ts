import { describe, expect, it } from 'vitest';
import type { ManualRecord, Session } from '../src/model';
import { e1rmSeries } from '../src/metrics/e1rm';
import { recordBook } from '../src/metrics/records';
import { setsBehindMuscle, weeklyVolume } from '../src/metrics/weekly';
import {
  bodyweightAtFrom,
  dateInYear,
  dayLabel,
  defaultLift,
  formatCount,
  formatE1rm,
  formatKg,
  groupMuscleSets,
  headlineOf,
  legendCaption,
  levelsOf,
  liftChoices,
  muscleRowText,
  openingWindow,
  pointText,
  meetBest,
  recordedExercises,
  recordRows,
  resolvePick,
  sparseNote,
  topMuscles,
} from '../src/ui/athloi';
import { newSession } from '../src/ui/session';
import { parseMuscles } from '../src/library/parse';
import musclesCsv from '../src/library/muscles.csv?raw';
import { byId, ids, library, withSets, type Lifted } from './ui-fixtures';

const muscles = parseMuscles(musclesCsv);
const squat = byId('low_bar_squat');
const bench = byId('bench');
const row = byId('barbell_row');

function on(date: string, id: string): Session {
  const [y, m, d] = date.split('-').map(Number);
  return newSession({ id, at: new Date(y, m - 1, d, 18), tz: 'Europe/Lisbon', deviceId: 'phone' });
}

/** A session on `date` with each exercise's sets, all done. */
function day(date: string, lifts: [typeof squat, Lifted[]][]): Session {
  const newId = ids(`${date}-`);
  return lifts.reduce((s, [exercise, sets]) => withSets(s, exercise, sets, newId), on(date, date));
}

const sessions = [
  day('2026-04-06', [[squat, [{ amount: 120, reps: 5, rpe: 8 }]]]),
  day('2026-08-12', [[squat, [{ amount: 140, reps: 5, rpe: 8.5 }]]]),
  day('2026-10-01', [[bench, [{ amount: 90, reps: 5, rpe: 8 }]]]),
  day('2026-10-02', [
    [
      squat,
      [
        { amount: 150, reps: 3, rpe: 8 },
        { amount: 130, reps: 5, rpe: 7 },
      ],
    ],
  ]),
];
const today = '2026-10-05';

describe('formatting', () => {
  it('writes counts with halves, e1RMs whole, weights as on a plate', () => {
    expect(formatCount(16)).toBe('16');
    expect(formatCount(11.5)).toBe('11.5');
    expect(formatCount(4.25)).toBe('4.5');
    expect(formatE1rm(162.6)).toBe('163');
    expect(formatKg(142.5)).toBe('142.5');
    expect(formatKg(180)).toBe('180');
  });

  it('gives the year only when it is not this one', () => {
    expect(dateInYear('2026-03-12', today)).toBe('12 Mar');
    expect(dateInYear('2025-03-12', today)).toBe('12 Mar 2025');
  });

  it('labels a day by weekday', () => {
    expect(dayLabel('2026-09-28')).toBe('Mon 28 Sep');
  });
});

describe('the body', () => {
  // A Sunday, so the week holds the 1st and the 2nd.
  const volume = weeklyVolume(sessions, library, muscles, 'this_week', '2026-10-04');

  it('hands the statue a level for every muscle', () => {
    const levels = levelsOf(volume);
    expect(levels.size).toBe(muscles.length);
    expect(levels.get('quads')).toBeGreaterThan(0);
    expect(levels.get('tibialis')).toBe(0);
  });

  it('lists the muscles that worked, most first, with bars in proportion', () => {
    const top = topMuscles(volume, 3);
    expect(top).toHaveLength(3);
    expect(top[0].share).toBe(1);
    expect(top[1].share).toBeLessThanOrEqual(1);
    expect(top.map((t) => t.sets)).toEqual([...top.map((t) => t.sets)].sort((a, b) => b - a));
    expect(top[0].text).toBe(formatCount(top[0].sets));
  });

  it('lists none when nothing was trained', () => {
    expect(topMuscles(weeklyVolume([], library, muscles, 'this_week', today))).toEqual([]);
  });

  it('opens on this week, or on four weeks while this week is still bare', () => {
    expect(openingWindow(volume)).toBe('this_week');
    expect(openingWindow(weeklyVolume([], library, muscles, 'this_week', today))).toBe(
      'last_4_weeks',
    );
  });

  it('says what the shades mean for each window', () => {
    expect(legendCaption('this_week')).toContain('this week');
    expect(legendCaption('last_4_weeks')).toContain('averaged');
  });

  it('groups the sets behind a muscle by session and exercise, and the groups add up to its number', () => {
    const behind = setsBehindMuscle(sessions, library, 'quads', 'last_4_weeks', today);
    const groups = groupMuscleSets(behind, library);
    expect(groups.map((g) => g.exercise)).toContain(squat.name);
    expect(groups[0].when).toBe('Fri 2 Oct');
    expect(groups[0].sets).toBe(2);
    const total = weeklyVolume(sessions, library, muscles, 'last_4_weeks', today).find(
      (v) => v.muscle.id === 'quads',
    )!.sets;
    expect(groups.reduce((n, g) => n + g.counted, 0)).toBeCloseTo(total);
  });

  it('marks auxiliary work as counting half', () => {
    const behind = setsBehindMuscle(sessions, library, 'triceps', 'last_4_weeks', today);
    const [group] = groupMuscleSets(behind, library);
    expect(group.exercise).toBe(bench.name);
    expect(group.half).toBe(true);
    expect(muscleRowText(group)).toBe('1 set, counting half');
    const [full] = groupMuscleSets(
      setsBehindMuscle(sessions, library, 'quads', 'last_4_weeks', today),
      library,
    );
    expect(muscleRowText(full)).toBe('2 sets');
  });
});

describe('the lifts with a hill', () => {
  const none = () => null;
  const choices = liftChoices(sessions, library, none);

  it('offers the exercises with an e1RM history, competition lifts first', () => {
    expect(choices.map((c) => c.exercise.id)).toEqual(['low_bar_squat', 'bench']);
    expect(choices[0]).toMatchObject({ days: 3, last: '2026-10-02' });
  });

  it('leaves out an exercise whose sets cannot be priced', () => {
    const open = day('2026-10-01', [[row, [{ amount: 60, reps: 40 }]]]);
    expect(liftChoices([open], library, none)).toEqual([]);
  });

  it('defaults to the competition lift trained most recently', () => {
    expect(defaultLift(choices)?.exercise.id).toBe('low_bar_squat');
    const later = [...sessions, day('2026-10-04', [[bench, [{ amount: 92.5, reps: 5, rpe: 8 }]]])];
    expect(defaultLift(liftChoices(later, library, none))?.exercise.id).toBe('bench');
  });

  it('falls back to any exercise when no competition lift was logged', () => {
    const only = [day('2026-10-01', [[row, [{ amount: 80, reps: 8, rpe: 8 }]]])];
    expect(defaultLift(liftChoices(only, library, none))?.exercise.id).toBe('barbell_row');
    expect(defaultLift([])).toBeNull();
  });

  it('keeps a pick that is on offer and drops one that is not', () => {
    expect(resolvePick(choices, 'bench')?.exercise.id).toBe('bench');
    expect(resolvePick(choices, 'deadlift')?.exercise.id).toBe('low_bar_squat');
    expect(resolvePick(choices, null)?.exercise.id).toBe('low_bar_squat');
  });
});

describe('bodyweightAtFrom', () => {
  const at = bodyweightAtFrom([
    { date: '2026-09-01', weight_kg: 84, source: 'manual' },
    { date: '2026-08-01', weight_kg: 85, source: 'manual' },
  ]);

  it('takes the latest weigh-in on or before the date, else the earliest', () => {
    expect(at('2026-09-15')).toBe(84);
    expect(at('2026-08-01')).toBe(85);
    expect(at('2026-07-01')).toBe(85);
    expect(bodyweightAtFrom([])('2026-09-15')).toBeNull();
  });
});

describe('the headline', () => {
  const points = e1rmSeries(sessions, squat);

  it('gives the latest figure and the change since the first point in view', () => {
    const h = headlineOf(points, today)!;
    expect(h.value).toBe(formatE1rm(points[2].e1rm));
    const delta = Math.round(points[2].e1rm) - Math.round(points[0].e1rm);
    expect(h.change).toBe(`+${delta} since April`);
  });

  it('says this month for a change inside the month, and no change for none', () => {
    const [last] = points.slice(-1);
    expect(headlineOf([{ ...last, date: '2026-10-01' }, last], today)!.change).toBe(
      'no change this month',
    );
  });

  it('names a fall with a minus sign and the year when it is not this one', () => {
    const [first, , last] = points;
    const h = headlineOf(
      [
        { ...last, date: '2025-04-01', e1rm: 200 },
        { ...first, e1rm: 150 },
      ],
      today,
    )!;
    expect(h.change).toBe('−50 since April 2025');
  });

  it('has no change with one day, and nothing with none', () => {
    expect(headlineOf(points.slice(-1), today)!.change).toBeNull();
    expect(headlineOf([], today)).toBeNull();
  });
});

describe('sparseNote', () => {
  it('needs no note once there is a line to draw', () => {
    expect(sparseNote(2, 9, '3M')).toBeNull();
    expect(sparseNote(0, 0, 'all')).toBeNull();
  });

  it('offers the whole history when the range cut off the rest', () => {
    expect(sparseNote(0, 5, '3M')).toEqual({ text: 'No sessions in this range.', widen: true });
    expect(sparseNote(1, 5, '1Y')).toEqual({ text: 'One session in this range.', widen: true });
  });

  it('says the hill needs more when one session is all there is', () => {
    expect(sparseNote(1, 1, '6M')).toEqual({
      text: 'One session so far. The hill needs a few to draw.',
      widen: false,
    });
    expect(sparseNote(1, 1, 'all')?.widen).toBe(false);
  });
});

describe('pointText', () => {
  it('writes the figure, the date and the set behind it', () => {
    const points = e1rmSeries(sessions, squat);
    expect(pointText(points[1], sessions, squat, today)).toEqual({
      value: `${formatE1rm(points[1].e1rm)} kg`,
      detail: '12 Aug · 140 × 5 @ 8.5',
      set: '140 × 5 @ 8.5',
    });
  });

  it('keeps the date when the set is gone', () => {
    const [p] = e1rmSeries(sessions, squat);
    expect(pointText(p, [], squat, today)).toMatchObject({ detail: '6 Apr', set: null });
  });
});

describe('the record book rows', () => {
  const manual: ManualRecord = {
    source: 'manual',
    exercise_id: 'low_bar_squat',
    reps: 1,
    weight_kg: 155,
    date: '2026-03-12',
    rpe: null,
    context: null,
  };
  const book = recordBook(sessions, library, [manual]);
  const rows = recordRows(book, 'low_bar_squat', today);

  it('has a row for each of 1 to 10 reps', () => {
    expect(rows.map((r) => r.reps)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('reads a bodyweight-plus record as the load added, as its sets do', () => {
    const added = recordRows(book, 'low_bar_squat', today, { added: true })[0];
    expect(added.weight).toBe('+155');
    expect(added.spoken).toContain('155 kilograms added');
  });

  it('shows a hand-entered record as by hand, with nothing to open', () => {
    expect(rows[0]).toMatchObject({
      weight: '155',
      date: '12 Mar',
      source: 'by hand',
      manual: true,
      sessionId: null,
      recent: false,
    });
  });

  it('shows a session record with its RPE, its session and the laurel when recent', () => {
    expect(rows[2]).toMatchObject({
      weight: '150',
      date: '2 Oct',
      source: '@ 8',
      recent: true,
      sessionId: '2026-10-02',
      manual: false,
    });
    expect(rows[4]).toMatchObject({
      weight: '140',
      date: '12 Aug',
      source: '@ 8.5',
      recent: false,
    });
  });

  it('mutes a rep count with no record', () => {
    expect(rows[6]).toMatchObject({
      weight: null,
      date: null,
      source: '',
      recent: false,
      sessionId: null,
    });
    expect(rows[6].spoken).toBe('7 reps, no record yet');
  });

  it('speaks a row in a sentence', () => {
    expect(rows[0].spoken).toBe('1 rep, 155 kilograms, 12 Mar, by hand');
    expect(rows[2].spoken).toContain('at RPE 8');
    expect(rows[2].spoken).toContain('a recent record');
  });

  it('lists the exercises that have a record, competition lifts first', () => {
    expect(recordedExercises(book, library).map((r) => r.exercise.id)).toEqual([
      'low_bar_squat',
      'bench',
    ]);
    expect(recordedExercises([], library)).toEqual([]);
  });

  it('lists an exercise with only a meet best, and counts no record for it', () => {
    const meet = { date: '2026-05-16', exercise_id: 'sumo_deadlift', weight_kg: 200, meet: null };
    const [only] = recordedExercises([], library, [meet]);
    expect(only).toMatchObject({ last: '2026-05-16', count: 0 });
    expect(only.exercise.id).toBe('sumo_deadlift');
  });

  it("finds an exercise's heaviest meet single, the earlier on a tie", () => {
    const at = (date: string, weight_kg: number) => ({
      date,
      exercise_id: 'bench',
      weight_kg,
      meet: null,
    });
    expect(
      meetBest([at('2026-05-16', 120), at('2025-11-02', 120), at('2026-03-01', 115)], 'bench'),
    ).toEqual(at('2025-11-02', 120));
    expect(meetBest([at('2026-05-16', 120)], 'sumo_deadlift')).toBeNull();
  });
});
