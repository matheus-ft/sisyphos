import { describe, expect, it } from 'vitest';
import exercisesCsv from '../src/library/exercises.csv?raw';
import musclesCsv from '../src/library/muscles.csv?raw';
import { parseExercises, parseMuscles } from '../src/library/parse';
import type { ProgramLabel } from '../src/model';
import { newSession, fromTemplate, targetsOf } from '../src/ui/session';
import { parseTemplate, serializeTemplate } from '../src/storage/formats';
import {
  addTarget,
  addTemplateExercise,
  duplicateTarget,
  moveTarget,
  editTarget,
  exerciseHeadline,
  exerciseLines,
  formatClock,
  formatRange,
  groupTemplates,
  loadModes,
  loadOf,
  loadPreview,
  moveTemplateExercise,
  newTemplate,
  NO_PROGRAM_KEY,
  openAfterMove,
  openAfterRemove,
  parseOrdinal,
  parsePercent,
  parseRange,
  READERS,
  removeTarget,
  removeTemplateExercise,
  rename,
  restShown,
  setIntention,
  setLabel,
  setsSummary,
  setTemplateRest,
  stepTemplateRest,
  targetAmount,
  weekdayKey,
} from '../src/ui/template';

const muscles = parseMuscles(musclesCsv);
const library = parseExercises(exercisesCsv, new Set(muscles.map((m) => m.id)));
const squat = library.find((e) => e.id === 'low_bar_squat')!;
const plank = library.find((e) => e.id === 'plank')!;

const blank = () =>
  newTemplate({ id: 'squat-day-k3f9', name: 'Squat day', at: new Date(2026, 9, 4) });

describe('a template being built', () => {
  it('adds an exercise with one target, planned by feel until a load is given', () => {
    const t = addTemplateExercise(blank(), squat);
    expect(t.exercises).toEqual([
      {
        exercise_id: 'low_bar_squat',
        rest_s: null,
        prescribed: [
          {
            reps: null,
            rpe: null,
            load: { kind: 'weight', weight: { mode: 'rpe_driven' } },
            is_warmup: false,
            notes: null,
          },
        ],
      },
    ]);
  });

  it('sets a target exactly, and clears its kilograms without leaving the mode', () => {
    let t = addTemplateExercise(blank(), squat);
    t = editTarget(t, 0, 0, { amount: 140, reps: 5, rpe: 8 }, 'weight');
    expect(t.exercises[0].prescribed[0]).toMatchObject({
      reps: [5, 5],
      rpe: [8, 8],
      load: { kind: 'weight', weight: { mode: 'absolute', kg: [140, 140] } },
    });
    expect(targetAmount(t.exercises[0].prescribed[0])).toBe(140);
    t = editTarget(t, 0, 0, { amount: null }, 'weight');
    expect(t.exercises[0].prescribed[0].load).toEqual({
      kind: 'weight',
      weight: { mode: 'absolute', kg: [null, null] },
    });
    expect(targetAmount(t.exercises[0].prescribed[0])).toBeNull();
  });

  it('times unloaded work', () => {
    let t = addTemplateExercise(blank(), plank);
    t = editTarget(t, 0, 0, { amount: 60, reps: 3 }, 'time');
    expect(t.exercises[0].prescribed[0]).toMatchObject({
      reps: null,
      load: { kind: 'time', seconds: [60, 60] },
    });
  });

  it('adds a target copying the last, and removes targets, exercises, and renames', () => {
    let t = addTemplateExercise(blank(), squat);
    t = editTarget(t, 0, 0, { amount: 140, reps: 5 }, 'weight');
    t = addTarget(t, 0, 'weight');
    expect(t.exercises[0].prescribed).toHaveLength(2);
    expect(t.exercises[0].prescribed[1]).toEqual(t.exercises[0].prescribed[0]);
    expect(removeTarget(t, 0, 1).exercises[0].prescribed).toHaveLength(1);
    expect(removeTemplateExercise(t, 0).exercises).toEqual([]);
    expect(rename(t, 'Heavy squat').name).toBe('Heavy squat');
  });

  it('starts a session whose empty sets show the targets', () => {
    let t = addTemplateExercise(blank(), squat);
    t = editTarget(t, 0, 0, { amount: 140, reps: 5, rpe: 8 }, 'weight');
    let n = 0;
    const s = fromTemplate(
      newSession({
        id: '2026-10-04-a1b2',
        at: new Date(2026, 9, 4),
        tz: 'Europe/Lisbon',
        deviceId: 'phone',
      }),
      t,
      () => `id${++n}`,
    );
    const [e] = s.exercises;
    expect(e.performed[0].state).toBe('pending');
    expect(targetsOf(e, e.performed[0])).toEqual({ amount: '140', reps: '5', rpe: '8' });
  });
});

