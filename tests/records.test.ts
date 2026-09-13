import { describe, it, expect } from 'vitest';
import { isComplete } from '../src/model';
import type { PerformedSet } from '../src/model';

const set = (over: Partial<PerformedSet> = {}): PerformedSet => ({
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

describe('what "done" requires', () => {
  it('accepts a complete working set', () => {
    expect(isComplete(set())).toBe(true);
  });

  it('rejects a working set with no RPE — which is why no null policy is needed', () => {
    expect(isComplete(set({ rpe: null }))).toBe(false);
  });

  it('accepts a warm-up without one, because warm-ups are not rated', () => {
    expect(isComplete(set({ rpe: null, is_warmup: true }))).toBe(true);
  });

  it('rejects a set with no load or no reps', () => {
    expect(isComplete(set({ load: null }))).toBe(false);
    expect(isComplete(set({ reps: null }))).toBe(false);
    expect(isComplete(set({ reps: 0 }))).toBe(false);
  });

  it('measures timed and distance work by its own quantity, not by reps', () => {
    expect(isComplete(set({ reps: null, rpe: null, load: { kind: 'time', seconds: 45 } }))).toBe(
      true,
    );
    expect(isComplete(set({ reps: null, rpe: null, load: { kind: 'distance', meters: 40 } }))).toBe(
      true,
    );
    expect(isComplete(set({ reps: null, load: { kind: 'time', seconds: 0 } }))).toBe(false);
  });
});
