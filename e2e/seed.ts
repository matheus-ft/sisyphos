// Seeds the app the way the lifter's phone looks ten weeks into a rebuild, so a
// test can open any screen with something on it. It writes through the dev-only
// `window.__sisyphos` (src/main.ts) rather than tapping weeks of sessions in.
//
// Everything is dated relative to today, so the suite does not rot; the
// numbers in it are the ones the tests read back:
// - Mon/Wed/Fri sessions for the ten weeks before this one (squat and bench,
//   deadlift and press, squat variation and bench), warm-ups, RPEs, accessories,
//   loads climbing (squat 120 to 142.5, bench 80 to 95, deadlift 140 to 172.5).
// - Last week's Friday has two sets still pending (History's marker).
// - A template "Squat and bench" labelled Rebuild, block 2, week 6, day 1, Monday.
// - Weigh-ins, reference maxes (squat 150, bench 100, deadlift 180, in August)
//   and one hand-entered record (low-bar squat, 1 rep, 155 kg, in March).
import type { Page } from '@playwright/test';

/** What the seeding writes: only the shapes it fills, not the app's full model. */
interface SeedSet {
  id: string;
  prescribed_id: null;
  state: 'done' | 'pending';
  reps: number | null;
  rpe: number | null;
  load: { kind: 'weight'; value: number; unit: 'kg' } | { kind: 'time'; seconds: number };
  is_warmup: boolean;
  notes: null;
}
interface SeedExercise {
  id: string;
  exercise_id: string;
  rest_s: number | null;
  prescribed: never[];
  performed: SeedSet[];
  notes: string | null;
}
interface SeedLabel {
  name: string;
  block: number;
  week: number;
  day: number;
  weekday: string;
}
interface SeedSession {
  id: string;
  date: string;
  started_at: string;
  tz: string;
  time_precision: 'instant';
  ended_at: string;
  label: SeedLabel;
  bodyweight_kg: number | null;
  notes: string | null;
  exercises: SeedExercise[];
  created_at: string;
  updated_at: string;
  device_id: string;
}
interface SeedPrescribed {
  reps: [number, number];
  rpe: [number, number];
  load: {
    kind: 'weight';
    weight:
      | { mode: 'rpe_driven' }
      | { mode: 'absolute'; kg: [number, number] }
      | { mode: 'pct_1rm'; pct: [number, number]; lift: string };
  };
  is_warmup: boolean;
  notes: null;
}
interface SeedTemplate {
  id: string;
  name: string;
  intention: string;
  label: SeedLabel;
  exercises: { exercise_id: string; rest_s: number; prescribed: SeedPrescribed[] }[];
  created_at: string;
  updated_at: string;
}

/** The slice of the app (`src/ui/app.svelte.ts`) the seeding touches. */
interface SisyphosApp {
  storage: {
    log: {
      newSessionId(date: string): Promise<string>;
      newTemplateId(name: string): Promise<string>;
      putSession(session: SeedSession): Promise<void>;
      putTemplate(template: SeedTemplate): Promise<void>;
      putRow(kind: string, row: Record<string, unknown>): Promise<void>;
    };
  } | null;
  sessions: { started_at: string | null }[];
  templates: unknown[];
  load(): Promise<void>;
  create(from: unknown, options: { planned: boolean }): Promise<void>;
  go(route: { name: 'train' }): void;
}
declare global {
  interface Window {
    __sisyphos?: SisyphosApp;
  }
}

/**
 * Opens the app without sync and, unless `bare`, with ten weeks of history and
 * today's session planned from the template, ending on Train.
 */
export async function openSeeded(page: Page, options: { bare?: boolean } = {}): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Use without sync' }).click();
  await page.getByRole('button', { name: 'Start an empty session' }).waitFor();
  if (options.bare) return;
  await seed(page);
  await planToday(page);
  await page.getByRole('button', { name: 'Start', exact: true }).waitFor();
}

