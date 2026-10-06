import { describe, expect, it } from 'vitest';
import type { Session } from '../src/model';
import { addExercise, addSet, editSet, skipSet } from '../src/ui/session';
import { addTarget, addTemplateExercise, editTarget, newTemplate } from '../src/ui/template';
import { fromTemplate } from '../src/ui/session';
import {
  MAX_REST_S,
  MIN_REST_S,
  REST_BY_TIER,
  adjustRest,
  lastDoneSetId,
  nextPendingSet,
  nextSetText,
  parseRest,
  restClock,
  restTargetS,
  serializeRest,
  type NextSetContext,
} from '../src/ui/rest';
import { insertWarmups, warmupSets } from '../src/ui/warmup';
import { byId, ids, sessionOn, withSets } from './ui-fixtures';

const bench = byId('bench');
const squat = byId('low_bar_squat');
const plank = byId('plank');

describe('the target rest', () => {
  it("is the exercise's own when it has one", () => {
    expect(restTargetS('comp', 240)).toBe(240);
    expect(restTargetS('acc', 45)).toBe(45);
  });

  it("is the tier's otherwise", () => {
    expect(restTargetS('comp')).toBe(180);
    expect(restTargetS('high_spec', null)).toBe(150);
    expect(restTargetS('low_spec', undefined)).toBe(120);
    expect(restTargetS('acc')).toBe(90);
    expect(REST_BY_TIER).toEqual({ comp: 180, high_spec: 150, low_spec: 120, acc: 90 });
  });

  it('does not take a target that is no rest', () => {
    expect(restTargetS('comp', 0)).toBe(180);
    expect(restTargetS('comp', -30)).toBe(180);
    expect(restTargetS('comp', Number.NaN)).toBe(180);
    expect(restTargetS('comp', 99999)).toBe(MAX_REST_S);
  });
});

describe('the rest clock', () => {
  const t0 = 1_800_000_000_000;

  it('counts down from the target', () => {
    expect(restClock(t0, 90, t0)).toEqual({
      remainingS: 90,
      overtimeS: 0,
      over: false,
      fraction: 0,
    });
    expect(restClock(t0, 90, t0 + 30_000)).toEqual({
      remainingS: 60,
      overtimeS: 0,
      over: false,
      fraction: 1 / 3,
    });
  });

  it('rounds the remaining time up, so zero is only ever the end', () => {
    expect(restClock(t0, 90, t0 + 89_001).remainingS).toBe(1);
    expect(restClock(t0, 90, t0 + 89_999).remainingS).toBe(1);
    expect(restClock(t0, 90, t0 + 89_999).over).toBe(false);
    expect(restClock(t0, 90, t0 + 90_000)).toMatchObject({ remainingS: 0, over: true });
  });

  it('counts up from the target', () => {
    expect(restClock(t0, 90, t0 + 90_000)).toEqual({
      remainingS: 0,
      overtimeS: 0,
      over: true,
      fraction: 1,
    });
    expect(restClock(t0, 90, t0 + 90_999).overtimeS).toBe(0);
    expect(restClock(t0, 90, t0 + 95_000)).toMatchObject({ overtimeS: 5, over: true, fraction: 1 });
  });

  it('shows the right time after the app slept through it', () => {
    expect(restClock(t0, 180, t0 + 25 * 60_000)).toMatchObject({
      remainingS: 0,
      overtimeS: 25 * 60 - 180,
      over: true,
    });
  });

  it('reads a clock set back as a rest not yet begun', () => {
    expect(restClock(t0, 90, t0 - 5_000)).toEqual({
      remainingS: 90,
      overtimeS: 0,
      over: false,
      fraction: 0,
    });
  });

  it('has no fraction to speak of for an empty target, and is over at once', () => {
    expect(restClock(t0, 0, t0)).toMatchObject({ over: true, fraction: 1, remainingS: 0 });
  });

  it('does not depend on how often it is asked', () => {
    const a = restClock(t0, 120, t0 + 47_300);
    for (let i = 0; i < 5; i++) expect(restClock(t0, 120, t0 + 47_300)).toEqual(a);
  });
});

