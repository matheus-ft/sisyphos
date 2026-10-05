import { describe, expect, it } from 'vitest';
import type {
  Exercise,
  ExerciseInstance,
  PerformedSet,
  PrescribedSet,
  Session,
} from '../src/model';
import {
  convertLoad,
  entryContext,
  entryPrefill,
  rowTargets,
  stepAmount,
  targetAmount,
  type EntryContext,
} from '../src/ui/entry';
import { DEFAULT_PREFS } from '../src/ui/prefs';

const set = (over: Partial<PerformedSet> = {}): PerformedSet => ({
  id: crypto.randomUUID(),
  prescribed_id: null,
  state: 'pending',
  reps: null,
  rpe: null,
  load: null,
  is_warmup: false,
  notes: null,
  ...over,
});

const target = (over: Partial<PrescribedSet> = {}): PrescribedSet => ({
  id: crypto.randomUUID(),
  reps: [5, 5],
  rpe: [8, 8],
  load: { kind: 'weight', weight: { mode: 'absolute', kg: [100, 100] } },
  is_warmup: false,
  notes: null,
  ...over,
});

/** What format 2 adds to an exercise; spread, so this fixture compiles before and after it. */
const FORMAT_2 = { rest_s: null };

const instance = (
  performed: PerformedSet[],
  prescribed: PrescribedSet[] = [],
): ExerciseInstance => ({
  ...FORMAT_2,
  id: 'i',
  exercise_id: 'low_bar_squat',
  prescribed,
  performed,
  notes: null,
});

const ctx = (over: Partial<EntryContext> = {}): EntryContext => ({
  date: '2026-10-05',
  oneRms: [],
  unit: 'kg',
  step: 2.5,
  suggestion: null,
  ...over,
});

const kg = (value: number) => ({ kind: 'weight' as const, value, unit: 'kg' as const });

describe('what the entry panel starts from', () => {
  it('is the set itself when it holds numbers', () => {
    const s = set({ load: kg(92.5), reps: 3, rpe: 8 });
    expect(entryPrefill(instance([s]), s, ctx())).toEqual({ amount: 92.5, reps: 3 });
  });

  it('is the target when the set is empty', () => {
    const p = target();
    const s = set({ prescribed_id: p.id });
    expect(entryPrefill(instance([s], [p]), s, ctx())).toEqual({ amount: 100, reps: 5 });
  });

  it('takes the low end of a rep range', () => {
    const p = target({ reps: [3, 5] });
    const s = set({ prescribed_id: p.id });
    expect(entryPrefill(instance([s], [p]), s, ctx()).reps).toBe(3);
  });

  it('falls back to the set before for what the target leaves open', () => {
    const p = target({ load: { kind: 'weight', weight: { mode: 'rpe_driven' } } });
    const first = set({ load: kg(80), reps: 5, rpe: 7, state: 'done' });
    const second = set({ prescribed_id: p.id });
    expect(entryPrefill(instance([first, second], [p]), second, ctx())).toEqual({
      amount: 80,
      reps: 5,
    });
  });

  it('converts the set before when it was in the other unit, never carrying its number across', () => {
    const lb = { kind: 'weight' as const, value: 225, unit: 'lb' as const };
    const first = set({ load: lb, reps: 5, rpe: 7, state: 'done' });
    const second = set();
    expect(entryPrefill(instance([first, second]), second, ctx())).toEqual({
      amount: 102.5,
      reps: 5,
    });
  });

  it('drops a pin setting from the set before: it is no weight', () => {
    const pins = { kind: 'weight' as const, value: 7, unit: 'pins' as const };
    const first = set({ load: pins, reps: 10, rpe: 7, state: 'done' });
    const second = set();
    expect(entryPrefill(instance([first, second]), second, ctx())).toEqual({
      amount: null,
      reps: 10,
    });
  });

  it('starts from nothing for the first set of a new exercise', () => {
    const s = set();
    expect(entryPrefill(instance([s]), s, ctx())).toEqual({ amount: null, reps: null });
  });

  it('reads a timed target in seconds', () => {
    const p = target({ reps: null, load: { kind: 'time', seconds: [60, 60] } });
    const s = set({ prescribed_id: p.id });
    expect(entryPrefill(instance([s], [p]), s, ctx())).toEqual({ amount: 60, reps: null });
  });
});

