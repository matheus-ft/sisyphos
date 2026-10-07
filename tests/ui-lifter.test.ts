import { describe, expect, it } from 'vitest';
import type { BodyweightEntry, CompetitionBest, ManualRecord, OneRmEntry } from '../src/model';
import { recordBook } from '../src/metrics/records';
import {
  bestsNewestFirst,
  bestsSummary,
  bodyweightAt,
  bodyweightSummary,
  changeText,
  competitionExercises,
  competitionFrom,
  competitionLine,
  competitionProblem,
  kgText,
  liftBests,
  maxesSummary,
  maxProblem,
  maxViews,
  parseKg,
  recordFigures,
  recordFrom,
  recordLine,
  recordProblem,
  recordsNewestFirst,
  recordsSummary,
  validDate,
  weighInProblem,
  weighIns,
  whenText,
  type CompetitionForm,
  type RecordForm,
} from '../src/ui/lifter';
import { byId, library, sessionOf, squat } from './analysis-fixtures';

const today = '2026-10-04';
const weigh = (date: string, weight_kg: number): BodyweightEntry => ({
  date,
  weight_kg,
  source: 'manual',
});
const max = (date: string, lift: OneRmEntry['lift'], weight_kg: number): OneRmEntry => ({
  date,
  lift,
  weight_kg,
  note: null,
});
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

describe('typing a weight', () => {
  it('reads a comma as a decimal point', () => {
    expect(parseKg('83,4', { min: 20, max: 400 })).toBe(83.4);
  });

  it('refuses an empty field, words, and anything outside the range', () => {
    const range = { min: 20, max: 400 };
    for (const text of ['', ' ', 'abc', '19.9', '401', '-5'])
      expect(parseKg(text, range)).toBeNull();
  });

  it('keeps two decimals at most', () => {
    expect(parseKg('83.456', { min: 20, max: 400 })).toBe(83.46);
  });

  it('writes a weight without a float tail or a trailing zero', () => {
    expect(kgText(84)).toBe('84');
    expect(kgText(84.10000000000001)).toBe('84.1');
  });
});

describe('dates typed into a field', () => {
  it('accepts today and the past, and refuses the future and nonsense', () => {
    expect(validDate('2026-10-04', today)).toBe('2026-10-04');
    expect(validDate('2026-03-14', today)).toBe('2026-03-14');
    expect(validDate('2026-10-05', today)).toBeNull();
    expect(validDate('2026-02-30', today)).toBeNull();
    expect(validDate('', today)).toBeNull();
    expect(validDate('4 Oct', today)).toBeNull();
  });

  it('says the year only once it is not this one', () => {
    expect(whenText('2026-08-01', today)).toBe('1 August');
    expect(whenText('2025-08-01', today)).toBe('1 August 2025');
  });
});

describe('weigh-ins', () => {
  const entries = [weigh('2026-09-14', 84), weigh('2026-10-03', 83.4), weigh('2026-09-28', 83.6)];

  it('lists newest first, each with its change from the one before', () => {
    const rows = weighIns(entries);
    expect(rows.map((r) => r.entry.date)).toEqual(['2026-10-03', '2026-09-28', '2026-09-14']);
    expect(rows.map((r) => r.change)).toEqual([-0.2, -0.4, null]);
  });

  it('keeps float noise out of a change', () => {
    expect(weighIns([weigh('2026-01-01', 83.1), weigh('2026-01-08', 83.4)])[0].change).toBe(0.3);
  });

  it('writes a change with a real minus sign', () => {
    expect(changeText(-0.4)).toBe('−0.4');
    expect(changeText(1)).toBe('+1');
    expect(changeText(0)).toBe('no change');
  });

  it('summarises the latest one', () => {
    expect(bodyweightSummary(entries)).toBe('83.4 kg on 3 October');
    expect(bodyweightSummary([])).toBe('No weigh-ins yet');
  });

  it('gives the weight on a date from the latest weigh-in on or before it', () => {
    const at = bodyweightAt(entries);
    expect(at('2026-10-10')).toBe(83.4);
    expect(at('2026-09-28')).toBe(83.6);
    expect(at('2026-09-20')).toBe(84);
    expect(at('2026-09-01')).toBeNull();
  });

  it('says what is wrong with an entry', () => {
    expect(weighInProblem('2026-10-04', '83.4', today)).toBeNull();
    expect(weighInProblem('2026-10-09', '83.4', today)).toMatch(/future/);
    expect(weighInProblem('2026-10-04', '8', today)).toMatch(/kilograms/);
  });
});

