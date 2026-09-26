import { describe, it, expect } from 'vitest';
import { parseExercises, parseMuscles } from '../src/library/parse';
import musclesCsv from '../src/library/muscles.csv?raw';
import exercisesCsv from '../src/library/exercises.csv?raw';

const muscles = parseMuscles(musclesCsv);
const ids = new Set(muscles.map((m) => m.id));
const exercises = parseExercises(exercisesCsv, ids);
const byId = new Map(exercises.map((e) => [e.id, e]));

describe('muscle vocabulary', () => {
  it('has unique ids', () => {
    expect(ids.size).toBe(muscles.length);
  });

  it('has no group that no exercise credits', () => {
    const credited = new Set(exercises.flatMap((e) => [...e.muscles.primary, ...e.muscles.aux]));
    expect(muscles.filter((m) => !credited.has(m.id)).map((m) => m.id)).toEqual([]);
  });
});

describe('exercise library', () => {
  it('references only muscles that exist', () => {
    // parseExercises throws on an unknown id, so reaching here is the assertion.
    expect(exercises.length).toBeGreaterThan(0);
  });

  it('tracks sumo and conventional as separate competition exercises', () => {
    const sumo = byId.get('sumo_deadlift');
    const conv = byId.get('conventional_deadlift');
    expect(sumo?.tier).toBe('comp');
    expect(conv?.tier).toBe('comp');
    expect(sumo?.base_lift).toBe('deadlift');
    expect(conv?.base_lift).toBe('deadlift');
    expect(byId.has('deadlift')).toBe(false);
  });

  it('distinguishes them by muscle emphasis, not just by name', () => {
    expect(byId.get('sumo_deadlift')?.muscles.primary).toContain('adductors');
    expect(byId.get('conventional_deadlift')?.muscles.primary).not.toContain('adductors');
  });

  it('defaults a blank unilateral cell to false', () => {
    expect(byId.get('low_bar_squat')?.unilateral).toBe(false);
    expect(byId.get('single_leg_press')?.unilateral).toBe(true);
  });

  it('defaults blank load fields to an external load in kilograms', () => {
    expect(byId.get('low_bar_squat')?.load_type).toBe('external');
    expect(byId.get('low_bar_squat')?.default_unit).toBe('kg');
    expect(byId.get('pullup')?.load_type).toBe('bw_plus');
    expect(byId.get('plank')?.load_type).toBe('none');
  });

  it('marks stack machines as defaulting to pins', () => {
    expect(byId.get('lat_pulldown')?.default_unit).toBe('pins');
  });

  it('allows an exercise to serve no competition event', () => {
    expect(byId.get('pullup')?.base_lift).toBeNull();
  });

  it('rejects an unknown muscle id', () => {
    const bad =
      'id,name,base_lift,tier,unilateral,load_type,default_unit,primary,aux\nx,X,,acc,,,,not_a_muscle,';
    expect(() => parseExercises(bad, ids)).toThrow(/unknown muscle/);
  });

  it('rejects an invalid tier', () => {
    const bad =
      'id,name,base_lift,tier,unilateral,load_type,default_unit,primary,aux\nx,X,,nonsense,,,,lats,';
    expect(() => parseExercises(bad, ids)).toThrow(/tier must be one of/);
  });
});