describe('where a template sits in a program, and how long it rests', () => {
  it('starts in no program, every rest the tier default', () => {
    const t = addTemplateExercise(blank(), squat);
    expect(t.label).toEqual({ name: null, block: null, week: null, day: null, weekday: null });
    expect(t.exercises[0].rest_s).toBeNull();
  });

  it('changes the label field by field', () => {
    let t = setLabel(blank(), { name: 'Off-season 2026', week: 3 });
    t = setLabel(t, { day: 2 });
    expect(t.label).toEqual({
      name: 'Off-season 2026',
      block: null,
      week: 3,
      day: 2,
      weekday: null,
    });
    expect(setLabel(t, { week: null }).label.week).toBeNull();
  });

  it('keeps a line of intention, and none when it is cleared', () => {
    const t = setIntention(blank(), '  Heavy singles, then back-off sets  ');
    expect(t.intention).toBe('Heavy singles, then back-off sets');
    expect(setIntention(t, '   ').intention).toBeNull();
  });

  it('sets one exercise’s rest, in whole seconds', () => {
    let t = addTemplateExercise(addTemplateExercise(blank(), squat), plank);
    t = setTemplateRest(t, 0, 180.2);
    expect(t.exercises.map((e) => e.rest_s)).toEqual([180, null]);
    expect(setTemplateRest(t, 0, null).exercises[0].rest_s).toBeNull();
  });

  it('is what a session started from it begins with', () => {
    let t = setLabel(addTemplateExercise(blank(), squat), { name: 'Block 1', block: 1 });
    t = setTemplateRest(t, 0, 240);
    let n = 0;
    const s = fromTemplate(
      newSession({ id: '2026-10-04-a1b2', at: new Date(2026, 9, 4), tz: 'UTC', deviceId: 'p' }),
      t,
      () => `id${++n}`,
    );
    expect(s.label).toEqual(t.label);
    expect(s.exercises[0].rest_s).toBe(240);
  });
});

describe('a template as the log stores it', () => {
  it('reads back exactly as written, empty targets included', () => {
    let t = addTemplateExercise(addTemplateExercise(blank(), squat), plank);
    t = editTarget(t, 0, 0, { amount: 140, reps: 5, rpe: 8 }, 'weight');
    t = addTarget(t, 0, 'weight');
    t = setTemplateRest(setLabel(t, { name: 'Off-season', weekday: 'friday' }), 1, 45);
    expect(parseTemplate(serializeTemplate(t))).toEqual(t);
  });
});

describe('the order of a template', () => {
  it('moves an exercise up or down', () => {
    const t = addTemplateExercise(addTemplateExercise(blank(), squat), plank);
    expect(moveTemplateExercise(t, 1, -1).exercises.map((e) => e.exercise_id)).toEqual([
      'plank',
      'low_bar_squat',
    ]);
  });
});

const bench = library.find((e) => e.id === 'bench')!;
const dips = library.find((e) => e.id === 'dips')!;
const target = (t: ReturnType<typeof blank>, i = 0) => t.exercises[0].prescribed[i];

