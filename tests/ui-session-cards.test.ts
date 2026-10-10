import { describe, expect, it } from 'vitest';
import type {
  Exercise,
  ExerciseInstance,
  PerformedSet,
  PrescribedSet,
  Session,
} from '../src/model';
import {
  cardMode,
  compactSet,
  doneSummary,
  firstPending,
  lastSummary,
  recordNote,
  recordSetIds,
  targetRpeText,
  topSet,
  upcomingLine,
  warmupsText,
} from '../src/ui/session/cards';

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
const done = (load: number, reps: number, rpe: number | null, over: Partial<PerformedSet> = {}) =>
  set({ state: 'done', load: kg(load), reps, rpe, ...over });
const prescribed = (over: Partial<PrescribedSet> = {}): PrescribedSet => ({
  id: `p${n++}`,
  reps: [8, 8],
  rpe: [8, 8],
  load: { kind: 'weight', weight: { mode: 'rpe_driven' } },
  is_warmup: false,
  notes: null,
  ...over,
});
const instance = (
  performed: PerformedSet[],
  prescribedSets: PrescribedSet[] = [],
  id = `i${n++}`,
): ExerciseInstance => ({
  id,
  exercise_id: 'bench',
  rest_s: null,
  prescribed: prescribedSets,
  performed,
  notes: null,
});
const bench = { id: 'bench', name: 'Bench Press', tier: 'comp', load_type: 'external' } as Exercise;

describe('which state a card is in', () => {
  it('is current when it holds the next set to enter', () => {
    const next = set();
    expect(cardMode(instance([done(90, 5, 8), next]), next.id)).toBe('current');
  });

  it('is done when nothing in it is pending, skipped sets included', () => {
    expect(cardMode(instance([done(90, 5, 8), set({ state: 'skipped' })]), 'elsewhere')).toBe(
      'done',
    );
  });

  it('is upcoming while sets wait and it is not the next', () => {
    expect(cardMode(instance([set(), set()]), 'elsewhere')).toBe('upcoming');
    expect(cardMode(instance([done(90, 5, 8), set()]), null)).toBe('upcoming');
  });

  it('is upcoming with no sets at all: nothing was finished', () => {
    expect(cardMode(instance([]), null)).toBe('upcoming');
  });
});

describe('the next set to enter', () => {
  it('is the first pending one in session order', () => {
    const a = instance([done(90, 5, 8)]);
    const wanted = set();
    const b = instance([wanted, set()]);
    const session = { exercises: [a, b] } as Session;
    expect(firstPending(session)).toEqual({ instance: b, set: wanted });
    expect(firstPending({ exercises: [a] } as Session)).toBeNull();
  });
});

describe('a done card', () => {
  it('lists the working sets closely and counts warm-ups apart', () => {
    const squat = { id: 'low_bar_squat', tier: 'comp', load_type: 'external' } as Exercise;
    const i = instance([
      done(60, 5, null, { is_warmup: true }),
      done(100, 5, 7),
      done(142.5, 5, 8.5),
    ]);
    const got = doneSummary(i, squat, new Set());
    expect(got.sets.map((s) => s.text)).toEqual(['100×5 @7', '142.5×5 @8.5']);
    expect(got.warmups).toBe(1);
    expect(got.recordReps).toEqual([]);
  });

  it('marks the record sets and says at which rep counts', () => {
    const top = done(142.5, 5, 8.5);
    const i = instance([done(100, 3, 7), top]);
    const got = doneSummary(i, bench, new Set([top.id]));
    expect(got.sets.map((s) => s.record)).toEqual([false, true]);
    expect(got.recordReps).toEqual([5]);
  });

  it('leaves skipped and warm-up sets out of the working list', () => {
    const i = instance([set({ state: 'skipped' }), done(60, 5, null, { is_warmup: true })]);
    expect(doneSummary(i, bench, new Set()).sets).toEqual([]);
  });

  it('words the warm-ups and the record note', () => {
    expect(warmupsText(0)).toBeNull();
    expect(warmupsText(1)).toBe('1 warm-up');
    expect(warmupsText(2)).toBe('2 warm-ups');
    expect(recordNote([])).toBeNull();
    expect(recordNote([5])).toBe('Record for 5 reps');
    expect(recordNote([1])).toBe('Record for 1 rep');
    expect(recordNote([5, 3])).toBe('2 records');
  });

  it('writes a set closely, keeping the bodyweight sign', () => {
    const dips = { id: 'dips', load_type: 'bw_plus' } as Exercise;
    expect(compactSet(done(10, 8, 8), dips)).toBe('+10×8 @8');
  });
});

