import { describe, expect, it } from 'vitest';
import type { LoadPrescription, OneRmEntry, Session, Template } from '../src/model';
import { editSet, fromTemplate } from '../src/ui/session';
import { addTarget, addTemplateExercise, editTarget, newTemplate } from '../src/ui/template';
import {
  lastComparable,
  oneRmInForce,
  progress,
  resolveLoad,
  roundToPlate,
  stepLoad,
  suggestLoad,
  targetRpeOf,
} from '../src/ui/suggest';
import { byId, ids, sessionOn, withSets } from './ui-fixtures';

const squat = byId('low_bar_squat');
const bench = byId('bench');
const plank = byId('plank');
const pinMachine = byId('adductor_machine');
const dips = byId('dips');

describe('plate rounding', () => {
  it('rounds to the nearest plate, halves up', () => {
    expect(roundToPlate(101, 2.5)).toBe(100);
    expect(roundToPlate(101.3, 2.5)).toBe(102.5);
    expect(roundToPlate(43.75, 2.5)).toBe(45);
    expect(roundToPlate(91, 1.25)).toBe(91.25);
    expect(roundToPlate(227.4, 5)).toBe(225);
  });

  it('rounds a negative load the way its mirror rounds', () => {
    expect(roundToPlate(-43.75, 2.5)).toBe(-45);
    expect(roundToPlate(-101, 2.5)).toBe(-100);
  });

  it('leaves the value alone for a step that is no step', () => {
    expect(roundToPlate(101, 0)).toBe(101);
    expect(roundToPlate(101, -2.5)).toBe(101);
    expect(roundToPlate(Number.NaN, 2.5)).toBeNaN();
  });

  it('does not leave float noise', () => {
    expect(roundToPlate(100 * 0.7 * 1.0000001, 1.25)).toBe(70);
    expect(roundToPlate(3 * 1.25, 1.25)).toBe(3.75);
  });
});

describe('stepping a load', () => {
  it('moves a load on the grid by a step', () => {
    expect(stepLoad(100, 2.5, 1)).toBe(102.5);
    expect(stepLoad(100, 2.5, -1)).toBe(97.5);
    expect(stepLoad(60, 1.25, 1)).toBe(61.25);
    expect(stepLoad(135, 5, -1)).toBe(130);
  });

  it('snaps a load off the grid to the next one in that direction', () => {
    expect(stepLoad(101, 2.5, 1)).toBe(102.5);
    expect(stepLoad(101, 2.5, -1)).toBe(100);
    expect(stepLoad(0.5, 2.5, -1)).toBe(0);
  });

  it('stops at zero, or at the given floor for assisted work', () => {
    expect(stepLoad(0, 2.5, -1)).toBe(0);
    expect(stepLoad(1, 2.5, -1)).toBe(0);
    expect(stepLoad(0, 2.5, -1, -Infinity)).toBe(-2.5);
    expect(stepLoad(-10, 2.5, -1, -20)).toBe(-12.5);
  });

  it('survives repeated steps without drifting', () => {
    let v = 0;
    for (let i = 0; i < 100; i++) v = stepLoad(v, 1.25, 1);
    expect(v).toBe(125);
  });
});

describe('the reference max in force', () => {
  const entries: OneRmEntry[] = [
    { date: '2026-01-10', lift: 'squat', weight_kg: 180, note: null },
    { date: '2026-06-01', lift: 'squat', weight_kg: 190, note: null },
    { date: '2026-06-01', lift: 'squat', weight_kg: 192.5, note: null },
    { date: '2026-03-01', lift: 'bench', weight_kg: 120, note: null },
  ];

  it('is the latest entry dated on or before the date, for that lift', () => {
    expect(oneRmInForce(entries, 'squat', '2026-05-31')?.weight_kg).toBe(180);
    expect(oneRmInForce(entries, 'squat', '2026-06-01')?.weight_kg).toBe(192.5);
    expect(oneRmInForce(entries, 'squat', '2026-12-01')?.weight_kg).toBe(192.5);
    expect(oneRmInForce(entries, 'bench', '2026-12-01')?.weight_kg).toBe(120);
  });

  it('is nothing before the first entry or for a lift without one', () => {
    expect(oneRmInForce(entries, 'squat', '2026-01-09')).toBeNull();
    expect(oneRmInForce(entries, 'deadlift', '2026-12-01')).toBeNull();
    expect(oneRmInForce([], 'squat', '2026-12-01')).toBeNull();
  });

  it('does not depend on the order of the entries', () => {
    expect(oneRmInForce([...entries].reverse().slice(1), 'squat', '2026-05-31')?.weight_kg).toBe(
      180,
    );
  });
});

