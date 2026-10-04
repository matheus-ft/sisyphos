import { describe, expect, it } from 'vitest';
import exercisesCsv from '../src/library/exercises.csv?raw';
import musclesCsv from '../src/library/muscles.csv?raw';
import { parseExercises, parseMuscles } from '../src/library/parse';
import type { Exercise, Session } from '../src/model';
import type { StatusSnapshot } from '../src/storage/status';
import {
  addExercise,
  addSet,
  editSet,
  finish,
  formatSet,
  fromTemplate,
  lastTime,
  lastUnit,
  localDate,
  needsBodyweight,
  newSession,
  parseNumber,
  parseRpe,
  parseSeconds,
  removeExercise,
  removeSet,
  setDone,
  targetOf,
  templateFrom,
} from '../src/ui/session';
import { statusLine } from '../src/ui/status';

const muscles = parseMuscles(musclesCsv);
const library = parseExercises(exercisesCsv, new Set(muscles.map((m) => m.id)));
const byId = (id: string): Exercise => library.find((e) => e.id === id)!;
const squat = byId('low_bar_squat');
const plank = byId('plank');
const bwPlus = library.find((e) => e.load_type === 'bw_plus')!;

/** Ids 1, 2, 3… so sessions are comparable. */
function ids(): () => string {
  let n = 0;
  return () => `id${++n}`;
}

function started(at = new Date(2026, 9, 4, 18, 30)): Session {
  return newSession({ id: '2026-10-04-k3f9', at, tz: 'Europe/Lisbon', deviceId: 'phone' });
}

/** A session with one squat set of 140 × 5 @ 8, done. */
function withSquat(newId = ids()): Session {
  let s = addExercise(started(), squat, newId);
  const [e] = s.exercises;
  const set = e.performed[0].id;
  s = editSet(s, e.id, set, { amount: 140, reps: 5, rpe: 8 }, 'weight', 'kg');
  return setDone(s, e.id, set, true);
}

