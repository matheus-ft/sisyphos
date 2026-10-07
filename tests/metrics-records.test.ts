import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG } from '../src/metrics/definitions';
import {
  beatsRecord,
  isRecentRecord,
  mergeRecords,
  recordAt,
  recordBook,
  recordDays,
  recordEvents,
  recordsSetInSession,
  sessionRecords,
} from '../src/metrics/records';
import type { ManualRecord, SessionRecord } from '../src/model';
import { bench, byId, library, sessionOf, squat } from './analysis-fixtures';

const plank = byId('plank');
const bwPlus = byId('dips');

const manual = (over: Partial<ManualRecord> = {}): ManualRecord => ({
  source: 'manual',
  exercise_id: 'low_bar_squat',
  reps: 5,
  weight_kg: 150,
  date: '2025-05-01',
  rpe: null,
  context: 'Nationals',
  ...over,
});

const lift = (date: string, load: number, reps: number, extra = {}) =>
  sessionOf({ date, work: [[squat, [{ load, reps, rpe: 8, ...extra }]]] });

describe('records from sessions', () => {
  it('keeps the heaviest weight at each rep count, separately', () => {
    const sessions = [
      sessionOf({
        date: '2026-09-01',
        work: [
          [
            squat,
            [
              { load: 140, reps: 5, rpe: 8 },
              { load: 150, reps: 3, rpe: 8 },
              { load: 130, reps: 5, rpe: 8 },
            ],
          ],
        ],
      }),
    ];
    const records = sessionRecords(sessions, library);
    expect(records.map((r) => [r.reps, r.weight_kg])).toEqual([
      [3, 150],
      [5, 140],
    ]);
  });

  it('is exactly that rep count: a heavy five is not the record for three', () => {
    const records = sessionRecords([lift('2026-09-01', 140, 5)], library);
    expect(records.some((r) => r.reps === 3)).toBe(false);
  });

  it('points at the set, and carries its date and RPE', () => {
    const s = lift('2026-09-01', 140, 5);
    const [r] = sessionRecords([s], library);
    expect(r).toMatchObject({
      source: 'session',
      exercise_id: 'low_bar_squat',
      reps: 5,
      weight_kg: 140,
      date: '2026-09-01',
      rpe: 8,
      session_id: s.id,
      exercise_instance_id: s.exercises[0].id,
      set_id: s.exercises[0].performed[0].id,
    });
  });

  it('keeps the first lift of a weight that is lifted again', () => {
    const first = lift('2026-09-01', 140, 5);
    const again = lift('2026-09-08', 140, 5);
    expect(sessionRecords([again, first], library)[0].session_id).toBe(first.id);
  });

  it('counts only rep counts from 1 to 10', () => {
    const records = sessionRecords(
      [
        sessionOf({
          date: '2026-09-01',
          work: [
            [
              squat,
              [
                { load: 100, reps: 10, rpe: 8 },
                { load: 90, reps: 11, rpe: 8 },
              ],
            ],
          ],
        }),
      ],
      library,
    );
    expect(records.map((r) => r.reps)).toEqual([10]);
  });

  it('ignores pending, skipped, timed and pin sets', () => {
    const sessions = [
      sessionOf({
        date: '2026-09-01',
        work: [
          [
            squat,
            [
              { load: 200, reps: 5 },
              { load: 200, reps: 5, rpe: 8, skip: true },
              { load: 9, unit: 'pins', reps: 5, rpe: 8 },
            ],
          ],
          [plank, [{ load: 60 }]],
        ],
      }),
    ];
    const records = sessionRecords(sessions, library);
    // Only the pin set is "done", and a pin setting is not a mass.
    expect(records).toEqual([]);
  });

  it('converts pounds, and equal weights in either unit tie', () => {
    const kg = lift('2026-09-01', 45.36, 5);
    const lb = sessionOf({
      date: '2026-09-08',
      work: [[squat, [{ load: 100, unit: 'lb', reps: 5, rpe: 8 }]]],
    });
    const [r] = sessionRecords([kg, lb], library);
    expect(r.weight_kg).toBe(45.36);
    expect(r.session_id).toBe(kg.id);
  });

  it('keeps a book for the competition lifts only', () => {
    const s = sessionOf({
      date: '2026-09-01',
      work: [
        [bwPlus, [{ load: 20, reps: 8, rpe: 8 }]],
        [squat, [{ load: 140, reps: 3, rpe: 8 }]],
      ],
    });
    expect(sessionRecords([s], library).map((r) => r.exercise_id)).toEqual([squat.id]);
  });

  it('leaves warm-ups out, unless the config counts them', () => {
    const s = sessionOf({
      date: '2026-09-01',
      work: [[squat, [{ load: 60, reps: 5, warmup: true }]]],
    });
    expect(sessionRecords([s], library)).toEqual([]);
    CONFIG.warmupsCountedIn.push('records');
    try {
      const [r] = sessionRecords([s], library);
      expect(r.weight_kg).toBe(60);
      expect(r.rpe).toBeNull();
    } finally {
      CONFIG.warmupsCountedIn.pop();
    }
  });

  it('leaves one set out on request', () => {
    const s = lift('2026-09-01', 140, 5);
    expect(sessionRecords([s], library, { exceptSetId: s.exercises[0].performed[0].id })).toEqual(
      [],
    );
  });
});