describe('adjusting the rest', () => {
  it('moves by the step', () => {
    expect(adjustRest(90, 15)).toBe(105);
    expect(adjustRest(90, -15)).toBe(75);
  });

  it('keeps a floor and a ceiling', () => {
    expect(adjustRest(30, -15)).toBe(MIN_REST_S);
    expect(adjustRest(MIN_REST_S, -15)).toBe(MIN_REST_S);
    expect(adjustRest(MAX_REST_S, 15)).toBe(MAX_REST_S);
  });
});

describe('the rest that survives a reload', () => {
  const state = { startedAt: 1_800_000_000_000, instanceId: 'e1', targetS: 150, setId: 's1' };

  it('round-trips', () => {
    expect(parseRest(serializeRest(state))).toEqual(state);
  });

  it('round-trips without the set, which a rest need not name', () => {
    const { setId: _setId, ...bare } = state;
    expect(parseRest(serializeRest(bare))).toEqual(bare);
  });

  it('is nothing for what is not a rest', () => {
    for (const junk of [
      null,
      undefined,
      '',
      'null',
      '[]',
      '7',
      '"text"',
      '{',
      'undefined',
      '{}',
      '{"startedAt":"1","instanceId":"e1","targetS":150}',
      '{"startedAt":-1,"instanceId":"e1","targetS":150}',
      '{"startedAt":0,"instanceId":"e1","targetS":150}',
      '{"startedAt":1800000000000,"instanceId":"","targetS":150}',
      '{"startedAt":1800000000000,"instanceId":7,"targetS":150}',
      '{"startedAt":1800000000000,"instanceId":"e1"}',
      '{"startedAt":1800000000000,"instanceId":"e1","targetS":"150"}',
      '{"startedAt":1800000000000,"instanceId":"e1","targetS":0}',
      '{"startedAt":1800000000000,"instanceId":"e1","targetS":-5}',
      '{"startedAt":1800000000000,"instanceId":"e1","targetS":99999}',
      '{"startedAt":1800000000000,"instanceId":"e1","targetS":150,"setId":3}',
      '{"startedAt":1800000000000,"instanceId":"e1","targetS":150,"setId":""}',
    ]) {
      expect(parseRest(junk), String(junk)).toBeNull();
    }
  });

  it('ignores extra fields', () => {
    const text = '{"startedAt":1800000000000,"instanceId":"e1","targetS":150,"x":1}';
    expect(parseRest(text)).toEqual({
      startedAt: 1_800_000_000_000,
      instanceId: 'e1',
      targetS: 150,
    });
  });
});

/** A bench of three planned sets (100 @ 8, 100 @ 8, 100 @ 8) then a squat of two, from a template. */
function planned(): Session {
  let t = newTemplate({ id: 't', name: 'A', at: new Date(2026, 9, 1) });
  t = addTemplateExercise(t, bench);
  t = editTarget(t, 0, 0, { amount: 92.5, reps: 5, rpe: 8 }, 'weight');
  t = addTarget(t, 0, 'weight');
  t = addTarget(t, 0, 'weight');
  t = addTemplateExercise(t, squat);
  t = editTarget(t, 1, 0, { amount: 140, reps: 3 }, 'weight');
  t = addTarget(t, 1, 'weight');
  return fromTemplate(sessionOn(4), t, ids());
}

function log(s: Session, e: number, i: number, edit: Parameters<typeof editSet>[3]): Session {
  return editSet(s, s.exercises[e].id, s.exercises[e].performed[i].id, edit, 'weight', 'kg');
}

const ctx: NextSetContext = { date: '2026-10-04', oneRms: [], unit: 'kg', step: 2.5 };