describe('a percentage target', () => {
  const pct = (lift: 'squat' | 'bench' | 'deadlift' = 'squat') =>
    target({ load: { kind: 'weight', weight: { mode: 'pct_1rm', pct: [0.85, 0.85], lift } } });
  const maxes = [
    { date: '2026-08-01', lift: 'squat' as const, weight_kg: 150, note: null },
    { date: '2026-10-01', lift: 'squat' as const, weight_kg: 160, note: null },
    { date: '2026-10-20', lift: 'squat' as const, weight_kg: 170, note: null },
  ];

  it('resolves against the max in force on the session date, rounded to the plates', () => {
    const p = pct();
    const s = set({ prescribed_id: p.id });
    // 0.85 x 160 = 136, to the nearest 2.5 is 135; the 170 entered later is not in force yet.
    expect(entryPrefill(instance([s], [p]), s, ctx({ oneRms: maxes }))).toEqual({
      amount: 135,
      reps: 5,
    });
  });

  it("rounds to the lifter's plate step, not a fixed one", () => {
    const p = pct();
    const s = set({ prescribed_id: p.id });
    const at = (step: number, oneRms = maxes) =>
      targetAmount(instance([s], [p]), s, ctx({ oneRms, step }));
    expect(at(5)).toBe(135);
    expect(at(1.25)).toBe(136.25);
    // 0.85 x 150 on the older max is 127.5: a 5 kg step takes it to 130.
    expect(at(5, [maxes[0]])).toBe(130);
  });

  it('names nothing while no max is in force, so the next source answers', () => {
    const p = pct();
    const s = set({ prescribed_id: p.id });
    const suggestion = { load: 120, unit: 'kg' as const, delta: 2.5, reason: '+2.5: x' };
    expect(entryPrefill(instance([s], [p]), s, ctx({ suggestion })).amount).toBe(120);
  });
});

describe('the order of what the panel starts from', () => {
  const suggestion = { load: 92.5, unit: 'kg' as const, delta: 2.5, reason: '+2.5: x' };

  it('puts the suggested weight before the set before it', () => {
    const p = target({ load: { kind: 'weight', weight: { mode: 'rpe_driven' } } });
    const first = set({ load: kg(80), reps: 5, rpe: 7, state: 'done' });
    const second = set({ prescribed_id: p.id });
    expect(entryPrefill(instance([first, second], [p]), second, ctx({ suggestion }))).toEqual({
      amount: 92.5,
      reps: 5,
    });
  });

  it('puts the target before the suggestion', () => {
    const p = target();
    const s = set({ prescribed_id: p.id });
    expect(entryPrefill(instance([s], [p]), s, ctx({ suggestion })).amount).toBe(100);
  });

  it("puts the set's own numbers before everything", () => {
    const s = set({ load: kg(70) });
    expect(entryPrefill(instance([s]), s, ctx({ suggestion })).amount).toBe(70);
  });

  it('never offers an RPE', () => {
    const s = set();
    expect(entryPrefill(instance([s]), s, ctx({ suggestion }))).not.toHaveProperty('rpe');
  });
});

describe('the faint figures of an empty row', () => {
  it('shows the resolved load, the reps as written and the target RPE', () => {
    const p = target({ reps: [3, 5], rpe: [7, 8] });
    const s = set({ prescribed_id: p.id });
    expect(rowTargets(instance([s], [p]), s, ctx(), false)).toEqual({
      amount: '100',
      reps: '3-5',
      rpe: '7-8',
    });
  });

  it('falls back to the suggested weight when the target names none', () => {
    const s = set();
    const suggestion = { load: 92.5, unit: 'kg' as const, delta: 2.5, reason: '+2.5: x' };
    expect(rowTargets(instance([s]), s, ctx({ suggestion }), false).amount).toBe('92.5');
  });

  it('writes a timed target as a clock', () => {
    const p = target({ reps: null, load: { kind: 'time', seconds: [75, 75] } });
    const s = set({ prescribed_id: p.id });
    expect(rowTargets(instance([s], [p]), s, ctx(), true).amount).toBe('1:15');
  });

  it('is empty for a set with nothing to go on', () => {
    const s = set();
    expect(rowTargets(instance([s]), s, ctx(), false)).toEqual({ amount: '', reps: '', rpe: '' });
  });
});