describe('records merged with those entered by hand', () => {
  const derived = (over: Partial<SessionRecord> = {}): SessionRecord => ({
    source: 'session',
    exercise_id: 'low_bar_squat',
    reps: 5,
    weight_kg: 140,
    date: '2026-09-01',
    rpe: 8,
    session_id: 's',
    exercise_instance_id: 'e',
    set_id: 'x',
    ...over,
  });

  it('lets the heavier win, whichever source it is from', () => {
    expect(mergeRecords([derived()], [manual({ weight_kg: 150 })])[0].source).toBe('manual');
    expect(
      mergeRecords([derived({ weight_kg: 160 })], [manual({ weight_kg: 150 })])[0].source,
    ).toBe('session');
  });

  it('lets the earlier date win a tie', () => {
    const early = mergeRecords([derived({ weight_kg: 150 })], [manual({ date: '2025-05-01' })]);
    expect(early[0].source).toBe('manual');
    const late = mergeRecords([derived({ weight_kg: 150, date: '2024-01-01' })], [manual()]);
    expect(late[0].source).toBe('session');
  });

  it('lets the session win a tie on the same day, for the set it can open', () => {
    const merged = mergeRecords([derived({ weight_kg: 150, date: '2025-05-01' })], [manual()]);
    expect(merged[0].source).toBe('session');
  });

  it('keeps one record per exercise and rep count, ordered', () => {
    const merged = mergeRecords(
      [derived(), derived({ reps: 3, weight_kg: 150 })],
      [manual({ exercise_id: 'bench', reps: 1, weight_kg: 100 }), manual({ reps: 11 })],
    );
    expect(merged.map((r) => `${r.exercise_id}:${r.reps}`)).toEqual([
      'bench:1',
      'low_bar_squat:3',
      'low_bar_squat:5',
    ]);
  });

  it('builds the book from sessions and manual rows together', () => {
    const book = recordBook([lift('2026-09-01', 140, 5)], library, [manual({ weight_kg: 145 })]);
    expect(recordAt(book, 'low_bar_squat', 5)!.weight_kg).toBe(145);
    expect(recordAt(book, 'low_bar_squat', 4)).toBeNull();
  });

  it('leaves out a hand-entered record of an exercise that keeps no book', () => {
    const book = recordBook([], library, [manual({ exercise_id: 'dips', weight_kg: 30 })]);
    expect(book).toEqual([]);
  });

  it('keeps no book for a squat stance that is only trained', () => {
    const highBar = sessionOf({
      date: '2026-09-01',
      work: [[byId('high_bar_squat'), [{ load: 130, reps: 3, rpe: 8 }]]],
    });
    expect(sessionRecords([highBar], library)).toEqual([]);
  });
});

describe('recent records', () => {
  const record = manual({ date: '2026-09-10' });

  it('is recent for 30 days, counting today', () => {
    expect(isRecentRecord(record, '2026-10-09')).toBe(true);
    expect(isRecentRecord(record, '2026-10-10')).toBe(false);
  });

  it('is not recent before it was set', () => {
    expect(isRecentRecord(record, '2026-09-09')).toBe(false);
  });
});