describe('the next set', () => {
  it('is the next pending set of the exercise', () => {
    let s = planned();
    s = log(s, 0, 0, { amount: 92.5, reps: 5, rpe: 8 });
    const next = nextPendingSet(s, s.exercises[0].performed[0].id)!;
    expect(next.instance.exercise_id).toBe('bench');
    expect(next.set.id).toBe(s.exercises[0].performed[1].id);
    expect(next.number).toBe(2);
    expect(next.warmup).toBe(false);
  });

  it('crosses to the next exercise after the last set of one', () => {
    const s = planned();
    const next = nextPendingSet(s, s.exercises[0].performed[2].id)!;
    expect(next.instance.exercise_id).toBe('low_bar_squat');
    expect(next.number).toBe(1);
  });

  it('passes over sets already done or skipped', () => {
    let s = planned();
    s = log(s, 0, 1, { amount: 92.5, reps: 5, rpe: 8 });
    s = skipSet(s, s.exercises[0].id, s.exercises[0].performed[2].id, true);
    const next = nextPendingSet(s, s.exercises[0].performed[0].id)!;
    expect(next.instance.exercise_id).toBe('low_bar_squat');
  });

  it('is after the set given, not the first pending one in the session', () => {
    const s = planned();
    const next = nextPendingSet(s, s.exercises[0].performed[1].id)!;
    expect(next.number).toBe(3);
  });

  it('is nothing after the last set, or for a set the session does not hold', () => {
    const s = planned();
    expect(nextPendingSet(s, s.exercises[1].performed[1].id)).toBeNull();
    expect(nextPendingSet(s, 'gone')).toBeNull();
  });

  it('counts warm-ups apart from working sets', () => {
    const s = withSets(sessionOn(4), bench, [
      { amount: 60, reps: 5, warmup: true },
      { amount: 100, reps: 5, rpe: 8 },
    ]);
    let t = addSet(s, s.exercises[0].id, ids('z'));
    t = addExercise(t, squat, ids('y'));
    const first = nextPendingSet(t, t.exercises[0].performed[0].id)!;
    // The warm-up before it is not set 1.
    expect(first.number).toBe(2);
    expect(first.warmup).toBe(false);
    const next = nextPendingSet(t, t.exercises[0].performed[2].id)!;
    expect(next.instance.exercise_id).toBe('low_bar_squat');
  });

  it('finds the set a rest follows when only the exercise is known', () => {
    let s = planned();
    expect(lastDoneSetId(s, s.exercises[0].id)).toBeNull();
    s = log(s, 0, 0, { amount: 92.5, reps: 5, rpe: 8 });
    s = log(s, 0, 1, { amount: 92.5, reps: 5, rpe: 8 });
    expect(lastDoneSetId(s, s.exercises[0].id)).toBe(s.exercises[0].performed[1].id);
    expect(lastDoneSetId(s, 'gone')).toBeNull();
  });
});