describe('reps, RPE and loads as ranges', () => {
  it('takes an exact figure, a range or a floor for reps', () => {
    let t = addTemplateExercise(blank(), squat);
    t = editTarget(t, 0, 0, { reps: [3, 5] }, 'weight');
    expect(target(t).reps).toEqual([3, 5]);
    t = editTarget(t, 0, 0, { reps: [5, null] }, 'weight');
    expect(target(t).reps).toEqual([5, null]);
    t = editTarget(t, 0, 0, { reps: 5 }, 'weight');
    expect(target(t).reps).toEqual([5, 5]);
    t = editTarget(t, 0, 0, { reps: null }, 'weight');
    expect(target(t).reps).toBeNull();
  });

  it('takes an RPE range', () => {
    const t = editTarget(addTemplateExercise(blank(), squat), 0, 0, { rpe: [7, 8] }, 'weight');
    expect(target(t).rpe).toEqual([7, 8]);
  });

  it('takes a range of kilograms and of seconds', () => {
    let t = editTarget(addTemplateExercise(blank(), squat), 0, 0, { amount: [100, 110] }, 'weight');
    expect(target(t).load).toEqual({
      kind: 'weight',
      weight: { mode: 'absolute', kg: [100, 110] },
    });
    t = editTarget(addTemplateExercise(blank(), plank), 0, 0, { amount: [45, 60] }, 'time');
    expect(target(t).load).toEqual({ kind: 'time', seconds: [45, 60] });
  });
});

describe('moving a target', () => {
  it("moves it among its exercise's targets, keeping within them", () => {
    let t = addTemplateExercise(blank(), squat);
    t = editTarget(t, 0, 0, { amount: 100 }, 'weight');
    t = addTarget(t, 0, 'weight');
    t = editTarget(t, 0, 1, { amount: 140 }, 'weight');
    const amounts = (x: typeof t) => x.exercises[0].prescribed.map((p) => targetAmount(p));
    expect(amounts(moveTarget(t, 0, 1, -1))).toEqual([140, 100]);
    expect(amounts(moveTarget(t, 0, 1, 1))).toEqual([100, 140]);
  });
});

describe('duplicating a target', () => {
  it('puts a copy right after it, leaving the others in order', () => {
    let t = addTemplateExercise(blank(), squat);
    t = editTarget(t, 0, 0, { amount: 100 }, 'weight');
    t = addTarget(t, 0, 'weight');
    t = editTarget(t, 0, 1, { amount: 140 }, 'weight');
    t = duplicateTarget(t, 0, 0);
    expect(t.exercises[0].prescribed.map((p) => targetAmount(p))).toEqual([100, 100, 140]);
    // The copy is its own: editing one leaves the other.
    t = editTarget(t, 0, 1, { amount: 105 }, 'weight');
    expect(t.exercises[0].prescribed.map((p) => targetAmount(p))).toEqual([100, 105, 140]);
  });
});

