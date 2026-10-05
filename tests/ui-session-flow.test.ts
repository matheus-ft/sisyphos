import { describe, expect, it } from 'vitest';
import type { Exercise, ExerciseInstance, PerformedSet, Session } from '../src/model';
import { REST_BY_TIER } from '../src/ui/rest';
import {
  applySuggestion,
  climb,
  restContext,
  restFresh,
  restNextSet,
  restKey,
  restNext,
  restReadout,
  restStarted,
  restoreSet,
  savedSet,
  savedToast,
  sessionsBefore,
  startsRest,
  suggestionShows,
  targetOf,
  weighInOffer,
} from '../src/ui/session/flow';

const kg = (value: number) => ({ kind: 'weight' as const, value, unit: 'kg' as const });
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
const done = (load: number, reps: number, rpe: number | null, over: Partial<PerformedSet> = {}) =>
  set({ state: 'done', load: kg(load), reps, rpe, ...over });
const instance = (performed: PerformedSet[], over: Partial<ExerciseInstance> = {}) =>
  ({
    id: `i${n++}`,
    exercise_id: 'bench',
    rest_s: null,
    prescribed: [],
    performed,
    notes: null,
    ...over,
  }) as ExerciseInstance;
const session = (exercises: ExerciseInstance[], over: Partial<Session> = {}): Session =>
  ({
    id: 'now',
    date: '2026-10-05',
    started_at: '2026-10-05T17:00:00Z',
    ended_at: null,
    bodyweight_kg: null,
    exercises,
    ...over,
  }) as Session;
const bench = {
  id: 'bench',
  name: 'Bench Press',
  tier: 'comp',
  load_type: 'external',
  default_unit: 'kg',
} as Exercise;

describe('a set just saved', () => {
  it('is the set that became done, numbered among its kind', () => {
    const first = done(90, 5, 8);
    const next = set({ load: kg(90), reps: 5 });
    const i = instance([done(60, 5, null, { is_warmup: true }), first, next]);
    const before = session([i]);
    const after = session([
      { ...i, performed: [i.performed[0], first, { ...next, rpe: 8, state: 'done' }] },
    ]);
    const got = savedSet(before, after);
    expect(got).toMatchObject({ number: 2, warmup: false });
    expect(got?.set.id).toBe(next.id);
  });

  it('numbers a warm-up among the warm-ups', () => {
    const w1 = done(40, 8, null, { is_warmup: true });
    const w2 = set({ is_warmup: true, load: kg(60), reps: 5 });
    const i = instance([w1, w2]);
    const after = session([{ ...i, performed: [w1, { ...w2, state: 'done' }] }]);
    expect(savedSet(session([i]), after)).toMatchObject({ number: 2, warmup: true });
  });

  it('is nothing when the edit finished no set', () => {
    const i = instance([done(90, 5, 8), set()]);
    const typed = { ...i, performed: [{ ...i.performed[0], rpe: 9 }, i.performed[1]] };
    expect(savedSet(session([i]), session([typed]))).toBeNull();
  });

  it('is nothing for an undo, which takes a set out of done', () => {
    const i = instance([done(90, 5, 8)]);
    expect(savedSet(session([i]), session([{ ...i, performed: [set()] }]))).toBeNull();
  });

  it('writes the toast with the set as it was lifted', () => {
    const s = done(92.5, 5, 8);
    expect(
      savedToast({ instance: instance([s]), set: s, number: 2, warmup: false }, bench),
    ).toEqual({ message: 'Set 2 saved', strong: '92.5 × 5 @ 8' });
    const w = done(40, 8, null, { is_warmup: true });
    expect(
      savedToast({ instance: instance([w]), set: w, number: 1, warmup: true }, bench).message,
    ).toBe('Warm-up 1 saved');
  });
});

describe('undo', () => {
  it('puts one set back and leaves every later edit alone', () => {
    const before = set({ load: kg(90), reps: 5 });
    const i = instance([before, done(100, 5, 8)]);
    const saved = { ...before, rpe: 8, state: 'done' as const };
    const now = session([{ ...i, performed: [saved, i.performed[1]] }], { notes: 'typed after' });
    const undone = restoreSet(now, i.id, before);
    expect(undone.exercises[0].performed[0]).toEqual(before);
    expect(undone.exercises[0].performed[1]).toEqual(i.performed[1]);
    expect(undone.notes).toBe('typed after');
  });
});

