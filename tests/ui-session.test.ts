import { describe, expect, it } from 'vitest';
import exercisesCsv from '../src/library/exercises.csv?raw';
import musclesCsv from '../src/library/muscles.csv?raw';
import { parseExercises, parseMuscles } from '../src/library/parse';
import type { Exercise, Session } from '../src/model';
import type { StatusSnapshot } from '../src/storage/status';
import {
  addExercise,
  addSet,
  doneCount,
  exerciseIdFrom,
  historyOf,
  nameProblem,
  setExerciseNotes,
  skipSet,
  start,
  editSet,
  finish,
  formatSet,
  fromTemplate,
  lastTime,
  lastUnit,
  localDate,
  move,
  moveExercise,
  needsBodyweight,
  newSession,
  parseNumber,
  parseRpe,
  parseSeconds,
  planSet,
  removeExercise,
  removeSet,
  restSeconds,
  setDate,
  setRest,
  targetsOf,
  templateFrom,
} from '../src/ui/session';
import { statusLine } from '../src/ui/status';
import { parseSession, serializeSession } from '../src/storage/formats';
import { sessionInProgress } from '../src/storage/scheduler';

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
  const s = addExercise(started(), squat, newId);
  const [e] = s.exercises;
  const set = e.performed[0].id;
  return editSet(s, e.id, set, { amount: 140, reps: 5, rpe: 8 }, 'weight', 'kg');
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
    expect(s.exercises[0].rest_s).toBeNull();
    expect(s.exercises[0].performed).toEqual([
      expect.objectContaining({ state: 'pending', load: null, reps: null, rpe: null }),
    ]);
  });

  it('counts a set done once its numbers are complete, and pending until then', () => {
    let s = addExercise(started(), squat, ids());
    const [e] = s.exercises;
    const set = e.performed[0].id;
    s = editSet(s, e.id, set, { amount: 140, reps: 5 }, 'weight', 'kg');
    expect(s.exercises[0].performed[0].state).toBe('pending');
    s = editSet(s, e.id, set, { rpe: 8 }, 'weight', 'kg');
    expect(s.exercises[0].performed[0].state).toBe('done');
  });

  it('counts a warm-up done without an RPE', () => {
    let s = addExercise(started(), squat, ids());
    const [e] = s.exercises;
    s = editSet(
      s,
      e.id,
      e.performed[0].id,
      { amount: 60, reps: 5, is_warmup: true },
      'weight',
      'kg',
    );
    expect(s.exercises[0].performed[0].state).toBe('done');
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
      state: 'done',
    });
    expect(formatSet(s.exercises[0].performed[0])).toBe('1:00');
  });

  it('adds a set copying the last load and reps but not the RPE, so it waits to be lifted', () => {
    const newId = ids();
    const s = addSet(withSquat(newId), 'id1', newId);
    const [first, second] = s.exercises[0].performed;
    expect(second).toMatchObject({ load: first.load, reps: 5, rpe: null, state: 'pending' });
    expect(second.id).not.toBe(first.id);
  });

  it('adds an empty set after a timed one, which a copy would count as held', () => {
    const newId = ids();
    let s = addExercise(started(), plank, newId);
    const [e] = s.exercises;
    s = editSet(s, e.id, e.performed[0].id, { amount: 60 }, 'time', 'kg');
    expect(addSet(s, e.id, newId).exercises[0].performed[1]).toMatchObject({
      load: null,
      state: 'pending',
    });
  });

  it('moves to another date, which makes its clock time meaningless', () => {
    const moved = setDate(started(), '2026-10-01');
    expect(moved).toMatchObject({ date: '2026-10-01', time_precision: 'date_only' });
    expect(setDate(moved, '2026-10-04').time_precision).toBe('instant');
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
        rest_s: null,
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
    expect(targetsOf(e, e.performed[0])).toEqual({ amount: '140', reps: '5', rpe: '8' });
  });

  it('carry the program label and each target rest from session to template and back', () => {
    const label = { name: 'Off-season', block: 2, week: 3, day: 1, weekday: 'monday' };
    const logged = withSquat();
    const session: Session = {
      ...setRest(logged, logged.exercises[0].id, 210),
      label,
    };
    const template = templateFrom(session, {
      id: 'squat-day-k3f9',
      name: 'Squat day',
      at: new Date(),
    });
    expect(template.label).toEqual(label);
    expect(template.exercises[0].rest_s).toBe(210);

    const next = fromTemplate(started(), template, ids());
    expect(next.label).toEqual(label);
    expect(next.exercises[0].rest_s).toBe(210);
    // Copies, not shared: relabelling one leaves the other as it was.
    next.label.week = 4;
    expect(template.label.week).toBe(3);
  });
});