describe('the next set as the rest screen reads it', () => {
  it('writes the prescription: load, reps and RPE', () => {
    const s = planned();
    const next = nextPendingSet(s, s.exercises[0].performed[0].id)!;
    expect(nextSetText(next, bench, ctx)).toBe('Bench Press · set 2 · 92.5 × 5 @ 8');
  });

  it('writes what the set already holds in place of the target', () => {
    let s = planned();
    s = log(s, 0, 1, { amount: 95, reps: 4 });
    const next = nextPendingSet(s, s.exercises[0].performed[0].id)!;
    expect(nextSetText(next, bench, ctx)).toBe('Bench Press · set 2 · 95 × 4 @ 8');
  });

  it('writes a range of reps as the plan has it', () => {
    let s = planned();
    const e = s.exercises[0];
    s = {
      ...s,
      exercises: [
        { ...e, prescribed: e.prescribed.map((p) => ({ ...p, reps: [3, 5] as [number, number] })) },
        s.exercises[1],
      ],
    };
    const next = nextPendingSet(s, s.exercises[0].performed[0].id)!;
    expect(nextSetText(next, bench, ctx)).toBe('Bench Press · set 2 · 92.5 × 3-5 @ 8');
  });

  it('resolves a percentage against the max in force', () => {
    let t = newTemplate({ id: 't', name: 'A', at: new Date(2026, 9, 1) });
    t = addTemplateExercise(t, squat);
    t = {
      ...t,
      exercises: [
        {
          ...t.exercises[0],
          prescribed: [
            {
              ...t.exercises[0].prescribed[0],
              reps: [5, 5],
              load: { kind: 'weight', weight: { mode: 'pct_1rm', pct: [0.8, 0.8], lift: 'squat' } },
            },
            {
              ...t.exercises[0].prescribed[0],
              reps: [5, 5],
              load: { kind: 'weight', weight: { mode: 'pct_1rm', pct: [0.8, 0.8], lift: 'squat' } },
            },
          ],
        },
      ],
    };
    const s = fromTemplate(sessionOn(4), t, ids());
    const next = nextPendingSet(s, s.exercises[0].performed[0].id)!;
    const oneRms = [{ date: '2026-09-01', lift: 'squat' as const, weight_kg: 200, note: null }];
    expect(nextSetText(next, squat, { ...ctx, oneRms })).toBe('Low-Bar Squat · set 2 · 160 × 5');
    // No max in force yet: the numbers it can give are the reps.
    expect(nextSetText(next, squat, ctx)).toBe('Low-Bar Squat · set 2 · 5');
  });

  it('falls back to the suggested weight when the plan names none', () => {
    const s = withSets(sessionOn(4), bench, [{ amount: 100, reps: 5, rpe: 8 }]);
    const t = addSet(s, s.exercises[0].id, ids('z'));
    const cleared = editSet(
      t,
      t.exercises[0].id,
      t.exercises[0].performed[1].id,
      { amount: null },
      'weight',
      'kg',
    );
    const next = nextPendingSet(cleared, cleared.exercises[0].performed[0].id)!;
    const suggestion = { load: 102.5, unit: 'kg' as const, delta: 2.5, reason: '+2.5: x' };
    expect(nextSetText(next, bench, { ...ctx, suggestion })).toBe(
      'Bench Press · set 2 · 102.5 × 5',
    );
    expect(nextSetText(next, bench, ctx)).toBe('Bench Press · set 2 · 5');
  });

  it('writes a timed set as its time', () => {
    let t = newTemplate({ id: 't', name: 'A', at: new Date(2026, 9, 1) });
    t = addTemplateExercise(t, plank);
    t = editTarget(t, 0, 0, { amount: 60 }, 'time');
    t = addTarget(t, 0, 'time');
    const s = fromTemplate(sessionOn(4), t, ids());
    const next = nextPendingSet(s, s.exercises[0].performed[0].id)!;
    expect(nextSetText(next, plank, ctx)).toBe('Plank · set 2 · 1:00');
  });

  it('writes a warm-up without an RPE, in the unit it was suggested in', () => {
    const newId = ids();
    let s = withSets(sessionOn(4), squat, [{ amount: 225, reps: 5, rpe: 8, unit: 'lb' }], newId);
    s = addExercise(s, bench, newId);
    s = insertWarmups(s, s.exercises[1].id, warmupSets(135, 'lb', 5, newId));
    const next = nextPendingSet(s, s.exercises[0].performed[0].id)!;
    expect(next.warmup).toBe(true);
    expect(nextSetText(next, bench, { ...ctx, unit: 'lb' })).toBe(
      'Bench Press · warm-up 1 · 45 lb × 8',
    );
  });

  it('is just the name and place when nothing is known', () => {
    const s = addExercise(addExercise(sessionOn(4), bench, ids()), squat, ids('y'));
    const next = nextPendingSet(s, s.exercises[0].performed[0].id)!;
    expect(nextSetText(next, squat, ctx)).toBe('Low-Bar Squat · set 1');
  });
});