describe('resolving a prescription to a load', () => {
  const oneRms: OneRmEntry[] = [
    { date: '2026-01-01', lift: 'squat', weight_kg: 200, note: null },
    { date: '2026-09-01', lift: 'squat', weight_kg: 210, note: null },
  ];
  const kg = { date: '2026-08-15', oneRms, unit: 'kg' as const, step: 2.5 };
  const weight = (w: LoadPrescription): LoadPrescription => w;

  it('reads an absolute interval as its low bound and its top', () => {
    const p = weight({ kind: 'weight', weight: { mode: 'absolute', kg: [100, 110] } });
    expect(resolveLoad(p, kg)).toEqual({
      kind: 'weight',
      value: 100,
      high: 110,
      unit: 'kg',
      added: false,
    });
    const exact = weight({ kind: 'weight', weight: { mode: 'absolute', kg: [92.5, 92.5] } });
    expect(resolveLoad(exact, kg)).toMatchObject({ value: 92.5, high: null });
  });

  it("keeps the lifter's kilograms as written, even off the plate grid", () => {
    const p = weight({ kind: 'weight', weight: { mode: 'absolute', kg: [91, 91] } });
    expect(resolveLoad(p, kg)).toMatchObject({ value: 91 });
  });

  it('resolves a percentage against the max in force on the session date, rounded to plates', () => {
    const p = weight({
      kind: 'weight',
      weight: { mode: 'pct_1rm', pct: [0.8, 0.8], lift: 'squat' },
    });
    // 80% of 200, not of the 210 set later.
    expect(resolveLoad(p, kg)).toMatchObject({ kind: 'weight', value: 160, unit: 'kg' });
    expect(resolveLoad(p, { ...kg, date: '2026-09-01' })).toMatchObject({ value: 167.5 });
    expect(resolveLoad(p, { ...kg, step: 5 })).toMatchObject({ value: 160 });
    expect(resolveLoad(p, { ...kg, date: '2026-09-01', step: 5 })).toMatchObject({ value: 170 });
  });

  it('resolves a percentage range to both ends', () => {
    const p = weight({
      kind: 'weight',
      weight: { mode: 'pct_1rm', pct: [0.75, 0.85], lift: 'squat' },
    });
    expect(resolveLoad(p, kg)).toMatchObject({ value: 150, high: 170 });
  });

  it('has no load for a percentage with no max in force yet', () => {
    const p = weight({
      kind: 'weight',
      weight: { mode: 'pct_1rm', pct: [0.8, 0.8], lift: 'squat' },
    });
    expect(resolveLoad(p, { ...kg, date: '2025-12-31' })).toEqual({ kind: 'none', why: 'no_max' });
    const bench = weight({
      kind: 'weight',
      weight: { mode: 'pct_1rm', pct: [0.8, 0.8], lift: 'bench' },
    });
    expect(resolveLoad(bench, kg)).toEqual({ kind: 'none', why: 'no_max' });
  });

  it('has no load for an RPE-driven set, an open interval, or no prescription', () => {
    expect(resolveLoad({ kind: 'weight', weight: { mode: 'rpe_driven' } }, kg)).toEqual({
      kind: 'none',
      why: 'rpe_driven',
    });
    const open = weight({ kind: 'weight', weight: { mode: 'absolute', kg: [null, null] } });
    expect(resolveLoad(open, kg)).toEqual({ kind: 'none', why: 'open' });
    expect(resolveLoad(null, kg)).toEqual({ kind: 'none', why: 'open' });
    expect(resolveLoad(undefined, kg)).toEqual({ kind: 'none', why: 'open' });
  });

  it('marks bodyweight-plus loads as added', () => {
    const p = weight({ kind: 'weight', weight: { mode: 'bw_plus', added_kg: [20, 20] } });
    expect(resolveLoad(p, kg)).toMatchObject({ value: 20, added: true });
    const assisted = weight({ kind: 'weight', weight: { mode: 'bw_plus', added_kg: [-10, -10] } });
    expect(resolveLoad(assisted, kg)).toMatchObject({ value: -10, added: true });
  });

  it('reads a timed prescription as seconds', () => {
    expect(resolveLoad({ kind: 'time', seconds: [60, 90] }, kg)).toEqual({
      kind: 'time',
      seconds: 60,
      high: 90,
    });
    expect(resolveLoad({ kind: 'time', seconds: [null, null] }, kg)).toEqual({
      kind: 'none',
      why: 'open',
    });
  });

  it('converts to pounds and rounds to the pound plates', () => {
    const lb = { ...kg, unit: 'lb' as const, step: 5 };
    const abs = weight({ kind: 'weight', weight: { mode: 'absolute', kg: [100, 100] } });
    expect(resolveLoad(abs, lb)).toMatchObject({ value: 220, unit: 'lb' });
    const pct = weight({
      kind: 'weight',
      weight: { mode: 'pct_1rm', pct: [0.8, 0.8], lift: 'squat' },
    });
    // 160 kg is 352.7 lb, nearer 355 than 350.
    expect(resolveLoad(pct, lb)).toMatchObject({ value: 355, unit: 'lb' });
  });

  it('names no load in pins, which have no kilograms', () => {
    const abs = weight({ kind: 'weight', weight: { mode: 'absolute', kg: [50, 50] } });
    expect(resolveLoad(abs, { ...kg, unit: 'pins' })).toEqual({ kind: 'none', why: 'pins' });
  });

  it('has no load for distance work', () => {
    expect(resolveLoad({ kind: 'distance', meters: [100, 100] }, kg)).toEqual({
      kind: 'none',
      why: 'distance',
    });
  });

  it('resolves what a template session prescribes, end to end', () => {
    let t: Template = newTemplate({ id: 't', name: 'A', at: new Date(2026, 9, 1) });
    t = addTemplateExercise(t, squat);
    t = editTarget(t, 0, 0, { amount: 140, reps: 5, rpe: 8 }, 'weight');
    t = addTarget(t, 0, 'weight');
    const s = fromTemplate(sessionOn(4), t, ids());
    const [e] = s.exercises;
    const p = e.prescribed[1];
    expect(resolveLoad(p.load, kg)).toMatchObject({ value: 140 });
    expect(targetRpeOf(p)).toBe(8);
  });
});