describe('the target rest', () => {
  it('changes for one exercise of the session only, and back to the tier default', () => {
    const newId = ids();
    const s = addExercise(withSquat(newId), plank, newId);
    const [squatId, plankId] = s.exercises.map((e) => e.id);
    const longer = setRest(s, squatId, 195);
    expect(longer.exercises.map((e) => e.rest_s)).toEqual([195, null]);
    expect(setRest(longer, squatId, null).exercises[0].rest_s).toBeNull();
    expect(setRest(longer, plankId, 60).exercises.map((e) => e.rest_s)).toEqual([195, 60]);
  });

  it('is kept as whole seconds of at least one, which the log can hold', () => {
    expect(restSeconds(null)).toBeNull();
    expect(restSeconds(90.4)).toBe(90);
    expect(restSeconds(0)).toBe(1);
    expect(restSeconds(-15)).toBe(1);
    expect(restSeconds(NaN)).toBeNull();
    expect(restSeconds(Infinity)).toBeNull();
    const s = withSquat();
    const saved = setRest(s, s.exercises[0].id, 89.6);
    expect(parseSession(serializeSession(saved))).toEqual(saved);
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

describe('the order of exercises', () => {
  it('moves an item within the list, never past either end', () => {
    expect(move(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(move(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(move(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(move(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });

  it('moves an exercise up or down the session, by its id', () => {
    const newId = ids();
    const s = addExercise(addExercise(started(), squat, newId), plank, newId);
    const plankId = s.exercises[1].id;
    const moved = moveExercise(s, plankId, -1);
    expect(moved.exercises.map((e) => e.exercise_id)).toEqual(['plank', 'low_bar_squat']);
    expect(moveExercise(moved, plankId, -1)).toEqual(moved);
  });
});

describe('a planned session', () => {
  const at = new Date(2026, 9, 4, 12, 30);
  const planned = () =>
    newSession({
      id: '2026-10-04-p1an',
      at,
      tz: 'Europe/Lisbon',
      deviceId: 'phone',
      planned: true,
    });

  it('has no start until it is started, and holds no sync back meanwhile', () => {
    expect(planned().started_at).toBeNull();
    expect(sessionInProgress([planned()], at)).toBe(false);
  });

  it('starts now and today, whenever it was planned for', () => {
    const tonight = new Date(2026, 9, 5, 19, 0);
    const s = start({ ...planned(), date: '2026-10-01', time_precision: 'date_only' }, tonight);
    expect(s).toMatchObject({
      started_at: tonight.toISOString(),
      date: '2026-10-05',
      time_precision: 'instant',
    });
    // Starting it is a write, which stamps updated_at.
    expect(sessionInProgress([{ ...s, updated_at: tonight.toISOString() }], tonight)).toBe(true);
  });

  it('fills a set in ahead without lifting it: numbers kept, still pending, no RPE', () => {
    const s = addExercise(planned(), squat, ids());
    const [e] = s.exercises;
    const set = e.performed[0].id;
    const edit = { amount: 140, reps: 5, rpe: 8 };
    const next = planSet(s, e.id, set, edit, 'weight', 'kg').exercises[0].performed[0];
    expect(next).toMatchObject({
      state: 'pending',
      load: { kind: 'weight', value: 140, unit: 'kg' },
      reps: 5,
      rpe: null,
    });
  });

  it('keeps a planned warm-up and a planned hold pending too, though their numbers would finish them', () => {
    const newId = ids();
    let s = addExercise(addExercise(planned(), squat, newId), plank, newId);
    const [lift, hold] = s.exercises;
    const warm = { amount: 60, reps: 5, is_warmup: true };
    s = planSet(s, lift.id, lift.performed[0].id, warm, 'weight', 'kg');
    s = planSet(s, hold.id, hold.performed[0].id, { amount: 60 }, 'time', 'kg');
    expect(s.exercises.map((e) => e.performed[0].state)).toEqual(['pending', 'pending']);
    expect(s.exercises[0].performed[0].is_warmup).toBe(true);
    expect(s.exercises[1].performed[0].load).toEqual({ kind: 'time', seconds: 60 });
  });

  it('reads back from the log exactly as written', () => {
    const s = addExercise(planned(), squat, ids());
    expect(parseSession(serializeSession(s))).toEqual(s);
  });
});

describe('skipping, notes and counting', () => {
  it('skips a set, emptying it, and unskips it to pending', () => {
    const s = withSquat();
    const [e] = s.exercises;
    const skipped = skipSet(s, e.id, e.performed[0].id, true);
    expect(skipped.exercises[0].performed[0]).toMatchObject({
      state: 'skipped',
      load: null,
      rpe: null,
    });
    expect(skipSet(skipped, e.id, e.performed[0].id, false).exercises[0].performed[0].state).toBe(
      'pending',
    );
  });

  it('keeps a note per exercise, empty meaning none', () => {
    const s = withSquat();
    const id = s.exercises[0].id;
    expect(setExerciseNotes(s, id, 'belt from set 3').exercises[0].notes).toBe('belt from set 3');
    expect(setExerciseNotes(s, id, '  ').exercises[0].notes).toBeNull();
  });

  it('counts done sets, so a new one shows as a set just finished', () => {
    expect(doneCount(started())).toBe(0);
    expect(doneCount(withSquat())).toBe(1);
  });
});

describe("an exercise's history", () => {
  it('lists every session with it, newest first, with its done sets', () => {
    const older: Session = { ...withSquat(), id: '2026-09-28-a1b2', date: '2026-09-28' };
    const newer: Session = { ...withSquat(), id: '2026-10-01-c3d4', date: '2026-10-01' };
    const history = historyOf(squat, [older, started(), newer]);
    expect(history.map((h) => h.session.date)).toEqual(['2026-10-01', '2026-09-28']);
    expect(history[0].sets).toEqual(['140 × 5 @ 8']);
  });
});

describe('a new exercise', () => {
  it('takes its id from its name', () => {
    expect(exerciseIdFrom('Pin Squat (high)')).toBe('pin_squat_high');
    expect(exerciseIdFrom('Agachamento Búlgaro')).toBe('agachamento_bulgaro');
  });

  it('refuses names the submission workflow would refuse', () => {
    expect(nameProblem('Pin Squat')).toBeNull();
    expect(nameProblem('Squat, paused')).not.toBeNull();
    expect(nameProblem('#1 squat')).not.toBeNull();
    expect(nameProblem('  ')).not.toBeNull();
  });
});
