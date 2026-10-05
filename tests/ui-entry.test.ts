import { describe, expect, it } from 'vitest';
import type { ExerciseInstance, PerformedSet, PrescribedSet } from '../src/model';
import { entryPrefill, plateStep } from '../src/ui/entry';

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

const kg = (value: number) => ({ kind: 'weight' as const, value, unit: 'kg' as const });

describe('what the entry panel starts from', () => {
  it('is the set itself when it holds numbers', () => {
    const s = set({ load: kg(92.5), reps: 3, rpe: 8 });
    expect(entryPrefill(instance([s]), s)).toEqual({ amount: 92.5, reps: 3 });
  });

  it('is the target when the set is empty', () => {
    const p = target();
    const s = set({ prescribed_id: p.id });
    expect(entryPrefill(instance([s], [p]), s)).toEqual({ amount: 100, reps: 5 });
  });

  it('takes the low end of a rep range', () => {
    const p = target({ reps: [3, 5] });
    const s = set({ prescribed_id: p.id });
    expect(entryPrefill(instance([s], [p]), s).reps).toBe(3);
  });

  it('falls back to the set before for what the target leaves open', () => {
    const p = target({ load: { kind: 'weight', weight: { mode: 'rpe_driven' } } });
    const first = set({ load: kg(80), reps: 5, rpe: 7, state: 'done' });
    const second = set({ prescribed_id: p.id });
    expect(entryPrefill(instance([first, second], [p]), second)).toEqual({ amount: 80, reps: 5 });
  });

  it('starts from nothing for the first set of a new exercise', () => {
    const s = set();
    expect(entryPrefill(instance([s]), s)).toEqual({ amount: null, reps: null });
  });

  it('reads a timed target in seconds', () => {
    const p = target({ reps: null, load: { kind: 'time', seconds: [60, 60] } });
    const s = set({ prescribed_id: p.id });
    expect(entryPrefill(instance([s], [p]), s)).toEqual({ amount: 60, reps: null });
  });
});

describe('the plate step', () => {
  it('is the smallest usual pair of plates for the unit', () => {
    expect(plateStep('kg')).toBe(2.5);
    expect(plateStep('lb')).toBe(5);
    expect(plateStep('pins')).toBe(1);
  });
});