describe('the rest a set starts', () => {
  it("follows the set, with its exercise's target or its tier's", () => {
    const s = done(90, 5, 8);
    const i = instance([s]);
    const saved = { instance: i, set: s, number: 1, warmup: false };
    expect(restStarted(saved, bench, 1000)).toEqual({
      startedAt: 1000,
      instanceId: i.id,
      setId: s.id,
      targetS: REST_BY_TIER.comp,
    });
    expect(targetOf({ ...i, rest_s: 200 }, bench)).toBe(200);
    expect(targetOf(i, undefined)).toBe(REST_BY_TIER.low_spec);
  });

  it('starts from the latest working set lifted', () => {
    const lifted = done(90, 5, 8);
    const i = instance([done(90, 5, 8), lifted, set()]);
    expect(startsRest({ instance: i, set: lifted, number: 2, warmup: false })).toBe(true);
  });

  it('is not restarted by an earlier set given its missing RPE while a later rest runs', () => {
    const second = done(90, 5, 8);
    const i = instance([done(90, 5, 8), second, done(90, 5, 8)]);
    expect(startsRest({ instance: i, set: second, number: 2, warmup: false })).toBe(false);
  });

  it('starts from no warm-up, and not from a working set behind one', () => {
    const warm = done(60, 5, null, { is_warmup: true });
    const lifted = done(90, 5, 8);
    const i = instance([warm, lifted, done(40, 8, null, { is_warmup: true })]);
    expect(startsRest({ instance: i, set: warm, number: 1, warmup: true })).toBe(false);
    expect(startsRest({ instance: i, set: lifted, number: 1, warmup: false })).toBe(true);
  });

  it('is kept per session', () => {
    expect(restKey('2026-10-05-abcd')).toBe('sisyphos.rest.2026-10-05-abcd');
  });

  it('says how far the exercise has got, not counting skipped sets', () => {
    const i = instance([done(90, 5, 8), done(90, 5, 8), set(), set({ state: 'skipped' })]);
    expect(restContext(i, 'Bench Press')).toBe('Bench Press · set 2 of 3 done');
  });

  it('counts down, then up, from the absolute start', () => {
    expect(restReadout(0, 180, 107_000)).toMatchObject({ text: '1:13', of: '3:00', over: false });
    expect(restReadout(0, 180, 192_000)).toMatchObject({ text: '+0:12', over: true, fraction: 1 });
    expect(restReadout(0, 180, 90_000).fraction).toBe(0.5);
  });
});

describe("the takeover's next set", () => {
  const ctx = { date: '2026-10-05', oneRms: [], unit: 'kg' as const, step: 2.5 };

  it('splits the line into the label, the figures and the exercise', () => {
    const p = {
      id: 'p',
      reps: [5, 5] as [number, number],
      rpe: [8, 8] as [number, number],
      load: {
        kind: 'weight' as const,
        weight: { mode: 'absolute' as const, kg: [92.5, 92.5] as [number, number] },
      },
      is_warmup: false,
      notes: null,
    };
    const s = set({ prescribed_id: 'p' });
    const i = instance([done(90, 5, 8), s], { prescribed: [p] });
    expect(restNext({ instance: i, set: s, number: 2, warmup: false }, bench, ctx)).toEqual({
      label: 'Set 2',
      figures: '92.5 × 5 @ 8',
      exercise: 'Bench Press',
    });
  });

  it('is nothing when no set is left', () => {
    expect(restNext(null, bench, ctx)).toBeNull();
  });

  it('copes with an exercise the library lacks', () => {
    const s = set({ load: kg(80), reps: 5 });
    const i = instance([s], { exercise_id: 'mystery' });
    expect(restNext({ instance: i, set: s, number: 1, warmup: false }, undefined, ctx)).toEqual({
      label: 'Set 1',
      figures: '80 × 5',
      exercise: 'mystery',
    });
  });
});

describe("the boulder's readout", () => {
  it('counts done working sets against the plan and never reads past it', () => {
    const p = { id: 'p', reps: null, rpe: null, load: null, is_warmup: false, notes: null };
    const prescribed = [p, p, p, p] as unknown as ExerciseInstance['prescribed'];
    const i = instance([done(90, 5, 8), done(90, 5, 8), set(), set()], { prescribed });
    expect(climb(session([i]), [])).toMatchObject({ done: 2, of: 4, fraction: 0.5 });
    const over = instance([done(90, 5, 8), done(90, 5, 8), done(90, 5, 8)], {
      prescribed: prescribed.slice(0, 2),
    });
    expect(climb(session([over]), []).of).toBe(3);
  });

  it('is at the top once the session is finished', () => {
    const i = instance([done(90, 5, 8)]);
    expect(climb(session([i], { ended_at: '2026-10-05T18:00:00Z' }), []).fraction).toBe(1);
  });
});

