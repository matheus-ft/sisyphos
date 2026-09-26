import { describe, it, expect } from 'vitest';
import {
  CONFIG,
  muscleWeights,
  tierWeights,
  MUSCLE_PRESET_NAMES,
  TIER_PRESET_NAMES,
  UNILATERAL_SET_COUNT_MULTIPLIER,
} from '../src/metrics/definitions';
import {
  stressFor,
  stressIndexOf,
  centralBalance,
  stressByMuscle,
  totalStress,
} from '../src/metrics/stress';
import { eventVolume, setsByTierForLift } from '../src/metrics/volume';
import { volumeByMuscle, volumeByTier, type CountedSet } from '../src/metrics/volume';
import { parseExercises, parseMuscles } from '../src/library/parse';
import musclesCsv from '../src/library/muscles.csv?raw';
import exercisesCsv from '../src/library/exercises.csv?raw';
import type { Exercise, PerformedSet } from '../src/model';

const muscles = parseMuscles(musclesCsv);
const exercises = parseExercises(exercisesCsv, new Set(muscles.map((m) => m.id)));
const byId = new Map(exercises.map((e) => [e.id, e]));
const squat = byId.get('low_bar_squat')!;

const doneSet = (over: Partial<PerformedSet> = {}): PerformedSet => ({
  id: 's',
  prescribed_id: null,
  state: 'done',
  reps: 5,
  rpe: 8,
  load: { kind: 'weight', value: 100, unit: 'kg' },
  is_warmup: false,
  notes: null,
  ...over,
});

describe('metrics config', () => {
  it('exposes every weight preset for the UI switcher', () => {
    expect(MUSCLE_PRESET_NAMES).toContain('fractional');
    expect(MUSCLE_PRESET_NAMES).toContain('direct');
    expect(MUSCLE_PRESET_NAMES).toContain('1:1');
  });

  it('encodes every counting scheme as a weight set, not as a separate mode', () => {
    expect(muscleWeights('1:1')).toEqual({ primary: 1, aux: 1 });
    expect(muscleWeights('direct')).toEqual({ primary: 1, aux: 0 });
  });

  it('rejects an unknown preset instead of silently falling back', () => {
    expect(() => muscleWeights('nonsense')).toThrow(/Unknown muscle weight preset/);
  });
});

describe('stress', () => {
  const s = stressFor(10, 1)!; // peripheral .54, central 2.48

  it('defines SI as the mean of its two components', () => {
    expect(stressIndexOf(s)).toBeCloseTo(1.51, 6);
  });

  it('divides central by SI, not by twice SI', () => {
    // 2.48 / 1.51. Halving the denominator is an easy slip and changes the meaning.
    expect(centralBalance([{ rpe: 10, reps: 1 }])).toBeCloseTo(2.48 / 1.51, 6);
  });

  it('exposes the components separately, so no SI variant is needed to see them', () => {
    const t = totalStress([
      { rpe: 10, reps: 1 },
      { rpe: 10, reps: 1 },
    ]);
    expect(t.peripheral).toBeCloseTo(1.08, 6);
    expect(t.central).toBeCloseTo(4.96, 6);
    expect(t.sets).toBe(2);
  });
});

describe('muscle weights drive volume and stress together', () => {
  const sets: CountedSet[] = [{ set: doneSet(), exercise: squat }];
  const stressSets = [{ rpe: 8, reps: 5, exercise: squat }];

  it('gives primary movers full credit and scales the rest', () => {
    const v = volumeByMuscle(sets, muscleWeights('fractional'));
    expect(v.get('quads')).toBe(1); // primary
    expect(v.get('glutes')).toBe(0.5); // aux
  });

  it('drops everything but primaries under "direct"', () => {
    const v = volumeByMuscle(sets, muscleWeights('direct'));
    expect(v.get('quads')).toBe(1);
    expect(v.has('glutes')).toBe(false);
  });

  it('counts every listed muscle fully under "1:1"', () => {
    const v = volumeByMuscle(sets, muscleWeights('1:1'));
    expect(v.get('quads')).toBe(1);
    expect(v.get('glutes')).toBe(1);
  });

  it('applies the same weights to per-muscle stress', () => {
    const frac = stressByMuscle(stressSets, muscleWeights('fractional'));
    const direct = stressByMuscle(stressSets, muscleWeights('direct'));
    const si = stressIndexOf(stressFor(8, 5)!);
    expect(frac.get('quads')).toBeCloseTo(si, 6);
    expect(frac.get('glutes')).toBeCloseTo(si * 0.5, 6);
    expect(direct.has('glutes')).toBe(false);
    // Switching the preset moves volume and stress in step.
    expect(direct.get('quads')).toBeCloseTo(frac.get('quads')!, 6);
  });

  it('excludes warm-ups, skipped and pending sets from volume', () => {
    expect(volumeByMuscle([{ set: doneSet({ is_warmup: true }), exercise: squat }]).size).toBe(0);
    expect(volumeByMuscle([{ set: doneSet({ state: 'skipped' }), exercise: squat }]).size).toBe(0);
    expect(volumeByMuscle([{ set: doneSet({ state: 'pending' }), exercise: squat }]).size).toBe(0);
  });

  it('counts a unilateral set once, not twice', () => {
    const uni = byId.get('single_leg_press')!;
    const v = volumeByMuscle([{ set: doneSet(), exercise: uni }], muscleWeights('direct'));
    expect(v.get('quads')).toBe(UNILATERAL_SET_COUNT_MULTIPLIER);
  });

  it('groups by tier for specificity distribution', () => {
    const t = volumeByTier([
      { set: doneSet(), exercise: squat },
      { set: doneSet(), exercise: byId.get('leg_extension')! },
    ]);
    expect(t.get('comp')).toBe(1);
    expect(t.get('acc')).toBe(1);
  });
});

describe('tier weights', () => {
  const mix: Array<[string, number]> = [
    ['low_bar_squat', 6],
    ['paused_squat', 2],
    ['leg_extension', 3],
  ];
  const sets: CountedSet[] = mix.flatMap(([id, n]) =>
    Array.from({ length: n }, () => ({ set: doneSet(), exercise: byId.get(id)! })),
  );

  it('keeps the discrete breakdown, which is usually the more useful sentence', () => {
    const perLift = setsByTierForLift(sets);
    const squatWork = perLift.get('squat')!;
    expect(squatWork.get('comp')).toBe(6);
    expect(squatWork.get('high_spec')).toBe(2);
    expect(squatWork.get('acc')).toBe(3);
  });

  it('weights tiers into one number per event when you need to compare blocks', () => {
    // graded: 1 / 0.75 / 0.5 / 0.25
    expect(eventVolume(sets, tierWeights('graded')).get('squat')).toBeCloseTo(
      6 * 1 + 2 * 0.75 + 3 * 0.25,
      6,
    );
  });

  it('counts only the lift and close variations under "competition"', () => {
    expect(eventVolume(sets, tierWeights('competition')).get('squat')).toBe(8);
  });

  it('counts the competition movement alone under "strict"', () => {
    expect(eventVolume(sets, tierWeights('strict')).get('squat')).toBe(6);
  });

  it("never lets one event borrow another event's work", () => {
    const rdl = { set: doneSet(), exercise: byId.get('romanian_deadlift')! };
    const v = eventVolume([...sets, rdl], tierWeights('flat'));
    expect(v.get('squat')).toBe(11);
    expect(v.get('deadlift')).toBe(1);
  });

  it('rejects an unknown tier preset instead of silently falling back', () => {
    expect(() => tierWeights('nonsense')).toThrow(/Unknown tier weight preset/);
  });
});