describe('the modes of a load', () => {
  it('stores a percentage as a fraction and shows it as percent points', () => {
    let t = addTemplateExercise(blank(), squat);
    t = editTarget(t, 0, 0, { mode: 'pct_1rm', lift: 'squat' }, 'weight');
    expect(target(t).load).toEqual({
      kind: 'weight',
      weight: { mode: 'pct_1rm', pct: [null, null], lift: 'squat' },
    });
    t = editTarget(t, 0, 0, { amount: [77.5, 80] }, 'weight');
    expect(target(t).load).toMatchObject({ weight: { pct: [0.775, 0.8] } });
    expect(loadOf(target(t))).toEqual({ mode: 'pct_1rm', amount: [77.5, 80] });
    t = editTarget(t, 0, 0, { amount: 70 }, 'weight');
    expect(target(t).load).toMatchObject({ weight: { pct: [0.7, 0.7] } });
  });

  it('refuses a percentage with no lift to be a percentage of', () => {
    const t = addTemplateExercise(blank(), plank);
    const next = editTarget(t, 0, 0, { mode: 'pct_1rm' }, 'weight');
    expect(target(next).load).toEqual(target(t).load);
  });

  it('carries kilograms between kg and bodyweight plus, and drops them for RPE', () => {
    let t = editTarget(addTemplateExercise(blank(), dips), 0, 0, { amount: 10 }, 'weight');
    expect(target(t).load).toMatchObject({ weight: { mode: 'absolute', kg: [10, 10] } });
    t = editTarget(t, 0, 0, { mode: 'bw_plus' }, 'weight');
    expect(target(t).load).toEqual({
      kind: 'weight',
      weight: { mode: 'bw_plus', added_kg: [10, 10] },
    });
    expect(targetAmount(target(t))).toBe(10);
    t = editTarget(t, 0, 0, { amount: -20 }, 'weight');
    expect(loadOf(target(t))).toEqual({ mode: 'bw_plus', amount: [-20, -20] });
    t = editTarget(t, 0, 0, { mode: 'rpe_driven' }, 'weight');
    expect(target(t).load).toEqual({ kind: 'weight', weight: { mode: 'rpe_driven' } });
    expect(loadOf(target(t))).toEqual({ mode: 'rpe_driven', amount: null });
  });

  it('offers a percentage only for an exercise with a base lift, bodyweight plus for bodyweight work', () => {
    const plain = library.find((e) => e.base_lift === null && e.load_type === 'external');
    expect(loadModes(squat)).toEqual(['absolute', 'pct_1rm', 'rpe_driven']);
    expect(loadModes(dips)).toEqual(['bw_plus', 'rpe_driven']);
    expect(loadModes(plain)).toEqual(['absolute', 'rpe_driven']);
    // A target saved from a session keeps its chip.
    expect(loadModes(dips, 'absolute')).toEqual(['absolute', 'bw_plus', 'rpe_driven']);
  });

  it('reads back exactly as written, ranges and modes included', () => {
    let t = addTemplateExercise(addTemplateExercise(blank(), squat), dips);
    t = editTarget(
      t,
      0,
      0,
      { mode: 'pct_1rm', lift: 'squat', amount: [75, 80], reps: [3, 5], rpe: [7, 8] },
      'weight',
    );
    t = addTarget(t, 0, 'weight');
    t = editTarget(
      t,
      0,
      1,
      { reps: [5, null], rpe: [8, null], mode: 'absolute', amount: [140, 145] },
      'weight',
    );
    t = editTarget(t, 1, 0, { mode: 'bw_plus', amount: -10 }, 'weight');
    expect(parseTemplate(serializeTemplate(t))).toEqual(t);
  });
});

describe('what is typed into a target', () => {
  it('reads a number, a range or a floor', () => {
    expect(parseRange('5')).toEqual([5, 5]);
    expect(parseRange(' 3-5 ')).toEqual([3, 5]);
    expect(parseRange('3 – 5')).toEqual([3, 5]);
    expect(parseRange('5-3')).toEqual([3, 5]);
    expect(parseRange('5+')).toEqual([5, null]);
    expect(parseRange('≥5')).toEqual([5, null]);
    expect(parseRange('')).toBeNull();
    expect(parseRange('lots')).toBeUndefined();
    expect(parseRange('3-')).toBeUndefined();
  });

  it('reads each field by its own rules', () => {
    expect(parseRange('7-8.5', READERS.rpe)).toEqual([7, 8.5]);
    expect(parseRange('7.3', READERS.rpe)).toBeUndefined();
    expect(parseRange('80%', READERS.percent)).toEqual([80, 80]);
    expect(parseRange('75-80%', READERS.percent)).toEqual([75, 80]);
    expect(parseRange('0', READERS.percent)).toBeUndefined();
    expect(parseRange('-10', READERS.kg)).toEqual([-10, -10]);
    expect(parseRange('−10', READERS.kg)).toEqual([-10, -10]);
    expect(parseRange('0:45-1:00', READERS.time)).toEqual([45, 60]);
    expect(parseRange('1,5', READERS.kg)).toEqual([1.5, 1.5]);
  });

  it('shows what it reads', () => {
    expect(formatRange([5, 5])).toBe('5');
    expect(formatRange([3, 5])).toBe('3–5');
    expect(formatRange([5, null])).toBe('5+');
    expect(formatRange([null, null])).toBe('');
    expect(formatRange(null)).toBe('');
    expect(formatRange([45, 60], formatClock)).toBe('0:45–1:00');
    expect(formatClock(180)).toBe('3:00');
    expect(formatClock(75)).toBe('1:15');
  });

  it('reads block, week and day as whole numbers from 1', () => {
    expect(parseOrdinal('3')).toBe(3);
    expect(parseOrdinal('')).toBeNull();
    expect(parseOrdinal('0')).toBeUndefined();
    expect(parseOrdinal('2.5')).toBeUndefined();
    expect(parsePercent('150')).toBe(150);
  });

  it('knows a weekday however it is spelled', () => {
    expect(weekdayKey('Sun')).toBe('sunday');
    expect(weekdayKey('WEDNESDAY')).toBe('wednesday');
    expect(weekdayKey('su')).toBeNull();
    expect(weekdayKey('someday')).toBeNull();
    expect(weekdayKey(null)).toBeNull();
  });
});

