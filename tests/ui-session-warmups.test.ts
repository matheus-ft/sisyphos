import { describe, expect, it } from 'vitest';
import type { Exercise, ExerciseInstance, PerformedSet, Session } from '../src/model';
import type { EntryContext } from '../src/ui/entry';
import {
  addWarmups,
  hiddenKey,
  parseHidden,
  serializeHidden,
  warmupPlan,
} from '../src/ui/session/warmups';

let n = 0;
const kg = (value: number) => ({ kind: 'weight' as const, value, unit: 'kg' as const });
const set = (over: Partial<PerformedSet> = {}): PerformedSet => ({
  id: `s${n++}`,
  prescribed_id: null,
  state: 'pending',
  reps: null,
  rpe: null,
  load: null,
  is_warmup: false,
  notes: null,
  ...over,
});
const instance = (performed: PerformedSet[]): ExerciseInstance => ({
  id: 'i',
  exercise_id: 'bench',
  rest_s: null,
  prescribed: [],
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
const bench = { id: 'bench', load_type: 'external' } as Exercise;

describe('the warm-up suggestion', () => {
  it('climbs toward the first working weight', () => {
    const plan = warmupPlan({
      instance: instance([set({ load: kg(100), reps: 5 })]),
      exercise: bench,
      ctx: ctx(),
    });
    expect(plan?.working).toBe(100);
    expect(plan?.rungs.map((r) => r.load)).toEqual([20, 40, 60, 80]);
  });

  it('takes the working weight from the target, then the suggested weight', () => {
    const suggestion = { load: 92.5, unit: 'kg' as const, delta: 2.5, reason: 'x' };
    const plan = warmupPlan({
      instance: instance([set()]),
      exercise: bench,
      ctx: ctx({ suggestion }),
    });
    expect(plan?.working).toBe(92.5);
  });

  it('offers nothing without a working load', () => {
    expect(warmupPlan({ instance: instance([set()]), exercise: bench, ctx: ctx() })).toBeNull();
  });

  it('offers nothing for bodyweight, timed or pin work', () => {
    const i = instance([set({ load: kg(20), reps: 8 })]);
    const dips = { id: 'dips', load_type: 'bw_plus' } as Exercise;
    expect(warmupPlan({ instance: i, exercise: dips, ctx: ctx() })).toBeNull();
    expect(warmupPlan({ instance: i, exercise: undefined, ctx: ctx() })).toBeNull();
    expect(
      warmupPlan({
        instance: instance([set({ load: { kind: 'weight', value: 5, unit: 'pins' }, reps: 8 })]),
        exercise: bench,
        ctx: ctx({ unit: 'pins' }),
      }),
    ).toBeNull();
  });

  it('is over once a working set is done', () => {
    const i = instance([
      set({ state: 'done', load: kg(100), reps: 5, rpe: 8 }),
      set({ load: kg(100), reps: 5 }),
    ]);
    expect(warmupPlan({ instance: i, exercise: bench, ctx: ctx() })).toBeNull();
  });

  it('drops the rungs already in the list, and is over when all are', () => {
    const w = (load: number) => set({ is_warmup: true, load: kg(load), reps: 5 });
    const working = set({ load: kg(100), reps: 5 });
    const some = warmupPlan({
      instance: instance([w(40), w(60), working]),
      exercise: bench,
      ctx: ctx(),
    });
    expect(some?.rungs.map((r) => r.load)).toEqual([20, 80]);
    const all = instance([w(20), w(40), w(60), w(80), working]);
    expect(warmupPlan({ instance: all, exercise: bench, ctx: ctx() })).toBeNull();
  });

  it('is short for a light weight', () => {
    const plan = warmupPlan({
      instance: instance([set({ load: kg(40), reps: 5 })]),
      exercise: bench,
      ctx: ctx(),
    });
    expect(plan?.rungs.map((r) => r.load)).toEqual([20, 25, 32.5]);
  });
});

describe('adding warm-ups', () => {
  const session = (i: ExerciseInstance) => ({ exercises: [i] }) as Session;
  const working = set({ load: kg(100), reps: 5 });
  const plan = warmupPlan({ instance: instance([working]), exercise: bench, ctx: ctx() })!;

  it('adds the whole ladder ahead of the working set, pending with numbers filled', () => {
    let k = 0;
    const next = addWarmups(session(instance([working])), 'i', plan, plan.rungs, () => `w${k++}`);
    const sets = next.exercises[0].performed;
    expect(sets.map((s) => (s.load?.kind === 'weight' ? s.load.value : null))).toEqual([
      20, 40, 60, 80, 100,
    ]);
    expect(sets.slice(0, 4).every((s) => s.is_warmup && s.state === 'pending')).toBe(true);
    expect(sets[4]).toEqual(working);
  });

  it('adds one rung', () => {
    let k = 0;
    const next = addWarmups(
      session(instance([working])),
      'i',
      plan,
      [plan.rungs[2]],
      () => `w${k++}`,
    );
    const sets = next.exercises[0].performed;
    expect(sets).toHaveLength(2);
    expect(sets[0]).toMatchObject({ is_warmup: true, load: kg(60), reps: 3 });
  });
});

describe('hiding the suggestion for the session', () => {
  it('is kept per session and read back', () => {
    expect(hiddenKey('s1')).toBe('sisyphos.warmups.s1');
    expect([...parseHidden(serializeHidden(new Set(['a', 'b'])))]).toEqual(['a', 'b']);
  });

  it('reads junk as nothing hidden', () => {
    expect(parseHidden(null).size).toBe(0);
    expect(parseHidden('{not json').size).toBe(0);
    expect(parseHidden('{"a":1}').size).toBe(0);
    expect([...parseHidden('["a", 3, null]')]).toEqual(['a']);
  });
});