/** Ten weeks of history, a template, weigh-ins and reference maxes. Skips a page that has sessions. */
export async function seed(page: Page): Promise<string> {
  await page.waitForFunction(() => window.__sisyphos?.storage, null, { timeout: 15000 });
  return page.evaluate(async () => {
    const app = window.__sisyphos!;
    const log = app.storage!.log;
    if (app.sessions.length > 0) return 'already seeded';

    const pad = (n: number) => String(n).padStart(2, '0');
    const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const at = (d: Date, h: number, m = 0) => {
      const x = new Date(d);
      x.setHours(h, m, 0, 0);
      return x;
    };
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let n = 0;
    const id = (): string => `x${(n++).toString(36)}`;
    const w = (kg: number, reps: number, rpe: number | null, warm = false): SeedSet => ({
      id: id(),
      prescribed_id: null,
      state: 'done',
      reps,
      rpe: warm ? null : rpe,
      load: { kind: 'weight', value: kg, unit: 'kg' },
      is_warmup: warm,
      notes: null,
    });
    const timed = (seconds: number): SeedSet => ({
      id: id(),
      prescribed_id: null,
      state: 'done',
      reps: null,
      rpe: null,
      load: { kind: 'time', seconds },
      is_warmup: false,
      notes: null,
    });
    const pending = (kg: number, reps: number): SeedSet => ({
      ...w(kg, reps, null),
      state: 'pending',
    });
    const ex = (
      exercise_id: string,
      performed: SeedSet[],
      rest_s: number | null = null,
      notes: string | null = null,
    ): SeedExercise => ({
      id: id(),
      exercise_id,
      rest_s,
      prescribed: [],
      performed,
      notes,
    });
    const round = (x: number, step = 2.5) => Math.round(x / step) * step;
    const warmups = (top: number) =>
      [20, round(top * 0.45), round(top * 0.65), round(top * 0.82)].map((kg, i) =>
        w(kg, [8, 5, 3, 2][i], null, true),
      );
    const label = (week: number, day: number, weekday: string): SeedLabel => ({
      name: 'Rebuild',
      block: week <= 5 ? 1 : 2,
      week: week <= 5 ? week : week - 5,
      day,
      weekday,
    });

    const sessions: SeedSession[] = [];
    for (let week = 1; week <= 10; week++) {
      const base = new Date(monday);
      base.setDate(monday.getDate() - 7 * (11 - week));
      const t = (week - 1) / 9;
      const squat = round(120 + 22.5 * t);
      const bench = round(80 + 15 * t);
      const dead = round(140 + 32.5 * t);
      const rpe = [7, 7.5, 8, 8, 8.5, 7, 7.5, 8, 8.5, 9][week - 1];
      const bw = Math.round((84.5 - 0.15 * week) * 10) / 10;
      const days = [
        {
          offset: 0,
          day: 1,
          weekday: 'Mon',
          bw,
          exercises: [
            ex(
              'low_bar_squat',
              [
                ...warmups(squat),
                w(squat - 10, 5, rpe - 1),
                w(squat, 5, rpe),
                w(squat, 5, rpe + 0.5),
              ],
              180,
            ),
            ex(
              'bench',
              [
                ...warmups(bench).slice(1),
                w(bench, 5, rpe - 0.5),
                w(bench, 5, rpe),
                w(bench, 5, rpe),
                w(bench, 5, rpe + 0.5),
              ],
              180,
            ),
            ex(
              'romanian_deadlift',
              [
                w(round(dead * 0.62), 8, 7),
                w(round(dead * 0.62), 8, 7.5),
                w(round(dead * 0.62), 8, 8),
              ],
              120,
            ),
          ],
        },
        {
          offset: 2,
          day: 2,
          weekday: 'Wed',
          bw: null,
          exercises: [
            ex(
              'conventional_deadlift',
              [...warmups(dead), w(dead, 4, rpe), w(dead - 10, 4, rpe - 0.5), w(dead - 10, 4, rpe)],
              210,
            ),
            ex(
              'overhead_press',
              [
                w(round(bench * 0.62), 8, 7.5),
                w(round(bench * 0.62), 8, 8),
                w(round(bench * 0.62), 7, 8.5),
              ],
              120,
            ),
            ex(
              'barbell_row',
              [
                w(round(bench * 0.8), 10, 7.5),
                w(round(bench * 0.8), 10, 8),
                w(round(bench * 0.8), 10, 8),
              ],
              90,
            ),
            ex('plank', [timed(45), timed(45), timed(60)], 60),
          ],
        },
        {
          offset: 4,
          day: 3,
          weekday: 'Fri',
          bw,
          exercises: [
            ex(
              'paused_squat',
              [
                ...warmups(squat * 0.85),
                w(round(squat * 0.85), 3, rpe - 0.5),
                w(round(squat * 0.85), 3, rpe),
                w(round(squat * 0.85), 3, rpe),
              ],
              150,
            ),
            ex(
              'bench',
              [
                w(round(bench * 0.92), 6, rpe - 0.5),
                w(round(bench * 0.92), 6, rpe),
                w(round(bench * 0.92), 6, rpe + 0.5),
              ],
              180,
            ),
            ex('dips', [w(10, 8, 8), w(10, 8, 8.5), w(10, 7, 9)], 90),
          ],
        },
      ];
      for (const d of days) {
        const date = new Date(base);
        date.setDate(base.getDate() + d.offset);
        const start = at(date, 18, (week * 7) % 30);
        const minutes = 48 + ((week + d.day) % 4) * 6;
        const end = new Date(start.getTime() + minutes * 60000);
        sessions.push({
          id: await log.newSessionId(iso(date)),
          date: iso(date),
          started_at: start.toISOString(),
          tz,
          time_precision: 'instant',
          ended_at: end.toISOString(),
          label: label(week, d.day, d.weekday),
          bodyweight_kg: d.exercises.some((e) => e.exercise_id === 'dips') ? (d.bw ?? bw) : null,
          notes: week === 10 && d.day === 3 ? 'Left shoulder tight, stopped early.' : null,
          exercises: d.exercises,
          created_at: start.toISOString(),
          updated_at: end.toISOString(),
          device_id: 'seed',
        });
      }
    }
    // Last Friday stopped early: the last bench set and a dips set left pending.
    const lastFri = sessions.at(-1)!;
    lastFri.exercises[1].performed[2] = pending(round(95 * 0.92), 6);
    lastFri.exercises[2].performed[2] = pending(10, 8);
    for (const s of sessions) await log.putSession(s);

    const template: SeedTemplate = {
      id: await log.newTemplateId('Squat and bench'),
      name: 'Squat and bench',
      intention: 'Top set, then back-offs. Add 2.5 when the top set is at or under target.',
      label: { name: 'Rebuild', block: 2, week: 6, day: 1, weekday: 'Mon' },
      exercises: [
        {
          exercise_id: 'low_bar_squat',
          rest_s: 180,
          prescribed: [
            {
              reps: [5, 5],
              rpe: [8, 8],
              load: { kind: 'weight', weight: { mode: 'rpe_driven' } },
              is_warmup: false,
              notes: null,
            },
            {
              reps: [5, 5],
              rpe: [7, 8],
              load: {
                kind: 'weight',
                weight: { mode: 'pct_1rm', pct: [0.85, 0.85], lift: 'squat' },
              },
              is_warmup: false,
              notes: null,
            },
            {
              reps: [5, 5],
              rpe: [7, 8],
              load: {
                kind: 'weight',
                weight: { mode: 'pct_1rm', pct: [0.85, 0.85], lift: 'squat' },
              },
              is_warmup: false,
              notes: null,
            },
          ],
        },
        {
          exercise_id: 'bench',
          rest_s: 180,
          prescribed: Array.from({ length: 4 }, () => ({
            reps: [3, 5],
            rpe: [8, 8],
            load: { kind: 'weight', weight: { mode: 'absolute', kg: [95, 95] } },
            is_warmup: false,
            notes: null,
          })),
        },
        {
          exercise_id: 'romanian_deadlift',
          rest_s: 120,
          prescribed: Array.from({ length: 3 }, () => ({
            reps: [8, 10],
            rpe: [7, 8],
            load: { kind: 'weight', weight: { mode: 'rpe_driven' } },
            is_warmup: false,
            notes: null,
          })),
        },
      ],
      created_at: new Date(monday.getTime() - 30 * 86400000).toISOString(),
      updated_at: new Date(monday.getTime() - 30 * 86400000).toISOString(),
    };
    await log.putTemplate(template);

    for (const [date, weight] of [
      [-63, 85.1],
      [-49, 84.7],
      [-35, 84.6],
      [-21, 84.0],
      [-7, 83.6],
      [-2, 83.4],
    ]) {
      const d = new Date(today);
      d.setDate(today.getDate() + date);
      await log.putRow('bodyweight', { date: iso(d), weight_kg: weight, source: 'manual' });
    }
    const aug = `${today.getFullYear()}-08-01`;
    for (const [lift, kg] of [
      ['squat', 150],
      ['bench', 100],
      ['deadlift', 180],
    ]) {
      await log.putRow('oneRm', { date: aug, lift, weight_kg: kg, note: null });
    }
    await log.putRow('manualRecords', {
      date: `${today.getFullYear()}-03-14`,
      exercise_id: 'low_bar_squat',
      reps: 1,
      weight_kg: 155,
      rpe: 9.5,
      context: 'Gym mock meet, before the layoff',
    });
    await app.load();
    return `seeded ${sessions.length} sessions`;
  });
}

/** Plans today's session from the template, through the app's own action, and shows Train. */
export async function planToday(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const app = window.__sisyphos!;
    if (app.sessions.some((s) => s.started_at === null)) return 'already planned';
    await app.create(app.templates[0], { planned: true });
    app.go({ name: 'train' });
    return 'planned';
  });
}