describe('the rest stepper', () => {
  it('steps from the tier default when the exercise sets none', () => {
    expect(stepTemplateRest(squat, null, 1)).toBe(195);
    expect(stepTemplateRest(squat, null, -1)).toBe(165);
    expect(stepTemplateRest(squat, 240, -1)).toBe(225);
  });

  it('stays within what a rest can be', () => {
    expect(stepTemplateRest(squat, 15, -1)).toBe(15);
    expect(stepTemplateRest(squat, 3600, 1)).toBe(3600);
  });

  it('is saved on the exercise, and back to the default with null', () => {
    let t = addTemplateExercise(blank(), squat);
    t = setTemplateRest(t, 0, stepTemplateRest(squat, t.exercises[0].rest_s, 1));
    expect(t.exercises[0].rest_s).toBe(195);
    expect(setTemplateRest(t, 0, null).exercises[0].rest_s).toBeNull();
  });
});

describe('the preview of a percentage', () => {
  const oneRms = [
    { date: '2026-08-01', lift: 'squat' as const, weight_kg: 150, note: null },
    { date: '2026-09-20', lift: 'squat' as const, weight_kg: 180, note: null },
    { date: '2026-11-01', lift: 'squat' as const, weight_kg: 190, note: null },
  ];
  const ctx = { date: '2026-10-05', oneRms, step: 2.5 };
  const pct = (amount: number | [number, number] | null) =>
    editTarget(
      addTemplateExercise(blank(), squat),
      0,
      0,
      { mode: 'pct_1rm', lift: 'squat', amount },
      'weight',
    );

  it('resolves against the max in force on the date, rounded to the plates', () => {
    expect(loadPreview(target(pct(80)), ctx)).toEqual({
      kind: 'resolved',
      lead: '80% of 180',
      result: '145 kg',
      note: 'rounded to 2.5',
    });
  });

  it('shows a range of percentages as a range of loads', () => {
    expect(loadPreview(target(pct([75, 80])), ctx)).toMatchObject({
      lead: '75–80% of 180',
      result: '135–145 kg',
    });
  });

  it('follows the plate increment', () => {
    expect(loadPreview(target(pct(82)), { ...ctx, step: 5 })).toMatchObject({
      result: '150 kg',
      note: 'rounded to 5',
    });
  });

  it('says so when there is no max yet, and shows nothing for other modes or no figure', () => {
    expect(loadPreview(target(pct(80)), { ...ctx, oneRms: [] })).toEqual({
      kind: 'missing',
      lift: 'squat',
    });
    expect(loadPreview(target(pct(null)), ctx)).toBeNull();
    const kg = editTarget(addTemplateExercise(blank(), bench), 0, 0, { amount: 100 }, 'weight');
    expect(loadPreview(target(kg), ctx)).toBeNull();
  });
});

