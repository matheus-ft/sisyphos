import { describe, expect, it } from 'vitest';
import { isComplete } from '../src/model';
import { addExercise, addSet, editSet } from '../src/ui/session';
import { BAR, insertWarmups, warmupLadder, warmupSets } from '../src/ui/warmup';
import { byId, ids, sessionOn, withSets } from './ui-fixtures';

const squat = byId('low_bar_squat');
const loads = (working: number, unit: 'kg' | 'lb' = 'kg', step = 2.5) =>
  warmupLadder(working, unit, step).map((r) => r.load);

describe('the warm-up ladder', () => {
  it('climbs from the bar through 40, 60 and 80% of the working weight', () => {
    expect(warmupLadder(140, 'kg', 2.5)).toEqual([
      { load: 20, reps: 8 },
      { load: 55, reps: 5 },
      { load: 85, reps: 3 },
      { load: 112.5, reps: 2 },
    ]);
  });

  it('falls in reps as the weight rises', () => {
    const reps = warmupLadder(180, 'kg', 2.5).map((r) => r.reps);
    expect(reps).toEqual([...reps].sort((a, b) => b - a));
  });

  it('rounds each rung to the plates in use', () => {
    expect(loads(137.5, 'kg', 2.5)).toEqual([20, 55, 82.5, 110]);
    expect(loads(137.5, 'kg', 1.25)).toEqual([20, 55, 82.5, 110]);
    expect(loads(135, 'kg', 5)).toEqual([20, 55, 80, 110]);
  });

  it('keeps every rung on the grid, strictly rising and below the working weight', () => {
    for (let w = 22.5; w <= 300; w += 2.5) {
      const l = loads(w);
      for (let i = 1; i < l.length; i++) expect(l[i]).toBeGreaterThan(l[i - 1]);
      expect(l.at(-1)!).toBeLessThan(w);
      expect(l[0]).toBe(20);
    }
  });

  it('is shorter for a light weight', () => {
    expect(loads(40)).toEqual([20, 25, 32.5]);
    expect(loads(30)).toEqual([20, 25]);
    expect(loads(25)).toEqual([20]);
    expect(loads(22.5)).toEqual([20]);
    expect(loads(140).length).toBeGreaterThan(loads(40).length);
  });

  it('is nothing at or below the bar', () => {
    expect(loads(20)).toEqual([]);
    expect(loads(15)).toEqual([]);
    expect(loads(0)).toEqual([]);
    expect(loads(-10)).toEqual([]);
    expect(loads(Number.NaN)).toEqual([]);
  });

  it('uses the pound bar and pound plates', () => {
    expect(BAR.lb).toBe(45);
    expect(loads(315, 'lb', 5)).toEqual([45, 125, 190, 250]);
    expect(loads(95, 'lb', 5)).toEqual([45, 55, 75]);
    expect(loads(45, 'lb', 5)).toEqual([]);
  });
});

describe('warm-up sets', () => {
  it('are pending warm-ups with their numbers filled, for the lifter to mark Done', () => {
    const sets = warmupSets(140, 'kg', 2.5, ids());
    expect(sets).toHaveLength(4);
    for (const s of sets) {
      expect(s).toMatchObject({
        is_warmup: true,
        state: 'pending',
        rpe: null,
        prescribed_id: null,
      });
      // Done needs no RPE: the numbers alone complete it.
      expect(isComplete({ ...s })).toBe(true);
    }
    expect(sets.map((s) => s.load)).toEqual([
      { kind: 'weight', value: 20, unit: 'kg' },
      { kind: 'weight', value: 55, unit: 'kg' },
      { kind: 'weight', value: 85, unit: 'kg' },
      { kind: 'weight', value: 112.5, unit: 'kg' },
    ]);
    expect(new Set(sets.map((s) => s.id)).size).toBe(4);
  });

  it('are done through editSet like any warm-up, and then stay out of the working sets', () => {
    const newId = ids();
    let s = addExercise(sessionOn(4), squat, newId);
    const sets = warmupSets(100, 'kg', 2.5, newId);
    s = insertWarmups(s, s.exercises[0].id, sets);
    const first = s.exercises[0].performed[0];
    s = editSet(s, s.exercises[0].id, first.id, { amount: 20, reps: 8 }, 'weight', 'kg');
    expect(s.exercises[0].performed[0].state).toBe('done');
    expect(s.exercises[0].performed[0].is_warmup).toBe(true);
  });
});

