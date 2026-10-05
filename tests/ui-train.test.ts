import { describe, expect, it } from 'vitest';
import exercisesCsv from '../src/library/exercises.csv?raw';
import musclesCsv from '../src/library/muscles.csv?raw';
import { parseExercises, parseMuscles } from '../src/library/parse';
import type { Session } from '../src/model';
import { newSession } from '../src/ui/session';
import { setLabel, addTemplateExercise, newTemplate } from '../src/ui/template';
import {
  firstSessionOfWeek,
  isPlanned,
  lastFinished,
  lastSessionLine,
  plansOf,
  sessionName,
  templateLine,
} from '../src/ui/train';

const muscles = parseMuscles(musclesCsv);
const library = parseExercises(exercisesCsv, new Set(muscles.map((m) => m.id)));
const squat = library.find((e) => e.id === 'low_bar_squat')!;
const row = library.find((e) => e.id === 'barbell_row')!;

// Monday 5 October 2026.
const TODAY = '2026-10-05';

function session(id: string, date: string, patch: Partial<Session> = {}): Session {
  return {
    ...newSession({
      id,
      at: new Date(`${date}T18:00:00`),
      tz: 'UTC',
      deviceId: 'p',
      planned: true,
    }),
    date,
    ...patch,
  };
}

const finished = (id: string, date: string, minutes = 54): Session =>
  session(id, date, {
    started_at: new Date(`${date}T18:00:00`).toISOString(),
    ended_at: new Date(new Date(`${date}T18:00:00`).getTime() + minutes * 60_000).toISOString(),
  });

describe('which plans are due', () => {
  const sessions = [
    session('far', '2026-10-20'),
    session('wed', '2026-10-07'),
    session('today', TODAY),
    session('old', '2026-10-01'),
    session('fri', '2026-10-09'),
    session('next', '2026-10-12'),
    finished('done', '2026-10-02'),
    session('started', TODAY, { started_at: '2026-10-05T07:00:00.000Z' }),
  ];

  it('sorts them into today, overdue, this week and ahead', () => {
    const plans = plansOf(sessions, TODAY);
    expect(plans.today.map((s) => s.id)).toEqual(['today']);
    expect(plans.overdue.map((s) => s.id)).toEqual(['old']);
    expect(plans.thisWeek.map((s) => s.id)).toEqual(['wed', 'fri']);
    expect(plans.ahead.map((s) => s.id)).toEqual(['next', 'far']);
  });

  it('counts only sessions never started as plans', () => {
    expect(isPlanned(sessions[6])).toBe(false);
    expect(isPlanned(sessions[7])).toBe(false);
    expect(isPlanned(sessions[2])).toBe(true);
  });

  it('keeps Sunday in the week that began on Monday', () => {
    const plans = plansOf([session('sun', '2026-10-11')], TODAY);
    expect(plans.thisWeek).toHaveLength(1);
    expect(plansOf([session('sun', '2026-10-11')], '2026-10-11').today).toHaveLength(1);
  });
});

describe('the last session', () => {
  it('is the latest finished one, by date then start', () => {
    const list = [
      finished('a', '2026-10-01'),
      finished('b', '2026-10-02'),
      session('plan', '2026-10-03'),
    ];
    expect(lastFinished(list)?.id).toBe('b');
    expect(lastFinished([session('plan', '2026-10-03')])).toBeNull();
  });

  it('reads as a line, with a weekday while that is unambiguous', () => {
    const friday = finished('f', '2026-10-02');
    friday.exercises = [
      {
        id: 'e',
        exercise_id: 'bench',
        rest_s: null,
        prescribed: [],
        notes: null,
        performed: Array.from({ length: 7 }, (_, i) => ({
          id: `s${i}`,
          prescribed_id: null,
          state: 'done' as const,
          reps: 5,
          rpe: 8,
          load: { kind: 'weight' as const, value: 90, unit: 'kg' as const },
          is_warmup: false,
          notes: null,
        })),
      },
    ];
    expect(lastSessionLine(friday, TODAY)).toBe('Last session Friday · 54 min · 7 sets');
    expect(lastSessionLine(friday, '2026-10-03')).toBe('Last session yesterday · 54 min · 7 sets');
    expect(lastSessionLine(friday, '2026-10-15')).toBe('Last session 2 October · 54 min · 7 sets');
  });

  it('leaves out minutes it cannot know', () => {
    const past = { ...finished('p', '2026-10-02'), time_precision: 'date_only' as const };
    expect(lastSessionLine(past, TODAY)).toBe('Last session Friday · 0 sets');
  });
});

describe('the first session of a week', () => {
  it('is until one is started this week', () => {
    expect(firstSessionOfWeek([finished('last', '2026-10-02')], TODAY)).toBe(true);
    expect(firstSessionOfWeek([finished('this', TODAY)], TODAY)).toBe(false);
    expect(firstSessionOfWeek([session('plan', TODAY)], TODAY)).toBe(true);
  });
});

describe('what a plan is called', () => {
  const plan = (...ids: string[]) => ({
    exercises: ids.map((exercise_id) => ({
      id: exercise_id,
      exercise_id,
      rest_s: null,
      prescribed: [],
      performed: [],
      notes: null,
    })),
  });

  it('names the lifts it trains', () => {
    expect(sessionName(plan('low_bar_squat', 'bench', 'romanian_deadlift'), library)).toBe(
      'Squat, bench and deadlift',
    );
    expect(sessionName(plan('low_bar_squat', 'bench'), library)).toBe('Squat and bench');
    expect(sessionName(plan('paused_squat', 'low_bar_squat'), library)).toBe('Squat');
  });

  it('falls back to the first exercises when none is a competition lift', () => {
    expect(row.base_lift).toBeNull();
    expect(sessionName(plan('barbell_row', 'plank', 'pullup'), library)).toBe(
      'Barbell Row and Plank',
    );
    expect(sessionName(plan(), library)).toBe('Empty session');
  });
});

describe('a template in a list', () => {
  it('shows its program label, else what it holds', () => {
    const t = newTemplate({ id: 'x', name: 'Squat day', at: new Date() });
    expect(templateLine(t)).toBe('Nothing in it yet');
    const one = addTemplateExercise(t, squat);
    expect(templateLine(one)).toBe('1 exercise');
    expect(templateLine(addTemplateExercise(one, row))).toBe('2 exercises');
    expect(templateLine(setLabel(one, { name: 'Rebuild', block: 2, week: 3, day: 1 }))).toBe(
      'Rebuild · block 2 · week 3 · day 1',
    );
  });
});
