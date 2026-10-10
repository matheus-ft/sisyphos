import { describe, expect, it } from 'vitest';
import type { Meet } from '../src/model';
import { parseMeet, serializeMeet } from '../src/storage/formats';
import {
  bestOfExercise,
  bestOfLift,
  bestTotal,
  blankForm,
  formFrom,
  latestMeet,
  liftBest,
  meetBestLine,
  meetExercises,
  meetFrom,
  meetProblem,
  meetSaid,
  meetTitle,
  meetTotal,
  meetWhen,
  meetsLine,
  meetsNewestFirst,
  meetsSummary,
  rowExercise,
  totalText,
  usualExercises,
  withRowExercise,
} from '../src/ui/meets';
import { byId, good, library, meetOf, missed } from './ui-fixtures';
import { sessionOf as lifted, squat } from './analysis-fixtures';

const today = '2026-10-04';

/** Three lifts' attempts in a line: squat, bench, deadlift, each [kg, good?] or null. */
function meetWith(
  id: string,
  lifts: {
    squat?: Meet['lifts']['squat'];
    bench?: Meet['lifts']['bench'];
    deadlift?: Meet['lifts']['deadlift'];
  },
  over: Partial<Meet> = {},
): Meet {
  return meetOf(id, {
    lifts: {
      squat: lifts.squat ?? [null, null, null],
      bench: lifts.bench ?? [null, null, null],
      deadlift: lifts.deadlift ?? [null, null, null],
    },
    ...over,
  });
}

const nationals = meetWith(
  '2026-05-16-8mzt',
  {
    squat: [good(200, 'low_bar_squat'), missed(215, 'low_bar_squat'), good(210, 'low_bar_squat')],
    bench: [good(130, 'bench'), good(137.5, 'bench'), missed(142.5, 'bench')],
    deadlift: [good(240, 'sumo_deadlift'), good(252.5, 'sumo_deadlift'), null],
  },
  { name: 'Nationals 2026', location: 'Lisbon' },
);
const regionals = meetWith(
  '2025-11-02-c3d4',
  {
    squat: [good(205, 'low_bar_squat'), null, null],
    bench: [good(140, 'bench'), null, null],
    deadlift: [good(260, 'conventional_deadlift'), null, null],
  },
  { name: 'Regionals' },
);

describe('what a meet came to', () => {
  it('has as its best of a lift the heaviest good attempt', () => {
    expect(liftBest(nationals.lifts.squat)).toEqual(good(210, 'low_bar_squat'));
    expect(liftBest(nationals.lifts.bench)).toEqual(good(137.5, 'bench'));
  });

  it('counts a missed attempt for nothing, however heavy', () => {
    expect(liftBest([missed(300, 'bench'), good(100, 'bench'), null])).toEqual(good(100, 'bench'));
    expect(liftBest([missed(300, 'bench'), null, null])).toBeNull();
    expect(liftBest([null, null, null])).toBeNull();
  });

  it('keeps the earlier of two equal good attempts', () => {
    const first = good(100, 'low_bar_squat');
    const second = good(100, 'high_bar_squat');
    expect(liftBest([first, second, null])).toBe(first);
  });

  it('totals the three bests, to the centigram', () => {
    expect(meetTotal(nationals)).toBe(600);
    expect(meetTotal(regionals)).toBe(605);
    const odd = meetWith('2026-01-01-aaaa', {
      squat: [good(100.1, 'low_bar_squat'), null, null],
      bench: [good(50.2, 'bench'), null, null],
      deadlift: [good(150.3, 'sumo_deadlift'), null, null],
    });
    expect(meetTotal(odd)).toBe(300.6);
  });

  it('has no total while any lift has no good attempt', () => {
    expect(meetTotal(meetOf('2026-01-01-aaaa'))).toBeNull();
    const bombed = meetWith('2026-01-01-aaaa', {
      squat: [good(200, 'low_bar_squat'), null, null],
      bench: [missed(130, 'bench'), missed(130, 'bench'), missed(130, 'bench')],
      deadlift: [good(240, 'sumo_deadlift'), null, null],
    });
    expect(meetTotal(bombed)).toBeNull();
    expect(totalText(null)).toBe('—');
    expect(totalText(600)).toBe('600 kg');
  });
});