describe('a session being logged', () => {
  it('starts open, today, empty', () => {
    const s = started();
    expect(s.date).toBe('2026-10-04');
    expect(s.ended_at).toBeNull();
    expect(s.exercises).toEqual([]);
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('adds an exercise with one empty pending set', () => {
    const s = addExercise(started(), squat, ids());
    expect(s.exercises).toHaveLength(1);
    expect(s.exercises[0].exercise_id).toBe('low_bar_squat');
    expect(s.exercises[0].performed).toEqual([
      expect.objectContaining({ state: 'pending', load: null, reps: null, rpe: null }),
    ]);
  });

  it('ticks a set done only once it is complete', () => {
    const newId = ids();
    let s = addExercise(started(), squat, newId);
    const [e] = s.exercises;
    const set = e.performed[0].id;
    s = editSet(s, e.id, set, { amount: 140, reps: 5 }, 'weight', 'kg');
    expect(setDone(s, e.id, set, true).exercises[0].performed[0].state).toBe('pending');
    s = editSet(s, e.id, set, { rpe: 8 }, 'weight', 'kg');
    expect(setDone(s, e.id, set, true).exercises[0].performed[0].state).toBe('done');
  });

  it('lets a warm-up be done without an RPE', () => {
    let s = addExercise(started(), squat, ids());
    const [e] = s.exercises;
    const set = e.performed[0].id;
    s = editSet(s, e.id, set, { amount: 60, reps: 5, is_warmup: true }, 'weight', 'kg');
    expect(setDone(s, e.id, set, true).exercises[0].performed[0].state).toBe('done');
  });

  it('sends a done set back to pending when an edit leaves it incomplete', () => {
    const s = withSquat();
    const [e] = s.exercises;
    const edited = editSet(s, e.id, e.performed[0].id, { rpe: null }, 'weight', 'kg');
    expect(edited.exercises[0].performed[0].state).toBe('pending');
  });

  it('keeps the unit when only the number changes, and the number when only the unit does', () => {
    const s = withSquat();
    const [e] = s.exercises;
    const set = e.performed[0].id;
    const lb = editSet(s, e.id, set, { unit: 'lb' }, 'weight', 'kg');
    expect(lb.exercises[0].performed[0].load).toEqual({ kind: 'weight', value: 140, unit: 'lb' });
    const more = editSet(lb, e.id, set, { amount: 315 }, 'weight', 'kg');
    expect(more.exercises[0].performed[0].load).toEqual({ kind: 'weight', value: 315, unit: 'lb' });
  });

  it('times unloaded work in seconds, with no reps', () => {
    let s = addExercise(started(), plank, ids());
    const [e] = s.exercises;
    const set = e.performed[0].id;
    s = editSet(s, e.id, set, { amount: 60, reps: 3 }, 'time', 'kg');
    expect(s.exercises[0].performed[0]).toMatchObject({
      load: { kind: 'time', seconds: 60 },
      reps: null,
    });
    expect(setDone(s, e.id, set, true).exercises[0].performed[0].state).toBe('done');
    expect(formatSet(s.exercises[0].performed[0])).toBe('1:00');
  });

  it('adds a set copying the last one, pending', () => {
    const newId = ids();
    const s = addSet(withSquat(newId), 'id1', newId);
    const [first, second] = s.exercises[0].performed;
    expect(second).toMatchObject({ load: first.load, reps: 5, rpe: 8, state: 'pending' });
    expect(second.id).not.toBe(first.id);
  });

  it('removes sets and exercises', () => {
    const s = withSquat();
    const [e] = s.exercises;
    expect(removeSet(s, e.id, e.performed[0].id).exercises[0].performed).toEqual([]);
    expect(removeExercise(s, e.id).exercises).toEqual([]);
  });

  it('asks for bodyweight only for bodyweight-plus work, until the session has it', () => {
    const s = started();
    expect(needsBodyweight(s, bwPlus)).toBe(true);
    expect(needsBodyweight(s, squat)).toBe(false);
    expect(needsBodyweight({ ...s, bodyweight_kg: 82 }, bwPlus)).toBe(false);
  });

  it('finishes by setting the end time', () => {
    const at = new Date(2026, 9, 4, 20, 0);
    expect(finish(started(), at).ended_at).toBe(at.toISOString());
  });
});

describe('what came before', () => {
  const earlier: Session = { ...withSquat(), id: '2026-09-30-a1b2', date: '2026-09-30' };

  it('shows the done sets of the last other session with the exercise', () => {
    expect(lastTime(squat, [earlier, started()], started().id)).toBe('140 × 5 @ 8');
    expect(lastTime(plank, [earlier], started().id)).toBeNull();
  });

  it('starts the unit where the lifter last left it, else at the library hint', () => {
    const inLb: Session = {
      ...earlier,
      exercises: earlier.exercises.map((e) => ({
        ...e,
        performed: e.performed.map((s) => ({
          ...s,
          load: { kind: 'weight', value: 315, unit: 'lb' },
        })),
      })),
    };
    expect(lastUnit(squat, [inLb], started().id)).toBe('lb');
    expect(lastUnit(squat, [], started().id)).toBe(squat.default_unit);
  });
});

describe('templates', () => {
  it('turns done sets into targets, and starts a session showing them', () => {
    const template = templateFrom(withSquat(), {
      id: 'squat-day-k3f9',
      name: 'Squat day',
      at: new Date(2026, 9, 4),
    });
    expect(template.exercises).toEqual([
      {
        exercise_id: 'low_bar_squat',
        prescribed: [
          {
            reps: [5, 5],
            rpe: [8, 8],
            load: { kind: 'weight', weight: { mode: 'absolute', kg: [140, 140] } },
            is_warmup: false,
            notes: null,
          },
        ],
      },
    ]);

    const next = fromTemplate(started(), template, ids());
    const [e] = next.exercises;
    expect(e.performed).toEqual([
      expect.objectContaining({ state: 'pending', prescribed_id: e.prescribed[0].id }),
    ]);
    expect(targetOf(e, e.performed[0])).toBe('140 × 5 @ 8');
  });
});

describe('the status line', () => {
  const snapshot = (over: Partial<StatusSnapshot>): StatusSnapshot => ({
    status: 'idle',
    nextRetryAt: null,
    message: null,
    conflicts: 0,
    libraryConflicts: 0,
    unreadable: [],
    exposure: {
      level: 'safe',
      unsyncedDocuments: 0,
      oldestUnsyncedMinutes: null,
      message: 'Everything is in the log.',
    },
    ...over,
  });

  it('is calm during a session, when syncing waits on purpose', () => {
    expect(statusLine(snapshot({}), true)).toEqual({
      text: 'Saved on this phone · syncs when you finish',
      alarm: false,
    });
  });

  it('raises an alarm when there is nowhere to sync to, or sync stopped', () => {
    expect(statusLine(snapshot({ status: 'not_set_up' }), false).alarm).toBe(true);
    expect(
      statusLine(snapshot({ status: 'needs_token', message: 'Paste a new token.' }), false),
    ).toEqual({
      text: 'Paste a new token.',
      alarm: true,
    });
  });

  it('counts conflicts, saying nothing was lost', () => {
    expect(statusLine(snapshot({ conflicts: 2 }), false).text).toBe(
      'Synced · 2 conflicts kept, none lost',
    );
  });
});

describe('what was typed', () => {
  it('reads numbers, with a comma as decimal point, and refuses the rest', () => {
    expect(parseNumber(' 142,5 ')).toBe(142.5);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('abc')).toBeUndefined();
    expect(parseNumber('-5')).toBeUndefined();
  });

  it('reads seconds as 90 or 1:30', () => {
    expect(parseSeconds('1:30')).toBe(90);
    expect(parseSeconds('45')).toBe(45);
    expect(parseSeconds('1:75')).toBeUndefined();
  });

  it('reads an RPE in halves from 1 to 10', () => {
    expect(parseRpe('8.5')).toBe(8.5);
    expect(parseRpe('8.3')).toBeUndefined();
    expect(parseRpe('11')).toBeUndefined();
  });
});
