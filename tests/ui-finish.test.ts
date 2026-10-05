import { describe, expect, it } from 'vitest';
import type { Session } from '../src/model';
import { BOULDER_CAP, boulderProgress, finishStats, workingSetsDone } from '../src/ui/finish';
import { addSet, editSet, finish, fromTemplate, setDate, skipSet } from '../src/ui/session';
import { addTarget, addTemplateExercise, editTarget, newTemplate } from '../src/ui/template';
import { byId, ids, library, sessionOn, withSets } from './ui-fixtures';

const squat = byId('low_bar_squat');
const bench = byId('bench');
const dips = byId('dips');
const plank = byId('plank');
const pinMachine = byId('adductor_machine');

/** A session of `n` done working sets of one exercise. */
function ofSets(day: number, n: number, id = `s${day}`): Session {
  return withSets(
    sessionOn(day, id),
    squat,
    Array.from({ length: n }, () => ({ amount: 100, reps: 5, rpe: 8 })),
  );
}

/** A session planned as `sets` squat targets, none done. */
function plannedSquats(sets: number): Session {
  let t = newTemplate({ id: 't', name: 'A', at: new Date(2026, 9, 1) });
  t = addTemplateExercise(t, squat);
  t = editTarget(t, 0, 0, { amount: 100, reps: 5, rpe: 8 }, 'weight');
  for (let i = 1; i < sets; i++) t = addTarget(t, 0, 'weight');
  return fromTemplate(sessionOn(20, 'now'), t, ids());
}

function doSet(s: Session, i: number, rpe = 8): Session {
  const e = s.exercises[0];
  return editSet(s, e.id, e.performed[i].id, { amount: 100, reps: 5, rpe }, 'weight', 'kg');
}

describe('the boulder with a plan', () => {
  it('climbs by done working sets over the planned ones', () => {
    let s = plannedSquats(4);
    expect(boulderProgress(s, [])).toMatchObject({
      done: 0,
      target: 4,
      fraction: 0,
      basis: 'plan',
    });
    s = doSet(s, 0);
    expect(boulderProgress(s, [])).toMatchObject({ done: 1, target: 4, fraction: 0.25 });
    s = doSet(s, 1);
    expect(boulderProgress(s, []).fraction).toBe(0.5);
  });

  it('owes less for a skipped set', () => {
    let s = plannedSquats(4);
    s = skipSet(s, s.exercises[0].id, s.exercises[0].performed[3].id, true);
    s = doSet(s, 0);
    expect(boulderProgress(s, [])).toMatchObject({ done: 1, target: 3 });
    expect(boulderProgress(s, []).fraction).toBeCloseTo(1 / 3);
  });

  it('does not count warm-ups, planned or done', () => {
    let s = plannedSquats(2);
    const e = s.exercises[0];
    s = {
      ...s,
      exercises: [{ ...e, prescribed: [{ ...e.prescribed[0], is_warmup: true }, e.prescribed[1]] }],
    };
    s = editSet(s, e.id, e.performed[0].id, { is_warmup: true }, 'weight', 'kg');
    s = doSet(s, 0);
    expect(workingSetsDone(s)).toBe(0);
    expect(boulderProgress(s, [])).toMatchObject({ done: 0, target: 1 });
  });

  it('never reaches the top before Finish, however many sets are done', () => {
    let s = plannedSquats(2);
    s = doSet(s, 0);
    s = doSet(s, 1);
    expect(boulderProgress(s, []).fraction).toBe(BOULDER_CAP);
    s = addSet(s, s.exercises[0].id, ids('z'));
    s = doSet(s, 2);
    s = doSet(s, 2);
    expect(boulderProgress(s, []).fraction).toBe(BOULDER_CAP);
    expect(BOULDER_CAP).toBeLessThan(1);
  });

  it('arrives at the top on Finish', () => {
    let s = plannedSquats(4);
    s = doSet(s, 0);
    expect(boulderProgress(s, [], { finished: true }).fraction).toBe(1);
    expect(boulderProgress(plannedSquats(4), [], { finished: true }).fraction).toBe(1);
  });

  it('uses the history when every planned set was skipped', () => {
    let s = plannedSquats(1);
    s = skipSet(s, s.exercises[0].id, s.exercises[0].performed[0].id, true);
    const got = boulderProgress(s, [ofSets(10, 6)]);
    expect(got).toMatchObject({ target: 6, basis: 'history' });
  });
});