describe('reference maxes', () => {
  const oneRms = [
    max('2026-08-01', 'squat', 150),
    max('2026-05-01', 'squat', 140),
    max('2026-08-01', 'bench', 100),
  ];

  it('summarises the max in force for each lift that has one', () => {
    expect(maxesSummary(oneRms, today)).toBe('squat 150 · bench 100');
    expect(maxesSummary([], today)).toBe('None set yet');
  });

  it('does not count a max from after today', () => {
    expect(maxesSummary([...oneRms, max('2026-12-01', 'squat', 160)], today)).toBe(
      'squat 150 · bench 100',
    );
  });

  it('says what is wrong with an entry', () => {
    expect(maxProblem('2026-10-04', '150', today)).toBeNull();
    expect(maxProblem('2026-10-04', '', today)).toMatch(/kilograms/);
    expect(maxProblem('2027-01-01', '150', today)).toMatch(/future/);
  });

  describe('beside the best recent e1RM', () => {
    const sets = (kg: number) => [{ load: kg, reps: 3, rpe: 8 }];
    const sessions = [sessionOf({ date: '2026-10-02', work: [[squat, sets(150)]] })];

    it('offers it, whole, for a lift trained recently, with its history newest first', () => {
      const [squatView, bench, deadlift] = maxViews(oneRms, sessions, library, [], today);
      expect(squatView.inForce?.weight_kg).toBe(150);
      expect(squatView.history.map((e) => e.date)).toEqual(['2026-08-01', '2026-05-01']);
      expect(squatView.suggestion?.date).toBe('2026-10-02');
      expect(Number.isInteger(squatView.suggestion?.kg)).toBe(true);
      expect(squatView.suggestion!.kg).toBeGreaterThan(150);
      expect(bench.suggestion).toBeNull();
      expect(deadlift.inForce).toBeNull();
    });

    it('withholds it when it is the max already in force', () => {
      const view = maxViews(oneRms, sessions, library, [], today)[0];
      const same = maxViews(
        [max('2026-08-01', 'squat', view.suggestion!.kg)],
        sessions,
        library,
        [],
        today,
      )[0];
      expect(same.suggestion).toBeNull();
    });

    it('writes nothing: it only reads', () => {
      const before = JSON.stringify(oneRms);
      maxViews(oneRms, sessions, library, [], today);
      expect(JSON.stringify(oneRms)).toBe(before);
    });
  });
});

describe('records by hand', () => {
  const form = (over: Partial<RecordForm> = {}): RecordForm => ({
    exerciseId: 'low_bar_squat',
    reps: '1',
    kg: '155',
    date: '2026-03-14',
    rpe: '9.5',
    context: ' Gym mock meet ',
    ...over,
  });

  it('turns a valid form into the record, with empty optionals as null', () => {
    expect(recordFrom(form())).toEqual(hand());
    expect(recordFrom(form({ rpe: '', context: '  ' }))).toEqual(
      hand({ rpe: null, context: null }),
    );
  });

  it('names what is missing or out of range, in the order a lifter fills it in', () => {
    expect(recordProblem(form(), today)).toBeNull();
    expect(recordProblem(form({ exerciseId: null }), today)).toMatch(/exercise/);
    expect(recordProblem(form({ reps: '0' }), today)).toMatch(/Reps/);
    expect(recordProblem(form({ reps: '11' }), today)).toMatch(/Reps/);
    expect(recordProblem(form({ reps: '2.5' }), today)).toMatch(/Reps/);
    expect(recordProblem(form({ kg: 'heavy' }), today)).toMatch(/kilograms/);
    expect(recordProblem(form({ date: '2027-01-01' }), today)).toMatch(/future/);
  });

  it('takes a competition lift from an empty bar up', () => {
    expect(recordProblem(form({ kg: '20' }), today)).toBeNull();
    expect(recordProblem(form({ kg: '12.5' }), today)).toMatch(/between 20 and 700/);
  });

  it('lists newest first, then the heavier', () => {
    const rows = recordsNewestFirst([
      hand({ date: '2026-03-14', weight_kg: 150 }),
      hand({ date: '2026-05-01', weight_kg: 140 }),
      hand({ date: '2026-03-14', weight_kg: 155 }),
    ]);
    expect(rows.map((r) => `${r.date} ${r.weight_kg}`)).toEqual([
      '2026-05-01 140',
      '2026-03-14 155',
      '2026-03-14 150',
    ]);
  });

  it('writes a record as figures and a line of when, how hard and where', () => {
    expect(recordFigures(hand())).toBe('1 × 155 kg');
    expect(recordLine(hand(), today)).toBe('14 March · @ 9.5 · Gym mock meet');
    expect(recordLine(hand({ rpe: null, context: null }), today)).toBe('14 March');
  });

  it('counts them for the index', () => {
    expect(recordsSummary([hand()])).toBe('1 by hand');
    expect(recordsSummary([])).toBe('None by hand');
  });
});