describe('the progression rule', () => {
  /** A done working set of the given weight @ rpe, built through the session helpers. */
  function lastSet(amount: number, rpe: number, unit: 'kg' | 'lb' = 'kg') {
    const s = withSets(sessionOn(1), squat, [{ amount, reps: 5, rpe, unit }]);
    return s.exercises[0].performed[0];
  }

  it('adds 5 kg when 2 or more under the target', () => {
    expect(progress(lastSet(100, 6), 8)).toMatchObject({ load: 105, delta: 5 });
    expect(progress(lastSet(100, 5), 8)).toMatchObject({ load: 105, delta: 5 });
  });

  it('adds 2.5 kg when at the target or 1 under', () => {
    expect(progress(lastSet(100, 8), 8)).toMatchObject({ load: 102.5, delta: 2.5 });
    expect(progress(lastSet(100, 7), 8)).toMatchObject({ load: 102.5, delta: 2.5 });
    expect(progress(lastSet(100, 7.5), 8)).toMatchObject({ load: 102.5 });
  });

  it('reads 1.5 under as the smaller step', () => {
    expect(progress(lastSet(100, 6.5), 8)).toMatchObject({ load: 102.5 });
  });

  it('keeps the weight when over the target', () => {
    expect(progress(lastSet(100, 8.5), 8)).toMatchObject({ load: 100, delta: 0 });
    expect(progress(lastSet(100, 10), 8)).toMatchObject({ load: 100, delta: 0 });
  });

  it('steps in pounds by 10 and 5', () => {
    expect(progress(lastSet(225, 6, 'lb'), 8)).toMatchObject({ load: 235, unit: 'lb' });
    expect(progress(lastSet(225, 8, 'lb'), 8)).toMatchObject({ load: 230 });
    expect(progress(lastSet(225, 9, 'lb'), 8)).toMatchObject({ load: 225 });
  });

  it("takes last time's RPE as the target when there is none", () => {
    expect(progress(lastSet(100, 9), null)).toMatchObject({ load: 102.5 });
  });

  it('says why', () => {
    expect(progress(lastSet(100, 7.5), 8)?.reason).toBe('+2.5: last @7.5 for a target of 8');
    expect(progress(lastSet(100, 6), 8)?.reason).toBe('+5: last @6 for a target of 8');
    expect(progress(lastSet(100, 9), 8)?.reason).toBe('same: last @9 for a target of 8');
    expect(progress(lastSet(100, 9), null)?.reason).toBe('+2.5: last @9, no target');
    expect(progress(lastSet(225, 6, 'lb'), 8)?.reason).toBe('+10: last @6 for a target of 8');
  });

  it('adds without float noise', () => {
    expect(progress(lastSet(91.25, 8), 8)?.load).toBe(93.75);
  });

  it('has nothing to go on without a done working set', () => {
    const pending = withSets(sessionOn(1), squat, [{ amount: 100, reps: 5 }]).exercises[0]
      .performed[0];
    expect(progress(pending, 8)).toBeNull();
  });
});

