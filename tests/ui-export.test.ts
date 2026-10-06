import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/csv';
import {
  durationMin,
  SESSIONS_COLUMNS,
  SETS_COLUMNS,
  sessionsCsv,
  setsCsv,
} from '../src/ui/export';
import { byId, sessionOf, squat } from './analysis-fixtures';

const plank = byId('plank');
const pinMachine = byId('adductor_machine');
const dips = byId('dips');

describe('sets.csv', () => {
  it('has the columns DATA.md names, in its order', () => {
    expect(setsCsv([]).split('\n')[0]).toBe(
      'session_id,date,exercise_id,set_n,reps,rpe,load_kg,is_warmup,state',
    );
    expect(SETS_COLUMNS).toHaveLength(9);
  });

  it('writes one row per set, numbered within the exercise from 1', () => {
    const s = sessionOf({
      date: '2026-10-04',
      work: [
        [
          squat,
          [
            { load: 60, reps: 5, warmup: true },
            { load: 140, reps: 5, rpe: 8 },
            { load: 142.5, reps: 4, rpe: 8.5 },
          ],
        ],
      ],
    });
    expect(setsCsv([s])).toBe(
      [
        'session_id,date,exercise_id,set_n,reps,rpe,load_kg,is_warmup,state',
        `${s.id},2026-10-04,low_bar_squat,1,5,,60,true,done`,
        `${s.id},2026-10-04,low_bar_squat,2,5,8,140,,done`,
        `${s.id},2026-10-04,low_bar_squat,3,4,8.5,142.5,,done`,
        '',
      ].join('\n'),
    );
  });

  it('converts pounds to kilograms to the centigram', () => {
    const s = sessionOf({
      date: '2026-10-04',
      work: [[squat, [{ load: 225, unit: 'lb', reps: 5, rpe: 8 }]]],
    });
    expect(parseCsv(setsCsv([s]))[0].load_kg).toBe('102.06');
  });

  it('leaves the load empty for pins, which are not a mass', () => {
    const s = sessionOf({
      date: '2026-10-04',
      work: [[pinMachine, [{ load: 9, unit: 'pins', reps: 12, rpe: 8 }]]],
    });
    expect(parseCsv(setsCsv([s]))[0]).toMatchObject({ load_kg: '', reps: '12', state: 'done' });
  });

  it('leaves the load and reps empty for a timed set', () => {
    const s = sessionOf({ date: '2026-10-04', work: [[plank, [{ load: 60 }]]] });
    expect(parseCsv(setsCsv([s]))[0]).toMatchObject({
      load_kg: '',
      reps: '',
      rpe: '',
      state: 'done',
    });
  });

  it('exports the load added to a bodyweight-plus lift, not bodyweight with it', () => {
    const s = sessionOf({
      date: '2026-10-04',
      bodyweightKg: 80,
      work: [[dips, [{ load: 20, reps: 8, rpe: 8 }]]],
    });
    expect(parseCsv(setsCsv([s]))[0].load_kg).toBe('20');
  });

  it('keeps pending and skipped sets, which is what the state column is for', () => {
    const s = sessionOf({
      date: '2026-10-04',
      work: [
        [
          squat,
          [
            { load: 140, reps: 5 },
            { load: 140, reps: 5, rpe: 8, skip: true },
          ],
        ],
      ],
    });
    const rows = parseCsv(setsCsv([s]));
    expect(rows.map((r) => r.state)).toEqual(['pending', 'skipped']);
    expect(rows[1]).toMatchObject({ reps: '', rpe: '', load_kg: '' });
  });

  it('keeps counting when an exercise comes up again in a session', () => {
    const s = sessionOf({
      date: '2026-10-04',
      work: [
        [squat, [{ load: 140, reps: 5, rpe: 8 }]],
        [byId('bench'), [{ load: 100, reps: 5, rpe: 8 }]],
        [squat, [{ load: 100, reps: 8, rpe: 7 }]],
      ],
    });
    expect(parseCsv(setsCsv([s])).map((r) => `${r.exercise_id}:${r.set_n}`)).toEqual([
      'low_bar_squat:1',
      'bench:1',
      'low_bar_squat:2',
    ]);
  });

  it('lists sessions in the order they happened', () => {
    const early = sessionOf({
      date: '2026-10-01',
      work: [[squat, [{ load: 100, reps: 5, rpe: 8 }]]],
    });
    const late = sessionOf({
      date: '2026-10-04',
      work: [[squat, [{ load: 100, reps: 5, rpe: 8 }]]],
    });
    expect(parseCsv(setsCsv([late, early])).map((r) => r.date)).toEqual([
      '2026-10-01',
      '2026-10-04',
    ]);
  });

  it('ends in exactly one newline, with no carriage returns', () => {
    const text = setsCsv([sessionOf({ date: '2026-10-04', work: [[squat, [{}]]] })]);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    expect(text).not.toContain('\r');
  });
});