describe('an upcoming card', () => {
  it('says the sets and reps of the plan, then last time', () => {
    const p = [prescribed(), prescribed(), prescribed()];
    const i = instance(
      p.map((x) => set({ prescribed_id: x.id })),
      p,
    );
    expect(upcomingLine(i, '110 × 8 @ 7')).toBe('3 × 8 · last 110 × 8 @ 7');
  });

  it('keeps a rep range as written', () => {
    const p = [prescribed({ reps: [3, 5] })];
    expect(upcomingLine(instance([set({ prescribed_id: p[0].id })], p), null)).toBe('1 × 3-5');
  });

  it('counts only the sets still owed: skipped ones are not', () => {
    const i = instance([set(), set({ state: 'skipped' })]);
    expect(upcomingLine(i, null)).toBe('1 set');
  });

  it('says how far it got when some sets are done', () => {
    expect(upcomingLine(instance([done(90, 5, 8), set(), set()]), '90 × 5 @ 8')).toBe(
      '1 of 3 done · last 90 × 5 @ 8',
    );
  });

  it('knows nothing of an exercise with no sets', () => {
    expect(upcomingLine(instance([]), null)).toBe('No sets yet');
  });
});

describe('what last time is remembered by', () => {
  it('is the top working set', () => {
    const last = instance([
      done(60, 5, null, { is_warmup: true }),
      done(100, 5, 7),
      done(110, 5, 8.5),
      done(105, 5, 8),
    ]);
    expect(lastSummary(last, bench)).toBe('110 × 5 @ 8.5');
  });

  it('prefers the later of equal sets, the one that went harder', () => {
    expect(topSet([done(100, 5, 7), done(100, 5, 8)])?.rpe).toBe(8);
    expect(topSet([done(100, 5, 8), done(100, 6, 8)])?.reps).toBe(6);
  });

  it('is nothing without a last time', () => {
    expect(lastSummary(null, bench)).toBeNull();
  });

  it('reads the target RPE from the next working set', () => {
    const p = prescribed({ rpe: [7, 8] });
    const i = instance([done(90, 5, 7), set({ prescribed_id: p.id })], [p]);
    expect(targetRpeText(i)).toBe('@ 7-8');
    expect(targetRpeText(instance([set()]))).toBeNull();
  });
});

describe('the laurel', () => {
  const session = (id: string, date: string, sets: PerformedSet[]): Session =>
    ({
      id,
      date,
      started_at: `${date}T17:00:00Z`,
      ended_at: null,
      exercises: [instance(sets, [], `i-${id}`)],
    }) as unknown as Session;

  it('goes to a set that beat what stood before it, and to no other', () => {
    const old = session('old', '2026-09-01', [done(100, 5, 8)]);
    const beaten = done(105, 5, 8);
    const level = done(100, 5, 8);
    const now = session('now', '2026-10-05', [level, beaten]);
    const got = recordSetIds(now, [old], [bench], []);
    expect([...got]).toEqual([beaten.id]);
  });

  it('counts a hand-entered record as the one to beat', () => {
    const lift = done(120, 3, 8);
    const now = session('now', '2026-10-05', [lift]);
    const manual = [
      {
        date: '2026-03-14',
        exercise_id: 'bench',
        source: 'manual' as const,
        reps: 3,
        weight_kg: 125,
        rpe: null,
        context: null,
      },
    ];
    expect(recordSetIds(now, [], [bench], manual).size).toBe(0);
  });

  it('is given to nothing for a first-ever rep count', () => {
    const now = session('now', '2026-10-05', [done(100, 5, 8)]);
    expect(recordSetIds(now, [], [bench], []).size).toBe(0);
  });
});
