import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import type {
  BodyweightEntry,
  ConflictRecord,
  Exercise,
  ExerciseAddition,
  ManualRecord,
  OneRmEntry,
  Session,
  Template,
} from '../src/model';
import {
  TABLES,
  exerciseRowHash,
  serializeConflict,
  serializeSession,
  tableText,
} from '../src/storage/formats';
import { ID_ALPHABET } from '../src/storage/ids';
import { Log, type LogOptions } from '../src/storage/log';
import { conflictPath, sessionPath, templatePath } from '../src/storage/paths';
import { IndexedDbStore } from '../src/storage/store/indexeddb';
import { MemoryStore } from '../src/storage/store/memory';
import type { Exclusive, LocalStore } from '../src/storage/store/store';
import { clock } from './store-contract';

// --- fixtures ----------------------------------------------------------------------

const DEVICE = 'this-device';
const T0 = '2026-09-14T08:00:00.000Z';
const T1 = '2026-09-14T08:01:00.000Z';

function exercise(id: string, changes: Partial<Exercise> = {}): Exercise {
  return {
    id,
    name: id,
    base_lift: null,
    tier: 'acc',
    unilateral: false,
    load_type: 'external',
    default_unit: 'kg',
    muscles: { primary: ['lats'], aux: [] },
    ...changes,
  };
}

const squat = exercise('low_bar_squat', {
  name: 'Low bar squat',
  base_lift: 'squat',
  tier: 'comp',
  muscles: { primary: ['quads', 'glutes'], aux: ['adductors'] },
});
const pulldown = exercise('lat_pulldown', {
  name: 'Lat pulldown',
  default_unit: 'pins',
  muscles: { primary: ['lats'], aux: ['biceps'] },
});
const sealRow = exercise('seal_row', { name: 'Seal row' });
const SHIPPED = [squat, pulldown];

function session(id: string, changes: Partial<Session> = {}): Session {
  const date = id.slice(0, 10);
  return {
    id,
    date,
    started_at: `${date}T06:30:00.000Z`,
    tz: 'Europe/Lisbon',
    time_precision: 'instant',
    ended_at: `${date}T08:00:00.000Z`,
    label: { name: null, block: null, week: null, day: null, weekday: null },
    bodyweight_kg: null,
    notes: null,
    exercises: [
      {
        id: 'instance-1',
        exercise_id: 'low_bar_squat',
        prescribed: [],
        performed: [
          {
            id: 'set-1',
            prescribed_id: null,
            state: 'done',
            reps: 5,
            rpe: 8,
            load: { kind: 'weight', value: 180, unit: 'kg' },
            is_warmup: false,
            notes: null,
          },
        ],
        notes: null,
      },
    ],
    created_at: `${date}T06:30:00.000Z`,
    updated_at: `${date}T06:30:00.000Z`,
    device_id: 'another-device',
    ...changes,
  };
}

function template(id: string, changes: Partial<Template> = {}): Template {
  return {
    id,
    name: 'Squat day A',
    intention: null,
    exercises: [
      {
        exercise_id: 'low_bar_squat',
        prescribed: [
          {
            reps: [5, 5],
            rpe: [7, 8],
            load: { kind: 'weight', weight: { mode: 'pct_1rm', pct: [0.8, 0.8], lift: 'squat' } },
            is_warmup: false,
            notes: null,
          },
        ],
      },
    ],
    created_at: '2026-09-01T10:00:00.000Z',
    updated_at: '2026-09-01T10:00:00.000Z',
    ...changes,
  };
}

const weighIn = (date: string, weight_kg: number): BodyweightEntry => ({
  date,
  weight_kg,
  source: 'manual',
});