describe('the context of a set', () => {
  const exercise: Exercise = {
    id: 'low_bar_squat',
    name: 'Low-Bar Squat',
    base_lift: 'squat',
    tier: 'comp',
    unilateral: false,
    load_type: 'external',
    default_unit: 'kg',
    muscles: { primary: [], aux: [] },
  };
  const session = (id: string, date: string, exercises: ExerciseInstance[]): Session => ({
    id,
    date,
    started_at: `${date}T17:00:00Z`,
    tz: 'Europe/Lisbon',
    time_precision: 'instant',
    ended_at: null,
    label: { name: null, block: null, week: null, day: null, weekday: null },
    bodyweight_kg: null,
    notes: null,
    exercises,
    created_at: '',
    updated_at: '',
    device_id: 'phone',
  });

  it("steps by the lifter's plate for the unit and suggests from last time", () => {
    const lastTime = set({ load: kg(90), reps: 5, rpe: 8, state: 'done' });
    const before = session('before', '2026-10-01', [instance([lastTime])]);
    const s = set();
    const got = entryContext({
      session: session('now', '2026-10-05', []),
      instance: instance([s]),
      set: s,
      exercise,
      sessions: [before],
      oneRms: [],
      prefs: { ...DEFAULT_PREFS, plateKg: 1.25 },
    });
    expect(got).toMatchObject({ unit: 'kg', step: 1.25, date: '2026-10-05' });
    expect(got.suggestion).toMatchObject({ load: 92.5, delta: 2.5 });
  });

  it("enters a set in today's unit, not last time's, and converts last time's suggestion", () => {
    const lb = (value: number) => ({ kind: 'weight' as const, value, unit: 'lb' as const });
    const lastTime = set({ load: lb(225), reps: 5, rpe: 7, state: 'done' });
    const before = session('before', '2026-10-01', [instance([lastTime])]);
    const today = set({ load: kg(100), reps: 5, rpe: 7, state: 'done' });
    const s = set();
    const got = entryContext({
      session: session('now', '2026-10-05', [instance([today, s])]),
      instance: instance([today, s]),
      set: s,
      exercise,
      sessions: [before],
      oneRms: [],
      prefs: DEFAULT_PREFS,
    });
    expect(got).toMatchObject({ unit: 'kg', step: DEFAULT_PREFS.plateKg });
    // 225 lb at RPE 7 with no target is +5 lb: 230 lb, which is 104.3 kg, on the plates.
    expect(got.suggestion).toMatchObject({ load: 105, unit: 'kg' });
    expect(got.suggestion?.reason).toMatch(/^\+5 lb: /);
  });

  it('has no suggestion for an exercise the library lacks', () => {
    const s = set();
    const got = entryContext({
      session: session('now', '2026-10-05', []),
      instance: instance([s]),
      set: s,
      exercise: undefined,
      sessions: [],
      oneRms: [],
      prefs: DEFAULT_PREFS,
    });
    expect(got.suggestion).toBeNull();
  });
});

describe('a load in the other unit', () => {
  it('converts kilograms and pounds onto the plates of the unit converted to', () => {
    expect(convertLoad(100, 'kg', 'lb', 5)).toBe(220);
    expect(convertLoad(225, 'lb', 'kg', 2.5)).toBe(102.5);
    expect(convertLoad(92.5, 'kg', 'kg', 2.5)).toBe(92.5);
  });

  it('converts nothing to or from a pin setting', () => {
    expect(convertLoad(7, 'pins', 'kg', 2.5)).toBeNull();
    expect(convertLoad(100, 'kg', 'pins', 1)).toBeNull();
  });
});

describe('one tap of − or +', () => {
  const weight = { measure: 'weight' as const, step: 2.5 };
  const time = { measure: 'time' as const, step: 5 };

  it('moves a weight by the plate step, onto its grid, never below zero', () => {
    expect(stepAmount(92.5, 1, weight)).toBe(95);
    expect(stepAmount(92.5, -1, weight)).toBe(90);
    expect(stepAmount(101, 1, weight)).toBe(102.5);
    expect(stepAmount(1, -1, weight)).toBe(0);
    expect(stepAmount(0, -1, weight)).toBe(0);
  });

  it('lets a bodyweight-plus load go negative: that is assistance', () => {
    expect(stepAmount(0, -1, { ...weight, min: -Infinity })).toBe(-2.5);
  });

  it('moves time by 5 s up to a minute and by 15 s beyond it', () => {
    expect(stepAmount(45, 1, time)).toBe(50);
    expect(stepAmount(55, 1, time)).toBe(60);
    expect(stepAmount(60, 1, time)).toBe(75);
    expect(stepAmount(75, -1, time)).toBe(60);
    expect(stepAmount(60, -1, time)).toBe(55);
    expect(stepAmount(5, -1, time)).toBe(0);
    expect(stepAmount(0, -1, time)).toBe(0);
  });

  it('puts a typed time that is off the grid onto it', () => {
    expect(stepAmount(47, 1, time)).toBe(55);
    expect(stepAmount(47, -1, time)).toBe(40);
  });
});