describe('across meets', () => {
  const meets = [regionals, nationals];

  it('lists the newest first, and finds the most recent', () => {
    expect(meetsNewestFirst(meets).map((m) => m.id)).toEqual([nationals.id, regionals.id]);
    expect(latestMeet(meets)).toBe(nationals);
    expect(latestMeet([])).toBeNull();
    const sameDay = [meetOf('2026-05-16-aaaa'), meetOf('2026-05-16-zzzz')];
    expect(meetsNewestFirst(sameDay).map((m) => m.id)).toEqual([
      '2026-05-16-zzzz',
      '2026-05-16-aaaa',
    ]);
  });

  it('finds the heaviest good attempt of a lift, whichever stance', () => {
    expect(bestOfLift(meets, 'deadlift')).toMatchObject({
      kg: 260,
      exercise_id: 'conventional_deadlift',
      date: '2025-11-02',
      meet: 'Regionals',
    });
    expect(bestOfLift(meets, 'squat')).toMatchObject({ kg: 210, date: '2026-05-16' });
    expect(bestOfLift([], 'squat')).toBeNull();
  });

  it('finds the heaviest of one exercise, sumo and conventional apart', () => {
    expect(bestOfExercise(meets, 'sumo_deadlift')).toMatchObject({ kg: 252.5 });
    expect(bestOfExercise(meets, 'conventional_deadlift')).toMatchObject({ kg: 260 });
    expect(bestOfExercise(meets, 'high_bar_squat')).toBeNull();
  });

  it('keeps the earlier meet when two lifted the same', () => {
    const later = meetWith('2026-09-01-aaaa', { bench: [good(140, 'bench'), null, null] });
    expect(bestOfExercise([later, regionals], 'bench')?.date).toBe('2025-11-02');
  });

  it('finds the best total, which is a meet’s own and never a mix of two', () => {
    expect(bestTotal(meets)).toEqual({
      kg: 605,
      date: '2025-11-02',
      meet_id: regionals.id,
      meet: 'Regionals',
    });
    expect(bestTotal([meetOf('2026-01-01-aaaa')])).toBeNull();
  });

  it('summarises each lift’s best and the latest meet’s, naming a stance once there are two', () => {
    const summary = meetsSummary(meets, library);
    expect(summary.lifts.map((l) => [l.lift, l.best?.kg, l.latest?.kg])).toEqual([
      ['squat', 210, 210],
      ['bench', 140, 137.5],
      ['deadlift', 260, 252.5],
    ]);
    // Two stances of the deadlift were made good; the squat and bench have one each.
    expect(summary.lifts[2].best?.exercise).toBe('Conventional Deadlift');
    expect(summary.lifts[2].latest?.exercise).toBe('Sumo Deadlift');
    expect(summary.lifts[0].best?.exercise).toBeNull();
    expect(summary.total?.kg).toBe(605);
    expect(summary.latest).toEqual({ meet: nationals, total: 600 });
  });

  it('has no latest figure for a lift the latest meet did not make', () => {
    const noBench = meetWith('2027-01-01-aaaa', {
      squat: [good(220, 'low_bar_squat'), null, null],
    });
    const summary = meetsSummary([...meets, noBench], library);
    expect(summary.lifts[1].latest).toBeNull();
    expect(summary.latest?.total).toBeNull();
    expect(summary.lifts[0].latest?.kg).toBe(220);
  });

  it('summarises nothing for no meets', () => {
    const summary = meetsSummary([], library);
    expect(summary.lifts.every((l) => l.best === null && l.latest === null)).toBe(true);
    expect(summary.total).toBeNull();
    expect(summary.latest).toBeNull();
  });

  it('writes a reference max’s “at a meet” line', () => {
    expect(meetBestLine('bench', meets, library)).toEqual({
      kg: 140,
      date: '2025-11-02',
      exercise: null,
      meet: 'Regionals',
    });
    expect(meetBestLine('deadlift', meets, library)?.exercise).toBe('Conventional Deadlift');
    expect(meetBestLine('squat', [], library)).toBeNull();
  });

  it('says how many for the index, and the best total', () => {
    expect(meetsLine([])).toBe('None yet');
    expect(meetsLine([meetOf('2026-01-01-aaaa')])).toBe('1 meet');
    expect(meetsLine(meets)).toBe('2 meets · best total 605 kg');
  });
});