/** A `random` that returns these values in turn, then repeats them. */
function sequence(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

/** The `random` values that draw `suffix`, one character per value. */
const drawing = (suffix: string) =>
  [...suffix].map((c) => ID_ALPHABET.indexOf(c) / ID_ALPHABET.length);

// --- the stores it runs over ---------------------------------------------------------

type Backend = (now: () => Date) => Promise<{
  store: LocalStore;
  /** The same data through a new instance, as after a relaunch. */
  reopen: () => Promise<LocalStore>;
}>;

const BACKENDS: Array<[string, Backend]> = [
  [
    'MemoryStore',
    async (now) => {
      const store = new MemoryStore({ now });
      return { store, reopen: async () => store.restart() };
    },
  ],
  [
    'IndexedDbStore',
    async (now) => {
      const name = `sisyphos-log-test-${crypto.randomUUID()}`;
      const store = await IndexedDbStore.open(name, { now });
      return { store, reopen: () => IndexedDbStore.open(name, { now }) };
    },
  ],
];

describe.each(BACKENDS)('Log over %s', (_name, backend) => {
  async function setup(options: Partial<LogOptions> = {}) {
    const c = clock(T0);
    const { store, reopen } = await backend(c.now);

    // Counts the applies and content reads the log makes.
    let applies = 0;
    const contentReads: string[] = [];
    const exclusive = store.exclusive.bind(store);
    store.exclusive = <T>(fn: (s: Exclusive) => Promise<T>) =>
      exclusive((s) =>
        fn({
          ...s,
          apply: (ops) => {
            applies++;
            return s.apply(ops);
          },
        }),
      );
    const content = store.content.bind(store);
    store.content = (path) => {
      contentReads.push(path);
      return content(path);
    };

    const logOptions: LogOptions = { deviceId: DEVICE, shipped: SHIPPED, now: c.now, ...options };
    return {
      store,
      log: new Log(store, logOptions),
      clock: c,
      applies: () => applies,
      contentReads,
      /** A new log over the data as it is on disk now. */
      fresh: async () => new Log(await reopen(), logOptions),
      /** Writes a file straight into the store, as a sync taking it would. */
      put: (path: string, text: string | null) =>
        exclusive((s) => s.apply([{ op: 'content', path, text }])),
    };
  }

  // --- sessions ----------------------------------------------------------------------

  describe('sessions', () => {
    it('writes a session to its file, stamped with the time and this device', async () => {
      const { log, store } = await setup();
      const s = session('2026-09-14-k3f9');
      await log.putSession(s);

      const written = { ...s, updated_at: T0, device_id: DEVICE };
      expect(await log.getSession(s.id)).toEqual(written);
      expect(await store.content(sessionPath(s.id))).toBe(serializeSession(written));
      expect(await log.getSession('2026-09-14-zzzz')).toBeNull();
    });

    it('skips a write whose only change would be when, or where, it was written', async () => {
      const { log, clock, applies } = await setup();
      const s = session('2026-09-14-k3f9');
      await log.putSession(s);
      expect(applies()).toBe(1);

      clock.advance(60_000);
      await log.putSession(s);
      await log.putSession({ ...s, updated_at: '2020-01-01T00:00:00.000Z', device_id: 'other' });
      expect(applies()).toBe(1);
      expect(await log.getSession(s.id)).toMatchObject({ updated_at: T0, device_id: DEVICE });
    });

    it('skips saving unchanged a session another device wrote', async () => {
      const { log, put, applies } = await setup();
      const theirs = session('2026-09-14-k3f9', { device_id: 'another-device' });
      await put(sessionPath(theirs.id), serializeSession(theirs));
      await log.putSession(theirs);
      expect(applies()).toBe(0);
      expect(await log.getSession(theirs.id)).toEqual(theirs);
    });

    it('writes a real change, with the new time', async () => {
      const { log, clock, applies } = await setup();
      const s = session('2026-09-14-k3f9');
      await log.putSession(s);
      clock.advance(60_000);
      await log.putSession({ ...s, notes: 'moved well' });
      expect(applies()).toBe(2);
      expect(await log.getSession(s.id)).toMatchObject({ notes: 'moved well', updated_at: T1 });
    });

    it('deletes a session, and writes nothing for one it does not hold', async () => {
      const { log, store, applies } = await setup();
      const s = session('2026-09-14-k3f9');
      await log.putSession(s);
      await log.deleteSession(s.id);
      expect(await log.getSession(s.id)).toBeNull();
      expect(await store.content(sessionPath(s.id))).toBeNull();
      expect(applies()).toBe(2);

      await log.deleteSession(s.id);
      await log.deleteSession('2026-01-01-0000');
      expect(applies()).toBe(2);
    });

    it('refuses an id that would file the record where sync never looks', async () => {
      const { log, applies } = await setup();
      await expect(log.putSession(session('not-a-date-k3f9'))).rejects.toThrow();
      await expect(log.putTemplate(template('a/b-k3f9'))).rejects.toThrow();
      expect(applies()).toBe(0);
    });

    it('lists a date range, inclusive, by date and then start time', async () => {
      const { log } = await setup();
      const sessions = [
        session('2026-09-13-aaaa'),
        session('2026-09-14-aaaa'),
        session('2026-09-14-bbbb', { started_at: '2026-09-14T05:00:00.000Z' }),
        session('2026-09-15-aaaa'),
        session('2026-09-20-aaaa'),
      ];
      for (const s of sessions) await log.putSession(s);

      const listed = await log.listSessions('2026-09-14', '2026-09-15');
      expect(listed.map((s) => s.id)).toEqual([
        '2026-09-14-bbbb',
        '2026-09-14-aaaa',
        '2026-09-15-aaaa',
      ]);
      expect(await log.listSessions('2026-10-01', '2026-10-31')).toEqual([]);
    });

    it('lists a session moved to another date under that date, from the same file', async () => {
      const { log, store } = await setup();
      const s = session('2026-09-14-k3f9');
      await log.putSession(s);
      await log.putSession({ ...s, date: '2026-09-20' });

      expect(await log.listSessions('2026-09-14', '2026-09-14')).toEqual([]);
      expect((await log.listSessions('2026-09-20', '2026-09-20')).map((x) => x.id)).toEqual([s.id]);
      expect(await store.paths()).toEqual([sessionPath(s.id)]);
    });

    it('lists the sessions still open', async () => {
      const { log } = await setup();
      await log.putSession(session('2026-09-14-aaaa'));
      await log.putSession(session('2026-09-15-aaaa', { ended_at: null }));
      await log.putSession(session('2026-09-13-aaaa', { ended_at: null }));
      expect((await log.listOpenSessions()).map((s) => s.id)).toEqual([
        '2026-09-13-aaaa',
        '2026-09-15-aaaa',
      ]);
    });

    it('parses a file again only once its content has changed', async () => {
      const { log, contentReads } = await setup();
      for (const day of ['13', '14', '15']) await log.putSession(session(`2026-09-${day}-aaaa`));

      contentReads.length = 0;
      await log.listSessions('2026-01-01', '2026-12-31');
      expect(contentReads).toHaveLength(3);

      contentReads.length = 0;
      await log.listSessions('2026-01-01', '2026-12-31');
      await log.listOpenSessions();
      await log.getSession('2026-09-14-aaaa');
      expect(contentReads).toEqual([]);

      await log.putSession(session('2026-09-14-aaaa', { notes: 'changed' }));
      contentReads.length = 0;
      const listed = await log.listSessions('2026-01-01', '2026-12-31');
      expect(contentReads).toEqual([sessionPath('2026-09-14-aaaa')]);
      expect(listed[1].notes).toBe('changed');
    });

    it('hands out copies, so editing one changes nothing stored', async () => {
      const { log } = await setup();
      await log.putSession(session('2026-09-14-aaaa'));
      // The first read parses the file, the others come from the cache.
      for (let i = 0; i < 3; i++) {
        const [listed] = await log.listSessions('2026-09-14', '2026-09-14');
        listed.notes = 'edited in the UI';
        listed.exercises[0].performed[0].reps = 99;
      }
      const again = await log.getSession('2026-09-14-aaaa');
      expect(again?.notes).toBeNull();
      expect(again?.exercises[0].performed[0].reps).toBe(5);
    });
  });

  // --- ids ---------------------------------------------------------------------------

  describe('ids', () => {
    it('gives a new session its date and four characters no held id has', async () => {
      const random = sequence(...drawing('0000111122223333'));
      const { log, put, store } = await setup({ random });
      // Held three ways: a file, a deletion not yet synced, a saved version.
      await log.putSession(session('2026-09-14-0000'));
      await store.exclusive((s) =>
        s.apply([{ op: 'base', path: sessionPath('2026-09-14-1111'), sha: 'b1' }]),
      );
      const saved: ConflictRecord = {
        id: '2026-09-27-7xq2',
        path: sessionPath('2026-09-14-2222'),
        key: null,
        found_at: T0,
        device_id: 'another-device',
        version: session('2026-09-14-2222'),
      };
      await put(conflictPath(saved.id), serializeConflict(saved));

      expect(await log.newSessionId('2026-09-14')).toBe('2026-09-14-3333');
    });

    it('gives a new template a slug of its name and four characters no held id has', async () => {
      const random = sequence(...drawing('00001111'));
      const { log } = await setup({ random });
      await log.putTemplate(template('squat-day-a-0000'));
      expect(await log.newTemplateId('Squat Day A')).toBe('squat-day-a-1111');
      // Session ids are another namespace.
      expect(await log.newSessionId('2026-09-14')).toBe('2026-09-14-0000');
    });
  });

  // --- templates ----------------------------------------------------------------------

  describe('templates', () => {
    it('writes a template stamped with the time, and skips a write that changes nothing else', async () => {
      const { log, store, clock, applies } = await setup();
      const t = template('squat-day-a-k3f9');
      await log.putTemplate(t);
      expect(await log.getTemplates()).toEqual([{ ...t, updated_at: T0 }]);
      expect(await store.content(templatePath(t.id))).not.toBeNull();

      clock.advance(60_000);
      await log.putTemplate({ ...t, updated_at: '2020-01-01T00:00:00.000Z' });
      expect(applies()).toBe(1);

      await log.putTemplate({ ...t, name: 'Squat day A, heavy' });
      expect(applies()).toBe(2);
      expect(await log.getTemplates()).toEqual([
        { ...t, name: 'Squat day A, heavy', updated_at: T1 },
      ]);
    });

    it('lists templates by name, and deletes them', async () => {
      const { log } = await setup();
      await log.putTemplate(template('b-aaaa', { name: 'Bench day' }));
      await log.putTemplate(template('a-aaaa', { name: 'Squat day' }));
      await log.putTemplate(template('c-aaaa', { name: 'Deadlift day' }));
      expect((await log.getTemplates()).map((t) => t.name)).toEqual([
        'Bench day',
        'Deadlift day',
        'Squat day',
      ]);
      await log.deleteTemplate('c-aaaa');
      expect((await log.getTemplates()).map((t) => t.id)).toEqual(['b-aaaa', 'a-aaaa']);
    });
  });

  // --- tables -------------------------------------------------------------------------

  describe('tables', () => {
    it('reads a missing file as an empty table', async () => {
      const { log } = await setup();
      for (const kind of ['bodyweight', 'oneRm', 'manualRecords', 'additions'] as const) {
        expect(await log.getRows(kind)).toEqual([]);
      }
    });

    it('writes a row, and replaces the row with the same key', async () => {
      const { log, store } = await setup();
      await log.putRow('bodyweight', weighIn('2026-09-15', 83));
      await log.putRow('bodyweight', weighIn('2026-09-14', 82.5));
      await log.putRow('bodyweight', weighIn('2026-09-15', 83.4));

      expect(await log.getRows('bodyweight')).toEqual([
        weighIn('2026-09-14', 82.5),
        weighIn('2026-09-15', 83.4),
      ]);
      expect(await store.content(TABLES.bodyweight.path)).toBe(
        'date,weight_kg,source\n2026-09-14,82.5,manual\n2026-09-15,83.4,manual\n',
      );
    });

    it('keys each table by the columns DATA.md lists', async () => {
      const { log } = await setup();
      const max = (date: string, lift: OneRmEntry['lift'], weight_kg: number): OneRmEntry => ({
        date,
        lift,
        weight_kg,
        note: null,
      });
      await log.putRow('oneRm', max('2026-09-01', 'squat', 200));
      await log.putRow('oneRm', max('2026-09-01', 'bench', 130));
      await log.putRow('oneRm', max('2026-09-01', 'squat', 205));
      expect(await log.getRows('oneRm')).toEqual([
        max('2026-09-01', 'bench', 130),
        max('2026-09-01', 'squat', 205),
      ]);

      const record = (reps: number, weight_kg: number): ManualRecord => ({
        source: 'manual',
        date: '2026-06-01',
        exercise_id: 'low_bar_squat',
        reps,
        weight_kg,
        rpe: null,
        context: 'Nationals 2026',
      });
      await log.putRow('manualRecords', record(10, 170));
      await log.putRow('manualRecords', record(2, 220));
      await log.putRow('manualRecords', record(2, 225));
      expect(await log.getRows('manualRecords')).toEqual([record(2, 225), record(10, 170)]);
    });

    it('deletes the row with the record’s key, whatever its other cells', async () => {
      const { log, store, applies } = await setup();
      await log.putRow('bodyweight', weighIn('2026-09-14', 82.5));
      await log.putRow('bodyweight', weighIn('2026-09-15', 83));
      await log.deleteRow('bodyweight', weighIn('2026-09-14', 0));
      expect(await log.getRows('bodyweight')).toEqual([weighIn('2026-09-15', 83)]);

      await log.deleteRow('bodyweight', weighIn('2026-09-15', 83));
      expect(await log.getRows('bodyweight')).toEqual([]);
      // An empty table is no file, as the sync writes it.
      expect(await store.content(TABLES.bodyweight.path)).toBeNull();
      expect(applies()).toBe(4);

      await log.deleteRow('bodyweight', weighIn('2026-09-15', 83));
      await log.deleteRow('oneRm', { date: '2026-09-01', lift: 'squat', weight_kg: 1, note: null });
      expect(applies()).toBe(4);
    });

    it('writes nothing when a row is put unchanged', async () => {
      const { log, applies } = await setup();
      await log.putRow('bodyweight', weighIn('2026-09-14', 82.5));
      await log.putRow('bodyweight', weighIn('2026-09-14', 82.5));
      expect(applies()).toBe(1);
    });

    it('keeps every change of several made to a table at once', async () => {
      // Each write reads the table in the write queue. One that read it
      // before its turn would write back rows as they were then, undoing every
      // write that landed in between.
      const { log } = await setup();
      await log.putRow('bodyweight', weighIn('2026-09-10', 81));
      await log.putRow('bodyweight', weighIn('2026-09-11', 81.5));
      await Promise.all([
        log.putRow('bodyweight', weighIn('2026-09-14', 82.5)),
        log.deleteRow('bodyweight', weighIn('2026-09-10', 0)),
        log.putRow('bodyweight', weighIn('2026-09-15', 83)),
        log.putRow('bodyweight', weighIn('2026-09-16', 83.2)),
        log.deleteRow('bodyweight', weighIn('2026-09-11', 0)),
        log.putRow('bodyweight', weighIn('2026-09-17', 83.4)),
      ]);
      expect(await log.getRows('bodyweight')).toEqual([
        weighIn('2026-09-14', 82.5),
        weighIn('2026-09-15', 83),
        weighIn('2026-09-16', 83.2),
        weighIn('2026-09-17', 83.4),
      ]);

      const beltSquat = exercise('belt_squat', { name: 'Belt squat' });
      const mine = { ...pulldown, name: 'Pulldown' };
      await Promise.all([
        log.saveExercise(sealRow),
        log.saveExercise(mine),
        log.saveExercise(beltSquat),
      ]);
      expect(await log.getRows('additions')).toEqual([
        { ...beltSquat, based_on: null },
        { ...mine, based_on: exerciseRowHash(pulldown) },
        { ...sealRow, based_on: null },
      ]);
    });
  });

  // --- the exercise library -----------------------------------------------------------

  describe('saveExercise', () => {
    it('saves a new exercise with no base, as a new submission', async () => {
      const { log } = await setup();
      expect(await log.saveExercise(sealRow)).toBe('new');
      expect(await log.getRows('additions')).toEqual([{ ...sealRow, based_on: null }]);
    });

    it('saves a change to a shipped exercise based on that row, as a change', async () => {
      const { log } = await setup();
      const mine = { ...pulldown, default_unit: 'kg' as const };
      expect(await log.saveExercise(mine)).toBe('change');
      expect(await log.getRows('additions')).toEqual([
        { ...mine, based_on: exerciseRowHash(pulldown) },
      ]);
    });

    it('writes nothing for an exercise equal to its shipped row', async () => {
      const { log, store, applies } = await setup();
      expect(await log.saveExercise({ ...pulldown })).toBeNull();
      expect(applies()).toBe(0);
      expect(await store.content(TABLES.additions.path)).toBeNull();
    });

    it('removes the addition when the lifter changes an exercise back to the shipped row', async () => {
      const { log } = await setup();
      await log.saveExercise(sealRow);
      await log.saveExercise({ ...pulldown, name: 'Pulldown' });
      expect(await log.saveExercise({ ...pulldown })).toBeNull();
      expect(await log.getRows('additions')).toEqual([{ ...sealRow, based_on: null }]);
      expect((await log.library()).exercises).toContainEqual(pulldown);
    });

    it('bases an edited addition on the shipped row current now', async () => {
      const { log } = await setup();
      const stale: ExerciseAddition = { ...pulldown, name: 'Pulldown', based_on: 'aaaaaaaaaaaa' };
      expect(await log.saveExercise(stale)).toBe('change');
      expect(await log.getRows('additions')).toEqual([
        { ...stale, based_on: exerciseRowHash(pulldown) },
      ]);
      expect(await log.saveExercise({ ...stale, name: 'Pulldown, wide' })).toBe('change');
      expect(await log.getRows('additions')).toHaveLength(1);
    });
  });

  describe('library', () => {
    // The shipped library moved on: the pulldown and belt squat changed since
    // the lifter's additions were made against them.
    const pulldownBefore = pulldown;
    const pulldownNow = { ...pulldown, name: 'Lat pulldown (wide grip)' };
    const beltBefore = exercise('belt_squat', { name: 'Belt squat', base_lift: 'squat' });
    const beltNow = { ...beltBefore, default_unit: 'lb' as const };
    const beltMine = { ...beltBefore, muscles: { primary: ['quads'], aux: ['glutes'] } };
    const shipped = [squat, pulldownNow, beltNow];

    const additions: ExerciseAddition[] = [
      // A submission merged as sent: the shipped row now holds exactly this.
      { ...squat, based_on: null },
      // No change of its own, and its shipped row moved.
      { ...pulldownBefore, based_on: exerciseRowHash(pulldownBefore) },
      // Changed here, and the shipped row changed since: a conflict.
      { ...beltMine, based_on: exerciseRowHash(beltBefore) },
      // Brand new.
      { ...sealRow, based_on: null },
    ];

    async function withAdditions() {
      const setUp = await setup({ shipped });
      const schema = TABLES.additions;
      await setUp.put(schema.path, tableText(schema, additions.map(schema.toRow)));
      return setUp;
    }

    it('applies the rule, and writes its fixes once, in one write', async () => {
      const { log, applies } = await withAdditions();
      const first = await log.library();
      expect(first.exercises).toEqual([beltNow, pulldownNow, squat, sealRow]);
      expect(first.conflicts).toEqual([
        {
          id: 'belt_squat',
          addition: { ...beltMine, based_on: exerciseRowHash(beltBefore) },
          shipped: beltNow,
        },
      ]);
      expect(first.fixes).toEqual([
        { op: 'drop', id: 'lat_pulldown' },
        { op: 'rebase', id: 'low_bar_squat', based_on: exerciseRowHash(squat) },
      ]);
      expect(applies()).toBe(1);
      expect(await log.getRows('additions')).toEqual([
        { ...beltMine, based_on: exerciseRowHash(beltBefore) },
        { ...squat, based_on: exerciseRowHash(squat) },
        { ...sealRow, based_on: null },
      ]);

      const second = await log.library();
      expect(applies()).toBe(1);
      expect(second).toEqual({ ...first, fixes: [] });
    });

    it('uses the shipped row when the lifter picks it', async () => {
      const { log } = await withAdditions();
      expect(await log.resolveLibraryConflict('belt_squat', 'use_shipped')).toBeNull();
      const library = await log.library();
      expect(library.conflicts).toEqual([]);
      expect(library.exercises).toContainEqual(beltNow);
      expect((await log.getRows('additions')).map((a) => a.id)).not.toContain('belt_squat');
    });

    it('keeps the addition when the lifter picks it, and asks for a new submission', async () => {
      const { log } = await withAdditions();
      expect(await log.resolveLibraryConflict('belt_squat', 'keep_mine')).toBe('change');
      const library = await log.library();
      expect(library.conflicts).toEqual([]);
      expect(library.exercises).toContainEqual(beltMine);
      expect((await log.getRows('additions')).find((a) => a.id === 'belt_squat')).toEqual({
        ...beltMine,
        based_on: exerciseRowHash(beltNow),
      });
    });

    it('writes nothing for an exercise with no addition, or no shipped row', async () => {
      const { log, applies } = await withAdditions();
      expect(await log.resolveLibraryConflict('lat_pulldown_x', 'keep_mine')).toBeNull();
      expect(await log.resolveLibraryConflict('seal_row', 'use_shipped')).toBeNull();
      expect(await log.resolveLibraryConflict('seal_row', 'keep_mine')).toBeNull();
      expect(applies()).toBe(0);
      expect((await log.getRows('additions')).map((a) => a.id)).toContain('seal_row');
    });
  });

  // --- sync conflicts -----------------------------------------------------------------

  describe('conflicts', () => {
    const conflict = (id: string, fields: Partial<ConflictRecord>): ConflictRecord => ({
      id,
      path: sessionPath('2026-09-14-k3f9'),
      key: null,
      found_at: T0,
      device_id: 'another-device',
      version: null,
      ...fields,
    });

    async function withConflict(record: ConflictRecord) {
      const setUp = await setup();
      await setUp.put(conflictPath(record.id), serializeConflict(record));
      return setUp;
    }

    it('lists every conflict record, oldest first', async () => {
      const newer = conflict('2026-09-27-aaaa', { version: session('2026-09-14-k3f9') });
      const older = conflict('2026-09-20-aaaa', {
        path: TABLES.bodyweight.path,
        key: { date: '2026-09-14' },
        version: { date: '2026-09-14', weight_kg: '81', source: 'manual' },
      });
      const { log, put } = await withConflict(newer);
      await put(conflictPath(older.id), serializeConflict(older));
      expect(await log.getConflicts()).toEqual([older, newer]);
    });

    describe.each([
      {
        what: 'a session',
        path: sessionPath('2026-09-14-k3f9'),
        logVersion: session('2026-09-14-k3f9', { notes: 'from the log' }),
        saved: session('2026-09-14-k3f9', { notes: 'from this device', device_id: 'phone' }),
        write: (log: Log, s: Session | Template) => log.putSession(s as Session),
        read: (log: Log) => log.getSession('2026-09-14-k3f9'),
      },
      {
        what: 'a template',
        path: templatePath('squat-day-a-k3f9'),
        logVersion: template('squat-day-a-k3f9', { name: 'From the log' }),
        saved: template('squat-day-a-k3f9', { name: 'From this device' }),
        write: (log: Log, t: Session | Template) => log.putTemplate(t as Template),
        read: async (log: Log) => (await log.getTemplates())[0] ?? null,
      },
    ])('on $what', ({ path, logVersion, saved, write, read }) => {
      it("keeps the log's version, deleting only the record, in one write", async () => {
        const { log, applies } = await withConflict(
          conflict('2026-09-27-aaaa', { path, version: saved }),
        );
        await write(log, logVersion);
        const before = await read(log);
        await log.resolveConflict('2026-09-27-aaaa', 'keep_log');
        expect(applies()).toBe(2);
        expect(await read(log)).toEqual(before);
        expect(await log.getConflicts()).toEqual([]);
      });

      it('writes the saved version exactly as saved, in one write', async () => {
        const { log, applies } = await withConflict(
          conflict('2026-09-27-aaaa', { path, version: saved }),
        );
        await write(log, logVersion);
        await log.resolveConflict('2026-09-27-aaaa', 'use_saved');
        expect(applies()).toBe(2);
        expect(await read(log)).toEqual(saved);
        expect(await log.getConflicts()).toEqual([]);
      });

      it('restores a saved version whose record was deleted elsewhere', async () => {
        const { log } = await withConflict(conflict('2026-09-27-aaaa', { path, version: saved }));
        await log.resolveConflict('2026-09-27-aaaa', 'use_saved');
        expect(await read(log)).toEqual(saved);
      });

      it('deletes the record when the saved version is a deletion', async () => {
        const { log, applies } = await withConflict(
          conflict('2026-09-27-aaaa', { path, version: null }),
        );
        await write(log, logVersion);
        await log.resolveConflict('2026-09-27-aaaa', 'use_saved');
        expect(applies()).toBe(2);
        expect(await read(log)).toBeNull();
        expect(await log.getConflicts()).toEqual([]);
      });
    });

    describe('on a table row', () => {
      const tableConflict = (version: Record<string, string> | null) =>
        conflict('2026-09-27-aaaa', {
          path: TABLES.bodyweight.path,
          key: { date: '2026-09-14' },
          version,
        });
      const savedRow = { date: '2026-09-14', weight_kg: '81', source: 'manual' };

      async function withRows(record: ConflictRecord) {
        const setUp = await withConflict(record);
        await setUp.log.putRow('bodyweight', weighIn('2026-09-14', 82.5));
        await setUp.log.putRow('bodyweight', weighIn('2026-09-15', 83));
        return setUp;
      }

      it("keeps the log's row", async () => {
        const { log, applies } = await withRows(tableConflict(savedRow));
        await log.resolveConflict('2026-09-27-aaaa', 'keep_log');
        expect(applies()).toBe(3);
        expect(await log.getRows('bodyweight')).toEqual([
          weighIn('2026-09-14', 82.5),
          weighIn('2026-09-15', 83),
        ]);
        expect(await log.getConflicts()).toEqual([]);
      });

      it('replaces the row with that key by the saved one, in one write', async () => {
        const { log, applies } = await withRows(tableConflict(savedRow));
        await log.resolveConflict('2026-09-27-aaaa', 'use_saved');
        expect(applies()).toBe(3);
        expect(await log.getRows('bodyweight')).toEqual([
          weighIn('2026-09-14', 81),
          weighIn('2026-09-15', 83),
        ]);
        expect(await log.getConflicts()).toEqual([]);
      });

      it('deletes the row when the saved version is a deletion', async () => {
        const { log } = await withRows(tableConflict(null));
        await log.resolveConflict('2026-09-27-aaaa', 'use_saved');
        expect(await log.getRows('bodyweight')).toEqual([weighIn('2026-09-15', 83)]);
        expect(await log.getConflicts()).toEqual([]);
      });

      it('restores a saved row whose table was never written here', async () => {
        const { log } = await withConflict(tableConflict(savedRow));
        await log.resolveConflict('2026-09-27-aaaa', 'use_saved');
        expect(await log.getRows('bodyweight')).toEqual([weighIn('2026-09-14', 81)]);
      });
    });

    it('does nothing for a conflict already resolved', async () => {
      const { log, applies } = await setup();
      await log.resolveConflict('2026-09-27-aaaa', 'use_saved');
      await log.resolveConflict('2026-09-27-aaaa', 'keep_log');
      expect(applies()).toBe(0);
    });
  });

  // --- durability ---------------------------------------------------------------------

  it('has every write on disk by the time its promise resolves', async () => {
    const { log, put, fresh } = await setup();
    const s = session('2026-09-14-k3f9');
    const t = template('squat-day-a-k3f9');
    const saved: ConflictRecord = {
      id: '2026-09-27-aaaa',
      path: sessionPath(s.id),
      key: null,
      found_at: T0,
      device_id: 'phone',
      version: { ...s, notes: 'saved' },
    };

    await log.putSession(s);
    expect((await (await fresh()).getSession(s.id))?.device_id).toBe(DEVICE);
    await log.putTemplate(t);
    expect(await (await fresh()).getTemplates()).toHaveLength(1);
    await log.putRow('bodyweight', weighIn('2026-09-14', 82.5));
    expect(await (await fresh()).getRows('bodyweight')).toEqual([weighIn('2026-09-14', 82.5)]);
    await log.saveExercise(sealRow);
    expect(await (await fresh()).getRows('additions')).toHaveLength(1);

    await put(conflictPath(saved.id), serializeConflict(saved));
    await log.resolveConflict(saved.id, 'use_saved');
    const afterResolve = await fresh();
    expect((await afterResolve.getSession(s.id))?.notes).toBe('saved');
    expect(await afterResolve.getConflicts()).toEqual([]);

    await log.deleteRow('bodyweight', weighIn('2026-09-14', 82.5));
    expect(await (await fresh()).getRows('bodyweight')).toEqual([]);
    await log.deleteTemplate(t.id);
    expect(await (await fresh()).getTemplates()).toEqual([]);
    await log.deleteSession(s.id);
    expect(await (await fresh()).getSession(s.id)).toBeNull();
  });
});
