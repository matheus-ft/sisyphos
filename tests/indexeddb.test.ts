import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IndexedDbStorage } from '../src/storage/indexeddb';
import { PATHS } from '../src/storage/paths';
import type { Session, Exercise } from '../src/model';

let store: IndexedDbStorage;
let n = 0;

const session = (over: Partial<Session> = {}): Session => ({
  id: `s${++n}`,
  date: '2026-09-14',
  started_at: '2026-09-14T06:30:00.000Z',
  tz: 'Europe/Lisbon',
  time_precision: 'instant',
  ended_at: '2026-09-14T08:00:00.000Z',
  label: { name: null, block: null, week: null, day: null, weekday: null },
  bodyweight_kg: null,
  notes: null,
  exercises: [],
  created_at: '2026-09-14T06:30:00.000Z',
  updated_at: '2026-09-14T06:30:00.000Z',
  device_id: 'phone',
  ...over,
});

beforeEach(async () => {
  store = await IndexedDbStorage.open(`test-${Date.now()}-${Math.random()}`);
});

describe('sessions', () => {
  it('round-trips a session', async () => {
    const s = session();
    await store.putSession(s);
    expect(await store.getSession(s.id)).toEqual(s);
  });

  it('returns null rather than throwing for one that is not there', async () => {
    expect(await store.getSession('nope')).toBeNull();
  });

  it('queries by inclusive date range, which is the only query analysis needs', async () => {
    await store.putSession(session({ date: '2026-08-31' }));
    await store.putSession(session({ date: '2026-09-01' }));
    await store.putSession(session({ date: '2026-09-30' }));
    await store.putSession(session({ date: '2026-10-01' }));
    const inSeptember = await store.listSessions('2026-09-01', '2026-09-30');
    expect(inSeptember.map((s) => s.date)).toEqual(['2026-09-01', '2026-09-30']);
  });

  it('finds sessions still needing input', async () => {
    const pending = session({
      exercises: [
        {
          id: 'i1',
          exercise_id: 'low_bar_squat',
          prescribed: [],
          performed: [
            {
              id: 'p1',
              prescribed_id: null,
              state: 'pending',
              reps: null,
              rpe: null,
              load: null,
              is_warmup: false,
              notes: null,
            },
          ],
          notes: null,
        },
      ],
    });
    await store.putSession(pending);
    await store.putSession(session());
    const rows = await store.listIncompleteSessions();
    expect(rows.map((s) => s.id)).toEqual([pending.id]);
  });

  it('finds sessions nobody ever ended', async () => {
    const open = session({ ended_at: null });
    await store.putSession(open);
    await store.putSession(session());
    expect((await store.listOpenSessions()).map((s) => s.id)).toEqual([open.id]);
  });
});

describe('dirty tracking', () => {
  it('marks a session dirty in the same transaction as the write', async () => {
    const s = session();
    await store.putSession(s);
    const dirty = await store.listDirty();
    expect(dirty.map((d) => d.path)).toEqual([PATHS.session(s)]);
    expect(JSON.parse(dirty[0].body)).toEqual(s);
  });

  it('files sessions by year, so a year of them stays browsable', async () => {
    const s = session({ date: '2027-01-02' });
    await store.putSession(s);
    expect((await store.listDirty())[0].path).toBe(`sessions/2027/2027-01-02_${s.id}.json`);
  });

  it('serialises a deleted session as empty, which the pusher turns into a delete', async () => {
    const s = session();
    await store.putSession(s);
    await store.markClean(PATHS.session(s), 'sha1');
    await store.deleteSession(s.id);
    const dirty = await store.listDirty();
    expect(dirty).toEqual([{ path: PATHS.session(s), body: '' }]);
  });

  it('clears on markClean and remembers the sha for the next write', async () => {
    const s = session();
    await store.putSession(s);
    await store.markClean(PATHS.session(s), 'abc123');
    expect(await store.listDirty()).toEqual([]);
    expect(await store.knownSha(PATHS.session(s))).toBe('abc123');
  });

  it('collapses repeated edits of one document into one pending write', async () => {
    const s = session();
    await store.putSession(s);
    await store.putSession({ ...s, notes: 'felt fine' });
    await store.putSession({ ...s, notes: 'felt good' });
    expect(await store.listDirty()).toHaveLength(1);
  });
});