describe('naming a meet', () => {
  it('uses its name, else its day', () => {
    expect(meetTitle(nationals)).toBe('Nationals 2026');
    expect(meetTitle(meetOf('2026-05-16-8mzt'))).toMatch(/16 May 2026/);
  });

  it('says when and where, with the year once it is not this one', () => {
    expect(meetWhen(nationals, today)).toBe('16 May · Lisbon');
    expect(meetWhen(regionals, today)).toBe('2 November 2025');
  });

  it('says what it came to', () => {
    expect(meetSaid(nationals)).toBe('Nationals 2026 · 600 kg');
    expect(meetSaid({ ...nationals, name: 'Open' })).toBe('Open · 600 kg');
    expect(meetSaid(meetWith('2026-05-16-8mzt', {}, { name: 'Open' }))).toBe('Open');
  });
});

describe('the exercises an attempt can be of', () => {
  it('are the competition-tier exercises of the lift, each stance its own', () => {
    expect(meetExercises(library, 'squat').map((e) => e.id)).toEqual([
      'low_bar_squat',
      'high_bar_squat',
    ]);
    expect(meetExercises(library, 'bench').map((e) => e.id)).toEqual(['bench']);
    expect(
      meetExercises(library, 'deadlift')
        .map((e) => e.id)
        .sort(),
    ).toEqual(['conventional_deadlift', 'sumo_deadlift']);
  });

  describe('starting each row on the usual one', () => {
    const none = { squat: '', bench: '', deadlift: '' };

    it('is the library’s first record-keeping stance with nothing to go on', () => {
      expect(usualExercises([], [], library)).toEqual({
        squat: 'low_bar_squat',
        bench: 'bench',
        deadlift: 'conventional_deadlift',
      });
      expect(usualExercises([], [], [])).toEqual(none);
    });

    it('is the one trained most, when the lifter trains another', () => {
      const highBar = byId('high_bar_squat');
      const sessions = [
        lifted({
          date: '2026-09-01',
          work: [
            [
              highBar,
              [
                { load: 100, reps: 5, rpe: 8 },
                { load: 100, reps: 5, rpe: 8 },
              ],
            ],
          ],
        }),
        lifted({ date: '2026-09-03', work: [[squat, [{ load: 140, reps: 5, rpe: 8 }]]] }),
      ];
      expect(usualExercises([], sessions, library).squat).toBe('high_bar_squat');
    });

    it('does not count warm-ups as training', () => {
      const sessions = [
        lifted({
          date: '2026-09-01',
          work: [[byId('sumo_deadlift'), [{ load: 100, reps: 5, warmup: true }]]],
        }),
      ];
      expect(usualExercises([], sessions, library).deadlift).toBe('conventional_deadlift');
    });

    it('is the one used at the latest meet, before anything trained', () => {
      const sessions = [
        lifted({ date: '2026-09-01', work: [[squat, [{ load: 140, reps: 5, rpe: 8 }]]] }),
      ];
      expect(usualExercises([regionals, nationals], sessions, library).deadlift).toBe(
        'sumo_deadlift',
      );
    });
  });
});

