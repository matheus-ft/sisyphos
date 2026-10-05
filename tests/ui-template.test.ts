import { describe, expect, it } from 'vitest';
import exercisesCsv from '../src/library/exercises.csv?raw';
import musclesCsv from '../src/library/muscles.csv?raw';
import { parseExercises, parseMuscles } from '../src/library/parse';
import { newSession, fromTemplate, targetsOf } from '../src/ui/session';
import { parseTemplate, serializeTemplate } from '../src/storage/formats';
import {
  addTarget,
  addTemplateExercise,
  editTarget,
  moveTemplateExercise,
  newTemplate,
  removeTarget,
  removeTemplateExercise,
  rename,
  setLabel,
  setTemplateRest,
  targetAmount,
} from '../src/ui/template';

const muscles = parseMuscles(musclesCsv);
const library = parseExercises(exercisesCsv, new Set(muscles.map((m) => m.id)));
const squat = library.find((e) => e.id === 'low_bar_squat')!;
const plank = library.find((e) => e.id === 'plank')!;

const blank = () =>
  newTemplate({ id: 'squat-day-k3f9', name: 'Squat day', at: new Date(2026, 9, 4) });

describe('a template being built', () => {
  it('adds an exercise with one target, planned by feel until a load is given', () => {
    const t = addTemplateExercise(blank(), squat);
    expect(t.exercises).toEqual([
      {
        exercise_id: 'low_bar_squat',
        rest_s: null,
        prescribed: [
          {
            reps: null,
            rpe: null,
            load: { kind: 'weight', weight: { mode: 'rpe_driven' } },
            is_warmup: false,
            notes: null,
          },
        ],
      },
    ]);
  });

  it('sets a target exactly, and clears its load back to by feel', () => {
    let t = addTemplateExercise(blank(), squat);
    t = editTarget(t, 0, 0, { amount: 140, reps: 5, rpe: 8 }, 'weight');
    expect(t.exercises[0].prescribed[0]).toMatchObject({
      reps: [5, 5],
      rpe: [8, 8],
      load: { kind: 'weight', weight: { mode: 'absolute', kg: [140, 140] } },
    });
    expect(targetAmount(t.exercises[0].prescribed[0])).toBe(140);
    t = editTarget(t, 0, 0, { amount: null }, 'weight');
    expect(t.exercises[0].prescribed[0].load).toEqual({
      kind: 'weight',
      weight: { mode: 'rpe_driven' },
    });
  });

  it('times unloaded work', () => {
    let t = addTemplateExercise(blank(), plank);
    t = editTarget(t, 0, 0, { amount: 60, reps: 3 }, 'time');
    expect(t.exercises[0].prescribed[0]).toMatchObject({
      reps: null,
      load: { kind: 'time', seconds: [60, 60] },
    });
  });

  it('adds a target copying the last, and removes targets, exercises, and renames', () => {
    let t = addTemplateExercise(blank(), squat);
    t = editTarget(t, 0, 0, { amount: 140, reps: 5 }, 'weight');
    t = addTarget(t, 0, 'weight');
    expect(t.exercises[0].prescribed).toHaveLength(2);
    expect(t.exercises[0].prescribed[1]).toEqual(t.exercises[0].prescribed[0]);
    expect(removeTarget(t, 0, 1).exercises[0].prescribed).toHaveLength(1);
    expect(removeTemplateExercise(t, 0).exercises).toEqual([]);
    expect(rename(t, 'Heavy squat').name).toBe('Heavy squat');
  });

  it('starts a session whose empty sets show the targets', () => {
    let t = addTemplateExercise(blank(), squat);
    t = editTarget(t, 0, 0, { amount: 140, reps: 5, rpe: 8 }, 'weight');
    let n = 0;
    const s = fromTemplate(
      newSession({
        id: '2026-10-04-a1b2',
        at: new Date(2026, 9, 4),
        tz: 'Europe/Lisbon',
        deviceId: 'phone',
      }),
      t,
      () => `id${++n}`,
    );
    const [e] = s.exercises;
    expect(e.performed[0].state).toBe('pending');
    expect(targetsOf(e, e.performed[0])).toEqual({ amount: '140', reps: '5', rpe: '8' });
  });
});

describe('where a template sits in a program, and how long it rests', () => {
  it('starts in no program, every rest the tier default', () => {
    const t = addTemplateExercise(blank(), squat);
    expect(t.label).toEqual({ name: null, block: null, week: null, day: null, weekday: null });
    expect(t.exercises[0].rest_s).toBeNull();
  });

  it('changes the label field by field', () => {
    let t = setLabel(blank(), { name: 'Off-season 2026', week: 3 });
    t = setLabel(t, { day: 2 });
    expect(t.label).toEqual({
      name: 'Off-season 2026',
      block: null,
      week: 3,
      day: 2,
      weekday: null,
    });
    expect(setLabel(t, { week: null }).label.week).toBeNull();
  });

  it('sets one exercise’s rest, in whole seconds', () => {
    let t = addTemplateExercise(addTemplateExercise(blank(), squat), plank);
    t = setTemplateRest(t, 0, 180.2);
    expect(t.exercises.map((e) => e.rest_s)).toEqual([180, null]);
    expect(setTemplateRest(t, 0, null).exercises[0].rest_s).toBeNull();
  });

  it('is what a session started from it begins with', () => {
    let t = setLabel(addTemplateExercise(blank(), squat), { name: 'Block 1', block: 1 });
    t = setTemplateRest(t, 0, 240);
    let n = 0;
    const s = fromTemplate(
      newSession({ id: '2026-10-04-a1b2', at: new Date(2026, 9, 4), tz: 'UTC', deviceId: 'p' }),
      t,
      () => `id${++n}`,
    );
    expect(s.label).toEqual(t.label);
    expect(s.exercises[0].rest_s).toBe(240);
  });
});

describe('a template as the log stores it', () => {
  it('reads back exactly as written, empty targets included', () => {
    let t = addTemplateExercise(addTemplateExercise(blank(), squat), plank);
    t = editTarget(t, 0, 0, { amount: 140, reps: 5, rpe: 8 }, 'weight');
    t = addTarget(t, 0, 'weight');
    t = setTemplateRest(setLabel(t, { name: 'Off-season', weekday: 'friday' }), 1, 45);
    expect(parseTemplate(serializeTemplate(t))).toEqual(t);
  });
});

describe('the order of a template', () => {
  it('moves an exercise up or down', () => {
    const t = addTemplateExercise(addTemplateExercise(blank(), squat), plank);
    expect(moveTemplateExercise(t, 1, -1).exercises.map((e) => e.exercise_id)).toEqual([
      'plank',
      'low_bar_squat',
    ]);
  });
});