describe('a line for a list', () => {
  const names = new Map(library.map((e) => [e.id, e.name]));

  it('sums up the working sets', () => {
    let t = addTemplateExercise(blank(), squat);
    t = editTarget(t, 0, 0, { reps: 5 }, 'weight');
    t = addTarget(addTarget(t, 0, 'weight'), 0, 'weight');
    expect(setsSummary(t.exercises[0].prescribed)).toBe('3 × 5');
    t = editTarget(t, 0, 2, { reps: [3, 5] }, 'weight');
    expect(setsSummary(t.exercises[0].prescribed)).toBe('3 sets');
    expect(setsSummary(addTemplateExercise(blank(), squat).exercises[0].prescribed)).toBe('1 set');
  });

  it('leaves out warm-ups and says nothing for none', () => {
    const [work] = addTemplateExercise(blank(), squat).exercises[0].prescribed;
    expect(setsSummary([{ ...work, reps: [8, 8], is_warmup: true }])).toBe('');
    expect(setsSummary([])).toBe('');
  });

  it('times unloaded work', () => {
    let t = addTemplateExercise(blank(), plank);
    t = editTarget(t, 0, 0, { amount: 45 }, 'time');
    t = addTarget(t, 0, 'time');
    expect(setsSummary(t.exercises[0].prescribed)).toBe('2 × 0:45');
  });

  it('names each exercise with its targets', () => {
    let t = addTemplateExercise(addTemplateExercise(blank(), squat), bench);
    t = editTarget(t, 0, 0, { reps: 5 }, 'weight');
    expect(exerciseLines(t.exercises, names)).toEqual(['Low-Bar Squat 1 × 5', 'Bench Press 1 set']);
    expect(exerciseLines([{ exercise_id: 'gone', prescribed: [] }], names)).toEqual(['gone']);
  });
});

describe('an exercise on one line', () => {
  const bench = library.find((e) => e.id === 'bench')!;
  const line = (t: ReturnType<typeof blank>, exercise = bench) =>
    exerciseHeadline(t.exercises[0], exercise);

  it('gives the name, the sets, the RPE and the rest', () => {
    let t = addTemplateExercise(blank(), bench);
    t = editTarget(t, 0, 0, { reps: 5, rpe: 8 }, 'weight');
    t = addTarget(addTarget(t, 0, 'weight'), 0, 'weight');
    t = setTemplateRest(t, 0, 180);
    expect(line(t)).toBe('Bench Press · 3×5 @8 · 3:00');
  });

  it('leaves out what is not planned but shows the rest the exercise will take', () => {
    const t = addTemplateExercise(blank(), bench);
    expect(line(t)).toBe(`Bench Press · 1 set · ${restShown(bench, null)}`);
    expect(exerciseHeadline({ ...t.exercises[0], prescribed: [] }, bench)).toBe(
      `Bench Press · ${restShown(bench, null)}`,
    );
  });

  it('shows ranges, and a span of RPE where the sets differ', () => {
    let t = addTemplateExercise(blank(), bench);
    t = setTemplateRest(t, 0, 120);
    t = editTarget(t, 0, 0, { reps: [3, 5], rpe: 7 }, 'weight');
    t = addTarget(t, 0, 'weight');
    t = editTarget(t, 0, 1, { rpe: 9 }, 'weight');
    expect(line(t)).toBe('Bench Press · 2×3–5 @7–9 · 2:00');
    t = editTarget(t, 0, 1, { reps: 8, rpe: [8, null] }, 'weight');
    expect(line(t)).toBe('Bench Press · 2 sets @7+ · 2:00');
  });

  it('counts only the working sets', () => {
    let t = addTemplateExercise(blank(), bench);
    t = setTemplateRest(t, 0, 180);
    t = editTarget(t, 0, 0, { reps: 5, rpe: 8 }, 'weight');
    const [work] = t.exercises[0].prescribed;
    const warmup = { ...work, reps: [8, 8] as [number, number], rpe: [3, 3] as [number, number] };
    const entry = { ...t.exercises[0], prescribed: [{ ...warmup, is_warmup: true }, work] };
    expect(exerciseHeadline(entry, bench)).toBe('Bench Press · 1×5 @8 · 3:00');
  });

  it('times unloaded work and names an exercise the library no longer has by its id', () => {
    let t = addTemplateExercise(blank(), plank);
    t = setTemplateRest(t, 0, 60);
    t = editTarget(t, 0, 0, { amount: 45 }, 'time');
    t = addTarget(t, 0, 'time');
    expect(line(t, plank)).toBe('Plank · 2×0:45 · 1:00');
    expect(exerciseHeadline(t.exercises[0], undefined)).toBe(
      `plank · 2×0:45 · ${restShown(undefined, 60)}`,
    );
  });

  it('keeps the open exercise open as the list changes', () => {
    expect(openAfterMove(null, 1, -1)).toBeNull();
    // The open one moves with its card.
    expect(openAfterMove(1, 1, -1)).toBe(0);
    expect(openAfterMove(1, 1, 1)).toBe(2);
    // The one it swaps with takes its old place.
    expect(openAfterMove(0, 1, -1)).toBe(1);
    expect(openAfterMove(2, 1, 1)).toBe(1);
    // Others are not touched.
    expect(openAfterMove(3, 1, 1)).toBe(3);
    expect(openAfterRemove(null, 0)).toBeNull();
    expect(openAfterRemove(1, 1)).toBeNull();
    expect(openAfterRemove(2, 0)).toBe(1);
    expect(openAfterRemove(0, 2)).toBe(0);
  });
});