describe('the suggested weight', () => {
  const suggestion = { load: 92.5, unit: 'kg' as const, delta: 2.5, reason: '+2.5: x' };

  it('shows while a pending working set does not hold it', () => {
    expect(suggestionShows(instance([set()]), suggestion)).toBe(true);
    expect(suggestionShows(instance([set({ load: kg(92.5) })]), suggestion)).toBe(false);
    expect(suggestionShows(instance([done(90, 5, 8)]), suggestion)).toBe(false);
    expect(suggestionShows(instance([set()]), null)).toBe(false);
  });

  it('fills the pending working sets only, leaving reps, RPE and done sets', () => {
    const w = set({ is_warmup: true, load: kg(40), reps: 8 });
    const d = done(90, 5, 8);
    const a = set({ reps: 5 });
    const b = set({ load: kg(90), reps: 5 });
    const i = instance([w, d, a, b]);
    const next = applySuggestion(session([i]), i.id, suggestion);
    const got = next.exercises[0].performed;
    expect(got[0]).toEqual(w);
    expect(got[1]).toEqual(d);
    expect(got[2]).toMatchObject({ load: kg(92.5), reps: 5, rpe: null, state: 'pending' });
    expect(got[3]).toMatchObject({ load: kg(92.5), reps: 5, state: 'pending' });
  });
});

describe('the weigh-in offer', () => {
  it('is made for a typed bodyweight with no weigh-in on that date', () => {
    const s = session([], { bodyweight_kg: 83.4 });
    expect(weighInOffer(s, [])).toEqual({ date: '2026-10-05', weight_kg: 83.4, source: 'manual' });
  });

  it('is not made without a bodyweight, or when the day has a weigh-in', () => {
    expect(weighInOffer(session([]), [])).toBeNull();
    const s = session([], { bodyweight_kg: 83.4 });
    expect(weighInOffer(s, [{ date: '2026-10-05', weight_kg: 83, source: 'manual' }])).toBeNull();
    expect(
      weighInOffer(s, [{ date: '2026-10-04', weight_kg: 83, source: 'manual' }]),
    ).not.toBeNull();
  });
});

describe('a rest kept in the tab', () => {
  const state = { startedAt: 1_000_000, instanceId: 'i', targetS: 180 };

  it('is dropped once it is older than the longest rest there is', () => {
    expect(restFresh(state, 1_000_000 + 3_600_000)).toBe(true);
    expect(restFresh(state, 1_000_000 + 3_600_001)).toBe(false);
  });
});

describe('the set after the rest', () => {
  it('is the first pending set after the one saved', () => {
    const a = done(90, 5, 8);
    const b = set();
    const i = instance([a, b]);
    const s = session([i]);
    expect(restNextSet(s, { startedAt: 1, instanceId: i.id, setId: a.id, targetS: 120 })?.set).toBe(
      b,
    );
  });

  it('follows the last done working set when the one saved is gone', () => {
    const a = done(90, 5, 8);
    const b = set();
    const i = instance([a, b]);
    const s = session([i]);
    const next = restNextSet(s, { startedAt: 1, instanceId: i.id, setId: 'undone', targetS: 120 });
    expect(next?.set).toBe(b);
  });

  it('is none when nothing is left', () => {
    const a = done(90, 5, 8);
    const i = instance([a]);
    expect(
      restNextSet(session([i]), { startedAt: 1, instanceId: i.id, setId: a.id, targetS: 120 }),
    ).toBeNull();
  });
});

describe('what came before a session', () => {
  it('is the sessions on or before its date', () => {
    const old = session([], { id: 'old', date: '2026-09-01' });
    const same = session([], { id: 'same', date: '2026-10-05' });
    const later = session([], { id: 'later', date: '2026-10-12' });
    expect(sessionsBefore([old, same, later], '2026-10-05').map((s) => s.id)).toEqual([
      'old',
      'same',
    ]);
  });
});