describe('bests at meets', () => {
  const best = (over: Partial<CompetitionBest> = {}): CompetitionBest => ({
    date: '2026-05-16',
    exercise_id: 'sumo_deadlift',
    weight_kg: 200,
    meet: 'Nationals 2026',
    ...over,
  });
  const form = (over: Partial<CompetitionForm> = {}): CompetitionForm => ({
    exerciseId: 'sumo_deadlift',
    kg: '200',
    date: '2026-05-16',
    meet: ' Nationals 2026 ',
    ...over,
  });

  it('can be of the lifts taken to the platform only, each stance its own', () => {
    expect(competitionExercises(library).map((e) => e.id)).toEqual([
      'low_bar_squat',
      'bench',
      'conventional_deadlift',
      'sumo_deadlift',
    ]);
  });

  it('turns a valid form into the best, and says what is wrong with any other', () => {
    expect(competitionProblem(form(), library, today)).toBeNull();
    expect(competitionFrom(form())).toEqual(best());
    expect(competitionFrom(form({ meet: ' ' })).meet).toBeNull();
    expect(competitionProblem(form({ exerciseId: 'dips' }), library, today)).toBe('Pick the lift.');
    expect(competitionProblem(form({ kg: '12' }), library, today)).toMatch(/between 20 and 700/);
    expect(competitionProblem(form({ date: '2026-12-01' }), library, today)).toMatch(/future/);
  });

  it('lists newest first, counts meets by day, and says when and where', () => {
    const bench = best({ exercise_id: 'bench', weight_kg: 120 });
    const older = best({ date: '2025-11-02', meet: null });
    expect(bestsNewestFirst([older, bench, best()])).toEqual([best(), bench, older]);
    expect(bestsSummary([older, bench, best()])).toBe('2 meets');
    expect(bestsSummary([])).toBe('None yet');
    expect(competitionLine(best(), today)).toBe('16 May · Nationals 2026');
    expect(competitionLine(older, today)).toBe('2 November 2025');
  });
});

describe('beside a reference max', () => {
  const conventional = sessionOf({
    date: '2026-09-01',
    work: [[byId('conventional_deadlift'), [{ load: 190, reps: 1, rpe: 9 }]]],
  });
  const sumo = sessionOf({
    date: '2026-09-08',
    work: [[byId('sumo_deadlift'), [{ load: 200, reps: 1, rpe: 9.5 }]]],
  });
  const book = recordBook([conventional, sumo], library, []);
  const meet: CompetitionBest = {
    date: '2026-05-16',
    exercise_id: 'conventional_deadlift',
    weight_kg: 205,
    meet: 'Nationals 2026',
  };

  it('finds the heaviest training single and meet single across the stances', () => {
    expect(liftBests('deadlift', book, [meet], library)).toEqual({
      single: { kg: 200, date: '2026-09-08', exercise: 'Sumo Deadlift', meet: null },
      competition: {
        kg: 205,
        date: '2026-05-16',
        exercise: 'Conventional Deadlift',
        meet: 'Nationals 2026',
      },
    });
  });

  it('keeps a meet single out of training, and names no stance for a lift with one', () => {
    const benchMeet = { ...meet, exercise_id: 'bench', weight_kg: 130 };
    expect(liftBests('bench', book, [benchMeet], library)).toEqual({
      single: null,
      competition: { kg: 130, date: '2026-05-16', exercise: null, meet: 'Nationals 2026' },
    });
  });
});