describe('templates in folders', () => {
  let n = 0;
  const made = (name: string, label: Partial<ProgramLabel> = {}) =>
    setLabel({ ...blank(), id: `t${n++}`, name }, label);

  it('groups by program with the programs in order and those with none last', () => {
    const folders = groupTemplates([
      made('Loose'),
      made('Pull', { name: 'Rebuild' }),
      made('Press', { name: 'Off-season' }),
      made('Squat', { name: 'Rebuild' }),
    ]);
    expect(folders.map((f) => [f.name, f.count])).toEqual([
      ['Off-season', 1],
      ['Rebuild', 2],
      [null, 1],
    ]);
    expect(folders.at(-1)!.key).toBe(NO_PROGRAM_KEY);
  });

  it('takes a program written in other capitals or with spaces for the same one', () => {
    const folders = groupTemplates([
      made('A', { name: 'Rebuild' }),
      made('B', { name: ' rebuild ' }),
      made('C', { name: '  ' }),
    ]);
    expect(folders.map((f) => [f.name, f.count])).toEqual([
      ['Rebuild', 2],
      [null, 1],
    ]);
  });

  it('orders a program by block, week, day and name, and splits it into blocks', () => {
    const [folder] = groupTemplates([
      made('Zed', { name: 'P', block: 2, week: 1, day: 1 }),
      made('Wed', { name: 'P', block: 1, week: 2, day: 3 }),
      made('Tue', { name: 'P', block: 1, week: 2, day: 2 }),
      made('Early', { name: 'P', block: 1, week: 1, day: 5 }),
      made('Open', { name: 'P' }),
      made('Alpha', { name: 'P', block: 2, week: 1, day: 1 }),
    ]);
    expect(folder.blocks.map((b) => [b.block, b.templates.map((t) => t.name)])).toEqual([
      [null, ['Open']],
      [1, ['Early', 'Tue', 'Wed']],
      [2, ['Alpha', 'Zed']],
    ]);
  });

  it('keeps unlabelled templates in blocks too, by name', () => {
    const [folder] = groupTemplates([made('b'), made('a')]);
    expect(folder.name).toBeNull();
    expect(folder.blocks.map((b) => b.templates.map((t) => t.name))).toEqual([['a', 'b']]);
  });

  it('is empty for no templates, and leaves the templates as they were', () => {
    expect(groupTemplates([])).toEqual([]);
    const all = [made('B', { name: 'X', block: 2 }), made('A', { name: 'X', block: 1 })];
    const before = structuredClone(all);
    groupTemplates(all);
    expect(all).toEqual(before);
  });
});
