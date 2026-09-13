import { describe, it, expect } from 'vitest';
import { loadFactor, e1rm } from '../src/metrics/rpe-chart';
import { stressFor, setStressIndex, centralBalance, totalStress } from '../src/metrics/stress';
import { toKg, weightKg, effectiveLoadKg, setTonnageKg } from '../src/metrics/load';
import { isAmrap, formatInterval } from '../src/model';
import type { Exercise, PerformedSet } from '../src/model';

const ex = (over: Partial<Exercise> = {}): Exercise => ({
  id: 'squat',
  name: 'Low-Bar Squat',
  base_lift: 'squat',
  tier: 'comp',
  unilateral: false,
  load_type: 'external',
  default_unit: 'kg',
  muscles: { primary: ['vasti'], secondary: [], aux: [] },
  ...over,
});

const set = (over: Partial<PerformedSet> = {}): PerformedSet => ({
  id: 's1',
  prescribed_id: null,
  state: 'done',
  reps: 5,
  rpe: 8,
  load: { kind: 'weight', value: 100, unit: 'kg' },
  is_warmup: false,
  notes: null,
  ...over,
});

describe('RPE load chart', () => {
  it('matches the published chart', () => {
    expect(loadFactor(10, 1)).toBe(1.0);
    expect(loadFactor(8, 3)).toBe(0.863);
    expect(loadFactor(9, 5)).toBe(0.837);
  });

  it('rounds RPE to the nearest half point', () => {
    expect(loadFactor(8.4, 3)).toBe(loadFactor(8.5, 3));
    expect(loadFactor(7.9, 1)).toBe(loadFactor(8, 1));
  });

  it('returns null past the end of a ragged low-RPE row', () => {
    // The RPE 0 row genuinely stops at 8 reps.
    expect(loadFactor(0, 8)).not.toBeNull();
    expect(loadFactor(0, 9)).toBeNull();
  });

  it('survived the move from nested JSON to long-format CSV intact', () => {
    // 232 defined cells, not 21 x 12 = 252, because the low rows are short.
    let defined = 0;
    for (let r = 0; r <= 20; r++) {
      for (let n = 1; n <= 12; n++) if (loadFactor(r / 2, n) !== null) defined++;
    }
    expect(defined).toBe(232);
  });
});

describe('e1RM', () => {
  it('inverts the load factor', () => {
    expect(e1rm(150, 8, 3)).toBeCloseTo(150 / 0.863, 6);
  });

  it('is null above the chart rather than falling back to a formula', () => {
    expect(e1rm(100, 8, 13)).toBeNull();
    expect(e1rm(100, 8, 15)).toBeNull();
  });
});

describe('stress', () => {
  it('matches the source table at the corners', () => {
    expect(stressFor(10, 1)).toEqual({ peripheral: 0.54, central: 2.48 });
    expect(stressFor(10, 12)).toEqual({ peripheral: 1.82, central: 0.4 });
    expect(stressFor(0, 1)).toEqual({ peripheral: 0.13, central: 0.05 });
  });

  it('is complete, unlike the RPE chart', () => {
    let defined = 0;
    for (let r = 0; r <= 20; r++) {
      for (let n = 1; n <= 12; n++) if (stressFor(r / 2, n) !== null) defined++;
    }
    expect(defined).toBe(252);
  });

  it('clamps out-of-range reps instead of returning null', () => {
    expect(stressFor(10, 20)).toEqual(stressFor(10, 12));
    expect(stressFor(11, 1)).toEqual(stressFor(10, 1));
  });

  it('SI is the mean of peripheral and central', () => {
    expect(setStressIndex(10, 1)).toBeCloseTo((0.54 + 2.48) / 2, 6);
  });

  it('reads heavy singles as intensity-dominant and long sets as volume-dominant', () => {
    const heavy = centralBalance([{ rpe: 10, reps: 1 }]);
    const long = centralBalance([{ rpe: 8, reps: 12 }]);
    expect(heavy).not.toBeNull();
    expect(long).not.toBeNull();
    expect(heavy!).toBeGreaterThan(1);
    expect(long!).toBeLessThan(1);
  });
});

describe('load resolution', () => {
  it('converts pounds to canonical kg', () => {
    expect(toKg(225, 'lb')).toBeCloseTo(102.058, 3);
    expect(toKg(100, 'kg')).toBe(100);
  });

  it('reads a weight out of a load and ignores non-weight loads', () => {
    expect(weightKg({ kind: 'weight', value: 225, unit: 'lb' })).toBeCloseTo(102.058, 3);
    expect(weightKg({ kind: 'time', seconds: 60 })).toBeNull();
    expect(weightKg({ kind: 'distance', meters: 40 })).toBeNull();
    expect(weightKg(null)).toBeNull();
  });

  it('adds bodyweight for bw_plus and allows negative for assisted', () => {
    const pullup = ex({ load_type: 'bw_plus' });
    expect(
      effectiveLoadKg(set({ load: { kind: 'weight', value: 20, unit: 'kg' } }), pullup, 80),
    ).toBe(100);
    expect(
      effectiveLoadKg(set({ load: { kind: 'weight', value: -15, unit: 'kg' } }), pullup, 80),
    ).toBe(65);
  });

  it('is null when a bw_plus set has no bodyweight on record', () => {
    expect(effectiveLoadKg(set(), ex({ load_type: 'bw_plus' }), null)).toBeNull();
  });

  it('refuses to convert pins, so a stack setting can never enter a kilogram total', () => {
    expect(toKg(8, 'pins')).toBeNull();
    const onPins = set({ load: { kind: 'weight', value: 8, unit: 'pins' } });
    expect(effectiveLoadKg(onPins, ex(), 80)).toBeNull();
    expect(setTonnageKg(onPins, ex(), 80)).toBeNull();
  });

  it('ignores a timed set for load purposes', () => {
    expect(effectiveLoadKg(set({ load: { kind: 'time', seconds: 45 } }), ex(), 80)).toBeNull();
  });

  it('doubles tonnage for unilateral work but not bilateral', () => {
    const s = set({ load: { kind: 'weight', value: 60, unit: 'kg' }, reps: 10 });
    expect(setTonnageKg(s, ex(), null)).toBe(600);
    expect(setTonnageKg(s, ex({ unilateral: true }), null)).toBe(1200);
  });

  it('takes the unilateral multiplier from the caller, not a hardcoded 2', () => {
    const s = set({ load: { kind: 'weight', value: 60, unit: 'kg' }, reps: 10 });
    expect(setTonnageKg(s, ex({ unilateral: true }), null, 1)).toBe(600);
  });
});

describe('intervals', () => {
  it('treats an open upper bound as AMRAP', () => {
    expect(isAmrap([5, null])).toBe(true);
    expect(isAmrap([6, 8])).toBe(false);
  });

  it('formats the way a card reads', () => {
    expect(formatInterval([6, 8])).toBe('6-8');
    expect(formatInterval([3, 3])).toBe('3');
    expect(formatInterval([5, null])).toBe('≥5');
    expect(formatInterval([null, null])).toBe('open');
    expect(formatInterval(null)).toBe('—');
  });
});