describe('which set of last time answers to this one', () => {
  const last = () =>
    withSets(sessionOn(1), squat, [
      { amount: 60, reps: 5, warmup: true },
      { amount: 100, reps: 5, rpe: 7 },
      { amount: 105, reps: 5, rpe: 8 },
      { amount: 105, reps: 4, rpe: 9 },
      { amount: 95, reps: 8, rpe: 8 },
    ]).exercises[0];

  it('is the working set at the same position, warm-ups not counted', () => {
    expect(lastComparable(last(), 0)?.load).toMatchObject({ value: 100 });
    expect(lastComparable(last(), 1)?.load).toMatchObject({ value: 105 });
    expect(lastComparable(last(), 3)?.load).toMatchObject({ value: 95 });
  });

  it('falls back to the top set when last time had fewer, the later of equals', () => {
    const top = lastComparable(last(), 7)!;
    expect(top.load).toMatchObject({ value: 105 });
    expect(top.rpe).toBe(9);
  });

  it('is nothing when last time had no done working set', () => {
    const warmupOnly = withSets(sessionOn(1), squat, [{ amount: 60, reps: 5, warmup: true }]);
    expect(lastComparable(warmupOnly.exercises[0], 0)).toBeNull();
  });
});

describe("suggesting a set's weight", () => {
  /** Last Sunday's squats, and a session now with a set to fill. */
  function setup(opts: { rpe?: number[]; target?: number | null; sets?: number } = {}) {
    const rpes = opts.rpe ?? [7.5, 8, 8];
    const old = withSets(
      sessionOn(1),
      squat,
      rpes.map((rpe, i) => ({ amount: 100 + i * 5, reps: 5, rpe })),
    );
    let t = newTemplate({ id: 't', name: 'A', at: new Date(2026, 9, 1) });
    t = addTemplateExercise(t, squat);
    t = editTarget(
      t,
      0,
      0,
      { reps: 5, rpe: opts.target === undefined ? 8 : opts.target },
      'weight',
    );
    for (let i = 1; i < (opts.sets ?? 3); i++) t = addTarget(t, 0, 'weight');
    const now = fromTemplate(sessionOn(8), t, ids('n'));
    return { old, now };
  }

  const ask = (now: Session, old: Session, index: number, over: object = {}) => {
    const instance = now.exercises[0];
    return suggestLoad({
      exercise: squat,
      instance,
      set: instance.performed[index],
      sessions: [old, now],
      except: now.id,
      ...over,
    });
  };

  it("suggests each set from last time's set at the same position", () => {
    const { old, now } = setup();
    expect(ask(now, old, 0)).toMatchObject({
      load: 102.5,
      reason: '+2.5: last @7.5 for a target of 8',
    });
    expect(ask(now, old, 1)).toMatchObject({ load: 107.5 });
    expect(ask(now, old, 2)).toMatchObject({ load: 112.5 });
  });

  it("takes the target RPE from the set's own prescription, the top of a range", () => {
    const { old } = setup();
    let t = newTemplate({ id: 't', name: 'A', at: new Date(2026, 9, 1) });
    t = addTemplateExercise(t, squat);
    let now = fromTemplate(sessionOn(8), t, ids('n'));
    const p = now.exercises[0].prescribed[0];
    now = {
      ...now,
      exercises: [{ ...now.exercises[0], prescribed: [{ ...p, rpe: [7, 8.5] }] }],
    };
    // 7.5 against 8.5 is 1 under.
    expect(ask(now, old, 0)).toMatchObject({ reason: '+2.5: last @7.5 for a target of 8.5' });
  });

  it("uses last time's RPE as the target for a set with none", () => {
    const { old, now } = setup({ target: null });
    expect(ask(now, old, 0)).toMatchObject({ load: 102.5, reason: '+2.5: last @7.5, no target' });
  });

  it('works for sets with no prescription at all', () => {
    const { old } = setup();
    const now = withSets(sessionOn(8), squat, [{ amount: 100, reps: 5 }]);
    const instance = now.exercises[0];
    const got = suggestLoad({
      exercise: squat,
      instance,
      set: instance.performed[0],
      sessions: [old, now],
      except: now.id,
    });
    expect(got?.reason).toContain('no target');
  });

  it('suggests from the most recent other session, and never from the session itself', () => {
    const { old, now } = setup();
    const newer = withSets(sessionOn(5, 'mid'), squat, [{ amount: 120, reps: 5, rpe: 6 }]);
    expect(ask(now, old, 0, { sessions: [old, newer, now] })).toMatchObject({ load: 125 });
    expect(ask(now, old, 0, { sessions: [now] })).toBeNull();
  });

  it('suggests nothing for the first time an exercise is done', () => {
    const { now } = setup();
    expect(ask(now, sessionOn(1, 'empty'), 0)).toBeNull();
    const other = withSets(sessionOn(1), bench, [{ amount: 80, reps: 5, rpe: 8 }]);
    expect(ask(now, other, 0)).toBeNull();
  });

  it('never suggests for warm-ups', () => {
    const { old, now } = setup();
    const instance = now.exercises[0];
    const warm = editSet(
      now,
      instance.id,
      instance.performed[0].id,
      { is_warmup: true },
      'weight',
      'kg',
    );
    expect(ask(warm, old, 0)).toBeNull();
  });

  it('never suggests for pins, whether last time or now', () => {
    const pinned = withSets(sessionOn(1), pinMachine, [
      { amount: 8, reps: 12, rpe: 7, unit: 'pins' },
    ]);
    const now = withSets(sessionOn(8), pinMachine, [{ amount: 8, reps: 12, unit: 'pins' }]);
    const instance = now.exercises[0];
    const input = {
      exercise: pinMachine,
      instance,
      set: instance.performed[0],
      sessions: [pinned, now],
      except: now.id,
    };
    expect(suggestLoad(input)).toBeNull();
    const kgLast = withSets(sessionOn(1), pinMachine, [{ amount: 40, reps: 12, rpe: 7 }]);
    expect(suggestLoad({ ...input, sessions: [kgLast, now] })).toMatchObject({ load: 42.5 });
    expect(suggestLoad({ ...input, sessions: [kgLast, now], unit: 'pins' })).toBeNull();
  });

  it('never suggests for timed sets', () => {
    let old = sessionOn(1);
    old = withSets(old, plank, [{ amount: 60, reps: 1, rpe: 7 }]);
    const now = withSets(sessionOn(8), plank, [{ amount: 60, reps: 1 }]);
    const instance = now.exercises[0];
    expect(
      suggestLoad({
        exercise: plank,
        instance,
        set: instance.performed[0],
        sessions: [old, now],
        except: now.id,
      }),
    ).toBeNull();
  });

  it('suggests added load for bodyweight-plus work', () => {
    const old = withSets(sessionOn(1), dips, [{ amount: 20, reps: 8, rpe: 6 }]);
    const now = withSets(sessionOn(8), dips, [{ amount: 20, reps: 8 }]);
    const instance = now.exercises[0];
    expect(
      suggestLoad({
        exercise: dips,
        instance,
        set: instance.performed[0],
        sessions: [old, now],
        except: now.id,
      }),
    ).toMatchObject({ load: 22.5 });
  });

  it('suggests in the unit last time used', () => {
    const old = withSets(sessionOn(1), squat, [{ amount: 225, reps: 5, rpe: 6, unit: 'lb' }]);
    const now = withSets(sessionOn(8), squat, [{ amount: 225, reps: 5, unit: 'lb' }]);
    const instance = now.exercises[0];
    expect(
      suggestLoad({
        exercise: squat,
        instance,
        set: instance.performed[0],
        sessions: [old, now],
        except: now.id,
      }),
    ).toMatchObject({ load: 230, unit: 'lb' });
  });

  it('is nothing for a set that is not in the instance', () => {
    const { old, now } = setup();
    const stray = { ...now.exercises[0].performed[0], id: 'stray' };
    expect(ask(now, old, 0, { set: stray })).toBeNull();
  });
});