describe('the boulder with nothing planned', () => {
  const now = () => withSets(sessionOn(20, 'now'), squat, [{ amount: 100, reps: 5, rpe: 8 }]);

  it('aims at the median working-set count of the last four sessions', () => {
    const others = [ofSets(10, 3), ofSets(11, 5), ofSets(12, 9), ofSets(13, 7)];
    expect(boulderProgress(now(), others)).toMatchObject({ target: 6, basis: 'history' });
    expect(boulderProgress(now(), [ofSets(10, 3), ofSets(11, 5), ofSets(12, 9)])).toMatchObject({
      target: 5,
    });
  });

  it('looks only at the four most recent, newest by date', () => {
    const others = [
      ofSets(1, 20),
      ofSets(2, 20),
      ofSets(10, 4),
      ofSets(11, 4),
      ofSets(12, 4),
      ofSets(13, 4),
    ];
    expect(boulderProgress(now(), others).target).toBe(4);
    expect(boulderProgress(now(), [...others].reverse()).target).toBe(4);
  });

  it('rounds an even median to a whole set', () => {
    expect(boulderProgress(now(), [ofSets(10, 4), ofSets(11, 5)]).target).toBe(5);
    expect(boulderProgress(now(), [ofSets(10, 4), ofSets(11, 7)]).target).toBe(6);
  });

  it('leaves out this session, empty sessions and sessions after its date', () => {
    const others = [now(), sessionOn(12, 'empty'), ofSets(25, 30), ofSets(10, 6)];
    expect(boulderProgress(now(), others)).toMatchObject({ target: 6, basis: 'history' });
  });

  it('does not count warm-ups or skipped and pending sets in a past session', () => {
    let past = ofSets(10, 4);
    const e = past.exercises[0];
    past = skipSet(past, e.id, e.performed[3].id, true);
    past = addSet(past, e.id, ids('z'));
    past = editSet(past, e.id, e.performed[0].id, { is_warmup: true }, 'weight', 'kg');
    expect(boulderProgress(now(), [past]).target).toBe(2);
  });

  it('has a default target with no history, and a target of at least one', () => {
    expect(boulderProgress(now(), [])).toMatchObject({ target: 15, basis: 'default' });
    expect(boulderProgress(now(), [ofSets(10, 1)]).target).toBe(1);
  });

  it('is capped below the top whatever the target', () => {
    const s = withSets(
      sessionOn(20, 'now'),
      squat,
      Array.from({ length: 5 }, () => ({ amount: 100, reps: 5, rpe: 8 })),
    );
    expect(boulderProgress(s, [ofSets(10, 2)]).fraction).toBe(BOULDER_CAP);
  });

  it('starts at the foot', () => {
    expect(boulderProgress(sessionOn(20, 'now'), [ofSets(10, 4)]).fraction).toBe(0);
  });
});

const lookup = (id: string) => library.find((e) => e.id === id);
const never = () => false;

function stats(s: Session, over: Partial<Parameters<typeof finishStats>[1]> = {}) {
  return finishStats(s, {
    exercise: lookup,
    now: new Date(2026, 9, 4, 19, 0),
    isRecord: never,
    ...over,
  });
}