describe('adding warm-ups to an exercise', () => {
  it('puts them ahead of the first working set, keeping the blank one', () => {
    const newId = ids();
    let s = addExercise(sessionOn(4), squat, newId);
    const blank = s.exercises[0].performed[0];
    s = insertWarmups(s, s.exercises[0].id, warmupSets(100, 'kg', 2.5, newId));
    const performed = s.exercises[0].performed;
    expect(performed.map((p) => p.is_warmup)).toEqual([true, true, true, true, false]);
    expect(performed.at(-1)).toBe(blank);
  });

  it('keeps the warm-ups to do climbing when rungs are added one at a time, heavy first', () => {
    const newId = ids();
    let s = addExercise(sessionOn(4), squat, newId);
    const id = s.exercises[0].id;
    const [bar, , rung85] = warmupSets(140, 'kg', 2.5, newId);
    s = insertWarmups(s, id, [rung85]);
    s = insertWarmups(s, id, [bar]);
    const performed = s.exercises[0].performed;
    expect(performed.map((p) => (p.load?.kind === 'weight' ? p.load.value : null))).toEqual([
      20,
      85,
      null,
    ]);
    expect(performed.at(-1)?.is_warmup).toBe(false);
  });

  it('slots a rung between those to do, after the warm-ups already done', () => {
    const newId = ids();
    let s = withSets(sessionOn(4), squat, [{ amount: 20, reps: 8, warmup: true }], newId);
    const id = s.exercises[0].id;
    s = addSet(s, id, newId);
    const working = s.exercises[0].performed.at(-1)!;
    s = editSet(s, id, working.id, { is_warmup: false, amount: null }, 'weight', 'kg');
    const [, rung55, rung85, rung112] = warmupSets(140, 'kg', 2.5, newId);
    s = insertWarmups(s, id, [rung112]);
    s = insertWarmups(s, id, [rung55, rung85]);
    const weights = s.exercises[0].performed.map((p) =>
      p.load?.kind === 'weight' ? p.load.value : null,
    );
    expect(weights).toEqual([20, 55, 85, 112.5, null]);
    expect(s.exercises[0].performed[0].state).toBe('done');
  });

  it('goes after warm-ups already there, and before the working sets already logged', () => {
    const newId = ids();
    let s = withSets(sessionOn(4), squat, [
      { amount: 20, reps: 8, warmup: true },
      { amount: 100, reps: 5, rpe: 8 },
    ]);
    const before = s.exercises[0].performed;
    s = insertWarmups(s, s.exercises[0].id, warmupSets(100, 'kg', 2.5, newId).slice(1));
    const performed = s.exercises[0].performed;
    expect(performed[0]).toBe(before[0]);
    expect(performed.at(-1)).toBe(before[1]);
    expect(performed.filter((p) => p.is_warmup)).toHaveLength(4);
  });

  it('appends when the exercise holds only warm-ups, and leaves other exercises alone', () => {
    const newId = ids();
    let s = withSets(sessionOn(4), squat, [{ amount: 20, reps: 8, warmup: true }], newId);
    s = addExercise(s, byId('bench'), newId);
    const [a, b] = s.exercises;
    const next = insertWarmups(s, a.id, warmupSets(100, 'kg', 2.5, newId).slice(1));
    expect(next.exercises[0].performed.map((p) => p.is_warmup)).toEqual([true, true, true, true]);
    expect(next.exercises[1]).toBe(b);
  });

  it('does not touch the session it was given', () => {
    const newId = ids();
    const s = addExercise(sessionOn(4), squat, newId);
    insertWarmups(s, s.exercises[0].id, warmupSets(100, 'kg', 2.5, newId));
    expect(s.exercises[0].performed).toHaveLength(1);
  });
});