describe('the laurel', () => {
  it('goes to a set heavier than the record at its rep count', () => {
    const past = lift('2026-09-01', 140, 5);
    const now = lift('2026-09-08', 145, 5);
    const set = now.exercises[0].performed[0];
    const book = recordBook([past, now], library, [], { exceptSetId: set.id });
    expect(beatsRecord(set, squat, book)).toBe(true);
  });

  it('does not go to a set that only equals the record, or falls short', () => {
    const past = lift('2026-09-01', 140, 5);
    const tie = lift('2026-09-08', 140, 5).exercises[0].performed[0];
    const light = lift('2026-09-08', 135, 5).exercises[0].performed[0];
    const book = recordBook([past], library, []);
    expect(beatsRecord(tie, squat, book)).toBe(false);
    expect(beatsRecord(light, squat, book)).toBe(false);
  });

  it('is judged at the set rep count, not another', () => {
    const book = recordBook([lift('2026-09-01', 140, 5)], library, []);
    const triple = lift('2026-09-08', 150, 3).exercises[0].performed[0];
    expect(beatsRecord(triple, squat, book)).toBe(false);
  });

  it('is not given to the first set at a rep count', () => {
    const only = lift('2026-09-01', 140, 5);
    const set = only.exercises[0].performed[0];
    const book = recordBook([only], library, [], { exceptSetId: set.id });
    expect(beatsRecord(set, squat, book)).toBe(false);
  });

  it('beats a hand-entered record', () => {
    const now = lift('2026-09-08', 155, 5).exercises[0].performed[0];
    expect(beatsRecord(now, squat, recordBook([], library, [manual()]))).toBe(true);
  });

  it('is not given to a set that is not done, a warm-up, or beyond ten reps', () => {
    const book = recordBook([lift('2026-09-01', 140, 5)], library, []);
    const pending = sessionOf({
      date: '2026-09-08',
      work: [[squat, [{ load: 200, reps: 5 }]]],
    }).exercises[0].performed[0];
    const warm = lift('2026-09-08', 200, 5, { warmup: true }).exercises[0].performed[0];
    expect(beatsRecord(pending, squat, book)).toBe(false);
    expect(beatsRecord(warm, squat, book)).toBe(false);
  });
});

describe('records set in a session', () => {
  const first = lift('2026-09-01', 140, 5);
  const second = lift('2026-09-08', 145, 5);

  it('finds the sets that beat what stood before them', () => {
    const events = recordsSetInSession(second, [first, second], library, []);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      session_id: second.id,
      reps: 5,
      weight_kg: 145,
      previous_kg: 140,
      set_id: second.exercises[0].performed[0].id,
    });
  });

  it('finds nothing in the first session, which has nothing to beat', () => {
    expect(recordsSetInSession(first, [first, second], library, [])).toEqual([]);
  });

  it('judges a session as it stood then, not against what came after', () => {
    const third = lift('2026-09-15', 150, 5);
    expect(recordsSetInSession(second, [first, second, third], library, [])).toHaveLength(1);
  });

  it('counts a rise within the session, set by set', () => {
    const s = sessionOf({
      date: '2026-09-08',
      work: [
        [
          squat,
          [
            { load: 142.5, reps: 5, rpe: 8 },
            { load: 145, reps: 5, rpe: 9 },
          ],
        ],
      ],
    });
    const events = recordsSetInSession(s, [first], library, []);
    expect(events.map((e) => [e.weight_kg, e.previous_kg])).toEqual([
      [142.5, 140],
      [145, 142.5],
    ]);
  });

  it('uses the open session even when the list holds an older copy of it', () => {
    const stale = { ...second, exercises: [] };
    expect(recordsSetInSession(second, [first, stale], library, [])).toHaveLength(1);
  });

  it('beats a hand-entered record from its own date on', () => {
    const entered = manual({ weight_kg: 146, date: '2026-09-05' });
    expect(recordsSetInSession(second, [first, second], library, [entered])).toEqual([]);
    const later = manual({ weight_kg: 146, date: '2026-09-20' });
    expect(recordsSetInSession(second, [first, second], library, [later])).toHaveLength(1);
  });

  it('keeps each exercise apart', () => {
    const b = sessionOf({
      date: '2026-09-08',
      work: [[bench, [{ load: 145, reps: 5, rpe: 8 }]]],
    });
    expect(recordEvents([first, b], library, [])).toEqual([]);
  });
});

describe('record days', () => {
  it('lists the dates a session set a record', () => {
    const sessions = [
      lift('2026-09-01', 140, 5),
      lift('2026-09-08', 145, 5),
      lift('2026-09-15', 140, 5),
      lift('2026-09-22', 150, 5),
    ];
    expect([...recordDays(sessions, library, [])].sort()).toEqual(['2026-09-08', '2026-09-22']);
  });

  it('adds nothing for a hand-entered record', () => {
    expect(recordDays([lift('2026-09-01', 140, 5)], library, [manual()]).size).toBe(0);
  });
});

afterEach(() => {
  expect(CONFIG.warmupsCountedIn).toEqual([]);
});