describe('sessions.csv', () => {
  it('has the columns DATA.md names, with the five program label fields as columns', () => {
    expect(sessionsCsv([]).split('\n')[0]).toBe(
      'session_id,date,tz,duration_min,program_name,program_block,program_week,program_day,program_weekday,bodyweight_kg,notes',
    );
    expect(SESSIONS_COLUMNS).toHaveLength(11);
  });

  it('writes the session, its duration, label and bodyweight', () => {
    const base = sessionOf({
      date: '2026-10-04',
      bodyweightKg: 82.5,
      lastedMin: 75,
      work: [[squat, [{}]]],
    });
    const s = {
      ...base,
      label: { name: 'Off-season 2026', block: 2, week: 3, day: 1, weekday: 'sunday' },
      notes: 'Felt good',
    };
    expect(sessionsCsv([s])).toBe(
      [
        'session_id,date,tz,duration_min,program_name,program_block,program_week,program_day,program_weekday,bodyweight_kg,notes',
        `${s.id},2026-10-04,Europe/Lisbon,75,Off-season 2026,2,3,1,sunday,82.5,Felt good`,
        '',
      ].join('\n'),
    );
  });

  it('leaves absent things empty', () => {
    const s = sessionOf({ date: '2026-10-04', work: [] });
    expect(parseCsv(sessionsCsv([s]))[0]).toMatchObject({
      duration_min: '',
      program_name: '',
      program_block: '',
      program_week: '',
      program_day: '',
      program_weekday: '',
      bodyweight_kg: '',
      notes: '',
    });
  });

  it('quotes notes with commas, quotes and line breaks so they read back whole', () => {
    const base = sessionOf({ date: '2026-10-04', work: [] });
    const notes = 'Heavy, "grindy"\nsecond line';
    const [row] = parseCsv(sessionsCsv([{ ...base, notes }]));
    expect(row.notes).toBe(notes);
  });

  it('exports a planned session with no duration', () => {
    const s = sessionOf({ date: '2026-10-06', planned: true, work: [] });
    expect(parseCsv(sessionsCsv([s]))[0]).toMatchObject({ date: '2026-10-06', duration_min: '' });
  });

  it('lists sessions in the order they happened', () => {
    const early = sessionOf({ date: '2026-10-01', work: [] });
    const late = sessionOf({ date: '2026-10-04', work: [] });
    expect(parseCsv(sessionsCsv([late, early])).map((r) => r.date)).toEqual([
      '2026-10-01',
      '2026-10-04',
    ]);
  });
});

describe('duration', () => {
  const base = sessionOf({ date: '2026-10-04', lastedMin: 90, work: [] });

  it('is whole minutes from start to end, counted as the screens count them', () => {
    const at = { ...base, started_at: '2026-10-04T18:00:00.000Z' };
    expect(durationMin({ ...at, ended_at: '2026-10-04T19:30:00.000Z' })).toBe(90);
    expect(durationMin({ ...at, ended_at: '2026-10-04T19:30:20.000Z' })).toBe(90);
    expect(durationMin({ ...at, ended_at: '2026-10-04T19:30:40.000Z' })).toBe(90);
  });

  it('is nothing while open, or when planned', () => {
    expect(durationMin({ ...base, ended_at: null })).toBeNull();
    expect(durationMin({ ...base, started_at: null })).toBeNull();
  });

  it('is nothing for a session entered after the fact', () => {
    expect(durationMin({ ...base, time_precision: 'date_only' })).toBeNull();
  });

  it('is nothing when the end precedes the start', () => {
    expect(durationMin({ ...base, ended_at: '2020-01-01T00:00:00.000Z' })).toBeNull();
  });
});