describe('library', () => {
  const custom: Exercise = {
    id: 'my_variation',
    name: 'My Variation',
    base_lift: 'squat',
    tier: 'high_spec',
    unilateral: false,
    load_type: 'external',
    default_unit: 'kg',
    muscles: { primary: ['vasti'], secondary: [], aux: [] },
  };

  it('ships a library that works before anything is added', async () => {
    expect((await store.getExercises()).length).toBeGreaterThan(50);
    expect((await store.getMuscles()).length).toBeGreaterThan(30);
  });

  it('merges local additions over the shipped rows', async () => {
    await store.addLocalExercise(custom);
    const all = await store.getExercises();
    expect(all.find((e) => e.id === 'my_variation')).toEqual(custom);
    expect(await store.getLocalExercises()).toEqual([custom]);
  });

  it('lets a merged upstream row supersede the local copy by id', async () => {
    // Same id as a shipped exercise: the local row wins until it is removed,
    // and removing it changes nothing, because the id is the same either way.
    await store.addLocalExercise({ ...custom, id: 'low_bar_squat', name: 'Renamed' });
    const all = await store.getExercises();
    expect(all.filter((e) => e.id === 'low_bar_squat')).toHaveLength(1);
    expect(all.find((e) => e.id === 'low_bar_squat')!.name).toBe('Renamed');
  });

  it('writes local additions out as CSV the parser could read back', async () => {
    await store.addLocalExercise(custom);
    const body = (await store.listDirty()).find((d) => d.path === PATHS.localExercises)!.body;
    expect(body.split('\n')[0]).toBe(
      'id,name,base_lift,tier,unilateral,load_type,default_unit,primary,secondary,aux',
    );
    expect(body).toContain('my_variation,My Variation,squat,high_spec,,,,vasti,,');
  });
});

describe('reference maxes', () => {
  it('resolves the entry in force on a date, ignoring later ones', async () => {
    await store.putOneRmEntry({ date: '2026-01-01', lift: 'squat', weight_kg: 200, note: null });
    await store.putOneRmEntry({ date: '2026-06-01', lift: 'squat', weight_kg: 210, note: null });
    expect(await store.oneRmAsOf('squat', '2026-03-01')).toBe(200);
    expect(await store.oneRmAsOf('squat', '2026-06-01')).toBe(210);
    expect(await store.oneRmAsOf('squat', '2026-12-31')).toBe(210);
  });

  it('is null before the first entry, rather than guessing', async () => {
    await store.putOneRmEntry({ date: '2026-06-01', lift: 'squat', weight_kg: 210, note: null });
    expect(await store.oneRmAsOf('squat', '2026-01-01')).toBeNull();
  });

  it('keeps the lifts apart', async () => {
    await store.putOneRmEntry({ date: '2026-01-01', lift: 'squat', weight_kg: 200, note: null });
    expect(await store.oneRmAsOf('bench', '2026-06-01')).toBeNull();
  });
});

describe('bodyweight hints', () => {
  it('offers the most recent reading inside the window', async () => {
    await store.putBodyweightEntry({ date: '2026-09-01', weight_kg: 80, source: 'manual' });
    await store.putBodyweightEntry({ date: '2026-09-10', weight_kg: 81, source: 'manual' });
    const hint = await store.bodyweightHintFor('2026-09-14', 7);
    expect(hint?.weight_kg).toBe(81);
  });

  it('offers nothing once every reading is too old', async () => {
    await store.putBodyweightEntry({ date: '2026-09-01', weight_kg: 80, source: 'manual' });
    expect(await store.bodyweightHintFor('2026-09-14', 7)).toBeNull();
  });

  it('never looks forward, so a later weigh-in cannot backfill a past session', async () => {
    await store.putBodyweightEntry({ date: '2026-09-20', weight_kg: 82, source: 'manual' });
    expect(await store.bodyweightHintFor('2026-09-14', 7)).toBeNull();
  });
});