describe('the editor’s form', () => {
  const usual = { squat: 'low_bar_squat', bench: 'bench', deadlift: 'conventional_deadlift' };

  it('starts today, with nothing taken and each row on its usual exercise', () => {
    const form = blankForm(today, usual);
    expect(form.date).toBe(today);
    expect(rowExercise(form, 'squat')).toBe('low_bar_squat');
    expect(rowExercise(form, 'deadlift')).toBe('conventional_deadlift');
    expect(form.lifts.bench.map((a) => a.kg)).toEqual(['', '', '']);
    expect(meetProblem(form, library, today)).toMatch(/name or at least one attempt/);
  });

  it('holds a saved meet, and gives it back unchanged', () => {
    const form = formFrom(nationals, usual);
    expect(form.lifts.squat.map((a) => [a.kg, a.good])).toEqual([
      ['200', true],
      ['215', false],
      ['210', true],
    ]);
    expect(rowExercise(form, 'deadlift')).toBe('sumo_deadlift');
    expect(meetProblem(form, library, today)).toBeNull();
    expect(meetFrom(form, nationals)).toEqual(nationals);
  });

  it('writes a meet the file format reads back', () => {
    const form = formFrom(nationals, usual);
    const meet = meetFrom(
      { ...form, name: '  Open  ', placing: ' 3 ', bodyweight: '82,6' },
      nationals,
    );
    expect(meet).toMatchObject({ name: 'Open', placing: 3, bodyweight_kg: 82.6 });
    expect(parseMeet(serializeMeet(meet))).toEqual(meet);
  });

  it('makes an attempt with no weight no attempt, whatever its toggle says', () => {
    const form = blankForm(today, usual);
    form.name = 'Open';
    form.lifts.bench[0].kg = '120';
    form.lifts.bench[1].good = false;
    const meet = meetFrom(form, nationals);
    expect(meet.lifts.bench).toEqual([good(120, 'bench'), null, null]);
    expect(meet.lifts.squat).toEqual([null, null, null]);
  });

  it('turns empty metadata into null', () => {
    const form = { ...blankForm(today, usual), name: 'Open' };
    expect(meetFrom(form, nationals)).toMatchObject({
      location: null,
      federation: null,
      weight_class: null,
      equipment: null,
      bodyweight_kg: null,
      placing: null,
      notes: null,
    });
  });

  it('keeps the meet’s identity, so its id never changes with its date', () => {
    const form = { ...formFrom(nationals, usual), date: '2026-05-17' };
    expect(meetFrom(form, nationals)).toMatchObject({ id: nationals.id, date: '2026-05-17' });
  });

  it('moves a whole row to another exercise', () => {
    const form = withRowExercise(formFrom(nationals, usual), 'squat', 'high_bar_squat');
    expect(form.lifts.squat.map((a) => a.exerciseId)).toEqual(Array(3).fill('high_bar_squat'));
    expect(meetFrom(form, nationals).lifts.squat.map((a) => a?.exercise_id)).toEqual(
      Array(3).fill('high_bar_squat'),
    );
    expect(rowExercise(form, 'bench')).toBe('bench');
  });

  describe('says what is wrong', () => {
    const named = { ...blankForm(today, usual), name: 'Open' };
    const withAttempt = (lift: 'squat' | 'bench' | 'deadlift', kg: string, exerciseId?: string) => {
      const form = structuredClone(named);
      form.lifts[lift][1].kg = kg;
      if (exerciseId) form.lifts[lift][1].exerciseId = exerciseId;
      return form;
    };

    it('about the date', () => {
      expect(meetProblem({ ...named, date: '2026-12-01' }, library, today)).toMatch(/future/);
      expect(meetProblem({ ...named, date: '' }, library, today)).toMatch(/date/);
    });

    it('about a weight, naming the attempt', () => {
      expect(meetProblem(withAttempt('squat', 'heavy'), library, today)).toMatch(/Squat 2/);
      expect(meetProblem(withAttempt('bench', '12'), library, today)).toMatch(/between 20 and 700/);
      expect(meetProblem(withAttempt('bench', '120'), library, today)).toBeNull();
    });

    it('about an exercise that is not that lift’s', () => {
      expect(meetProblem(withAttempt('squat', '200', 'bench'), library, today)).toMatch(/Squat 2/);
      expect(
        meetProblem(withAttempt('deadlift', '200', 'sumo_deadlift'), library, today),
      ).toBeNull();
      // An exercise of a lift taken is the only one checked: an empty slot is not an attempt.
      const empty = structuredClone(named);
      empty.lifts.squat[0].exerciseId = 'bench';
      expect(meetProblem(empty, library, today)).toBeNull();
    });

    it('about bodyweight and placing', () => {
      expect(meetProblem({ ...named, bodyweight: '8' }, library, today)).toMatch(/Bodyweight/);
      expect(meetProblem({ ...named, bodyweight: '82.6' }, library, today)).toBeNull();
      for (const placing of ['0', '1.5', 'first', '-2']) {
        expect(meetProblem({ ...named, placing }, library, today), placing).toMatch(/Placing/);
      }
      expect(meetProblem({ ...named, placing: '12' }, library, today)).toBeNull();
    });
  });
});