describe('the finish stats', () => {
  it('measures the duration in minutes from the start to the end', () => {
    // Whole minutes as History and Train count them, so 77:40 is 77 everywhere.
    const s = finish(ofSets(4, 1), new Date(2026, 9, 4, 19, 17, 40));
    expect(stats(s).durationMin).toBe(77);
  });

  it('measures to now while the session is still open', () => {
    expect(stats(ofSets(4, 1)).durationMin).toBe(60);
    expect(stats(ofSets(4, 1), { now: new Date(2026, 9, 4, 17, 0) }).durationMin).toBe(0);
  });

  it('has no duration for a planned session or one logged after the fact', () => {
    const planned = { ...ofSets(4, 1), started_at: null };
    expect(stats(planned).durationMin).toBeNull();
    expect(stats(setDate(ofSets(4, 1), '2026-09-30')).durationMin).toBeNull();
  });

  it('counts done working sets only', () => {
    let s = withSets(sessionOn(4), squat, [
      { amount: 60, reps: 5, warmup: true },
      { amount: 100, reps: 5, rpe: 8 },
      { amount: 100, reps: 5, rpe: 8 },
    ]);
    s = addSet(s, s.exercises[0].id, ids('z'));
    s = addSet(s, s.exercises[0].id, ids('y'));
    s = skipSet(s, s.exercises[0].id, s.exercises[0].performed[4].id, true);
    expect(stats(s).sets).toBe(2);
    expect(workingSetsDone(s)).toBe(2);
  });

  it('adds tonnage in kilograms, converting pounds and leaving warm-ups out', () => {
    const s = withSets(sessionOn(4), squat, [
      { amount: 60, reps: 5, warmup: true },
      { amount: 100, reps: 5, rpe: 8 },
      { amount: 225, reps: 3, rpe: 8, unit: 'lb' },
    ]);
    // 500 + 675 lb (306.17 kg).
    expect(stats(s).tonnageKg).toBe(806);
  });

  it('leaves pin settings out of the tonnage but not out of the sets', () => {
    const s = withSets(sessionOn(4), pinMachine, [
      { amount: 8, reps: 12, rpe: 7, unit: 'pins' },
      { amount: 8, reps: 12, rpe: 8, unit: 'pins' },
    ]);
    expect(stats(s)).toMatchObject({ tonnageKg: 0, sets: 2 });
  });

  it('counts bodyweight-plus work with the bodyweight on record, and not without', () => {
    const s = withSets(sessionOn(4), dips, [{ amount: 20, reps: 5, rpe: 8 }]);
    expect(stats(s).tonnageKg).toBe(0);
    expect(stats({ ...s, bodyweight_kg: 80 }).tonnageKg).toBe(500);
  });

  it('counts both sides of a unilateral exercise', () => {
    const split = library.find((e) => e.unilateral && e.load_type === 'external')!;
    const s = withSets(sessionOn(4), split, [{ amount: 20, reps: 10, rpe: 8 }]);
    expect(stats(s).tonnageKg).toBe(400);
  });

  it('skips tonnage for an exercise the library no longer holds, but counts the set', () => {
    const s = ofSets(4, 2);
    const got = stats(s, { exercise: () => undefined });
    expect(got).toMatchObject({ tonnageKg: 0, sets: 2 });
    expect(got.topSets[0]).toMatchObject({ exercise_id: 'low_bar_squat', name: 'low_bar_squat' });
  });

  describe('top sets', () => {
    it("is each exercise's heaviest done working set, written like formatSet", () => {
      let s = withSets(sessionOn(4), squat, [
        { amount: 60, reps: 5, warmup: true },
        { amount: 140, reps: 5, rpe: 8 },
        { amount: 145, reps: 3, rpe: 9 },
        { amount: 130, reps: 8, rpe: 8 },
      ]);
      s = withSets(s, bench, [{ amount: 92.5, reps: 5, rpe: 8 }], ids('b'));
      expect(stats(s).topSets.map((t) => [t.name, t.text])).toEqual([
        ['Low-Bar Squat', '145 × 3 @ 9'],
        ['Bench Press', '92.5 × 5 @ 8'],
      ]);
    });

    it('is the one with more reps, then the later, among equals', () => {
      const s = withSets(sessionOn(4), squat, [
        { amount: 140, reps: 5, rpe: 8 },
        { amount: 140, reps: 6, rpe: 9 },
        { amount: 140, reps: 6, rpe: 9.5 },
      ]);
      expect(stats(s).topSets[0].text).toBe('140 × 6 @ 9.5');
    });

    it('compares pounds with kilograms by mass', () => {
      const s = withSets(sessionOn(4), squat, [
        { amount: 140, reps: 5, rpe: 8 },
        { amount: 315, reps: 3, rpe: 8, unit: 'lb' },
      ]);
      // 315 lb is 142.9 kg.
      expect(stats(s).topSets[0].text).toBe('315 lb × 3 @ 8');
    });

    it('ranks pin settings among themselves', () => {
      const s = withSets(sessionOn(4), pinMachine, [
        { amount: 8, reps: 12, rpe: 7, unit: 'pins' },
        { amount: 10, reps: 10, rpe: 8, unit: 'pins' },
      ]);
      expect(stats(s).topSets[0].text).toBe('10 pins × 10 @ 8');
    });

    it("is a bodyweight-plus exercise's heaviest added load", () => {
      const s = withSets(sessionOn(4), dips, [
        { amount: 10, reps: 8, rpe: 7 },
        { amount: 20, reps: 5, rpe: 8 },
      ]);
      expect(stats(s).topSets[0].text).toBe('+20 × 5 @ 8');
    });

    it("is a timed exercise's longest hold", () => {
      let s = sessionOn(4);
      s = withSets(s, plank, [{ amount: 60, reps: 1 }]);
      const e = s.exercises[0];
      s = editSet(s, e.id, e.performed[0].id, { amount: 60 }, 'time', 'kg');
      s = addSet(s, e.id, ids('z'));
      s = editSet(s, e.id, s.exercises[0].performed[1].id, { amount: 90 }, 'time', 'kg');
      expect(stats(s).topSets[0].text).toBe('1:30');
    });

    it("merges an exercise done in two places and keeps the session's order", () => {
      let s = withSets(sessionOn(4), squat, [{ amount: 100, reps: 5, rpe: 8 }]);
      s = withSets(s, bench, [{ amount: 80, reps: 5, rpe: 8 }], ids('b'));
      s = withSets(s, squat, [{ amount: 120, reps: 5, rpe: 8 }], ids('c'));
      expect(stats(s).topSets.map((t) => t.text)).toEqual(['120 × 5 @ 8', '80 × 5 @ 8']);
    });

    it('leaves out an exercise with nothing done', () => {
      const s = withSets(sessionOn(4), squat, [{ amount: 60, reps: 5, warmup: true }]);
      expect(stats(s).topSets).toEqual([]);
    });
  });

  describe('records', () => {
    it('counts the done working sets the predicate calls records', () => {
      const s = withSets(sessionOn(4), squat, [
        { amount: 60, reps: 5, warmup: true },
        { amount: 140, reps: 5, rpe: 8 },
        { amount: 145, reps: 3, rpe: 9 },
      ]);
      const [, a, b] = s.exercises[0].performed;
      expect(stats(s, { isRecord: (_i, set) => set.id === a.id || set.id === b.id }).records).toBe(
        2,
      );
      expect(stats(s, { isRecord: () => true }).records).toBe(2);
      expect(stats(s).records).toBe(0);
    });

    it('is asked about no set that is not done work, and gets the exercise instance', () => {
      let s = withSets(sessionOn(4), squat, [
        { amount: 60, reps: 5, warmup: true },
        { amount: 140, reps: 5, rpe: 8 },
      ]);
      s = addSet(s, s.exercises[0].id, ids('z'));
      const asked: string[] = [];
      stats(s, {
        isRecord: (instance, set) => {
          asked.push(`${instance.id}:${set.id}`);
          return false;
        },
      });
      expect(asked).toEqual([`${s.exercises[0].id}:${s.exercises[0].performed[1].id}`]);
    });
  });

  it('reports an empty session as nothing', () => {
    expect(stats(sessionOn(4))).toEqual({
      durationMin: 60,
      sets: 0,
      tonnageKg: 0,
      topSets: [],
      records: 0,
    });
  });
});
