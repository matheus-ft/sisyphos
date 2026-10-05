import { describe, expect, it } from 'vitest';
import type { ExerciseInstance, PerformedSet, PrescribedSet } from '../src/model';
import {
  activeSetId,
  ringedRpe,
  RPE_COURSES,
  setLabel,
  stepText,
  targetText,
} from '../src/ui/session/panel';

let n = 0;
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
const prescribed = (over: Partial<PrescribedSet> = {}): PrescribedSet => ({
  id: `p${n++}`,
  reps: [5, 5],
  rpe: [8, 8],
  load: { kind: 'weight', weight: { mode: 'rpe_driven' } },
  is_warmup: false,
  notes: null,
  ...over,
});
const instance = (performed: PerformedSet[], plan: PrescribedSet[] = []): ExerciseInstance => ({
  id: `i${n++}`,
  exercise_id: 'bench',
  rest_s: null,
  prescribed: plan,
  performed,
  notes: null,
});

describe('a set named for the panel', () => {
  it('counts working sets and warm-ups apart', () => {
    const w1 = set({ is_warmup: true });
    const w2 = set({ is_warmup: true });
    const a = set();
    const b = set();
    const i = instance([w1, w2, a, b]);
    expect(setLabel(i, w2)).toBe('Warm-up 2');
    expect(setLabel(i, a)).toBe('Set 1');
    expect(setLabel(i, b)).toBe('Set 2');
  });
});

describe('the target line', () => {
  it('writes reps and RPE as prescribed, ranges kept', () => {
    const p = prescribed({ reps: [3, 5], rpe: [7, 8] });
    const s = set({ prescribed_id: p.id });
    expect(targetText(instance([s], [p]), s)).toBe('3-5 @ 7-8');
  });

  it('is null without a prescription, or for a warm-up', () => {
    const s = set();
    expect(targetText(instance([s]), s)).toBeNull();
    const p = prescribed();
    const w = set({ prescribed_id: p.id, is_warmup: true });
    expect(targetText(instance([w], [p]), w)).toBeNull();
  });

  it('leaves out an RPE the prescription does not give', () => {
    const p = prescribed({ rpe: null });
    const s = set({ prescribed_id: p.id });
    expect(targetText(instance([s], [p]), s)).toBe('5');
  });
});

describe('the ringed RPE chip', () => {
  it('is the top of the range', () => {
    const p = prescribed({ rpe: [7, 8] });
    const s = set({ prescribed_id: p.id });
    expect(ringedRpe(instance([s], [p]), s)).toBe(8);
  });

  it('is none for a warm-up or without a target', () => {
    const p = prescribed();
    const w = set({ prescribed_id: p.id, is_warmup: true });
    expect(ringedRpe(instance([w], [p]), w)).toBeNull();
    expect(ringedRpe(instance([set()]), set())).toBeNull();
  });
});

describe('the active set', () => {
  it('is the open panel, else the first pending, only while the session is open', () => {
    expect(activeSetId(true, 'a', 'b')).toBe('a');
    expect(activeSetId(true, null, 'b')).toBe('b');
    expect(activeSetId(false, 'a', 'b')).toBeNull();
  });
});

describe('the chips', () => {
  it('lay the nine halves from 6 to 10 out five over four', () => {
    expect(RPE_COURSES.map((r) => r.length)).toEqual([5, 4]);
    expect(RPE_COURSES.flat()).toEqual([6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]);
  });

  it('say the size of a step', () => {
    expect(stepText('weight', 2.5, 'kg')).toBe('± 2.5 kg');
    expect(stepText('time', 5, 's')).toBe('± 5 or 15 s');
  });
});
