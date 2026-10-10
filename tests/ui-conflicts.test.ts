import { describe, expect, it } from 'vitest';
import type { LibraryConflict } from '../src/library/assemble';
import type { ConflictRecord, Exercise, Meet, Session } from '../src/model';
import {
  conflictSubject,
  describeConflict,
  describeLibraryConflict,
  deviceLabel,
  diffLines,
  diffWords,
  keptMessage,
  noticeCopy,
  noticeShown,
  whenLabel,
} from '../src/ui/conflicts';

const names = new Map([
  ['low_bar_squat', 'Low-Bar Squat'],
  ['bench', 'Bench Press'],
  ['sumo_deadlift', 'Sumo Deadlift'],
]);
/** A set as a version's line holds it: kept whole with no-break spaces. */
const set = (text: string) => text.replaceAll(' ', ' ');

const session = (rpe: number): Session => ({
  id: '2026-10-04-k3f9',
  date: '2026-10-04',
  started_at: '2026-10-04T17:30:00.000Z',
  tz: 'Europe/Lisbon',
  time_precision: 'instant',
  ended_at: null,
  label: { name: null, block: null, week: null, day: null, weekday: null },
  bodyweight_kg: null,
  notes: null,
  exercises: [
    {
      id: 'e1',
      exercise_id: 'low_bar_squat',
      rest_s: null,
      prescribed: [],
      performed: [
        {
          id: 's1',
          prescribed_id: null,
          state: 'done',
          reps: 5,
          rpe,
          load: { kind: 'weight', value: 140, unit: 'kg' },
          is_warmup: false,
          notes: null,
        },
      ],
      notes: null,
    },
  ],
  created_at: '2026-10-04T17:30:00.000Z',
  updated_at: '2026-10-04T17:30:00.000Z',
  device_id: 'phone',
});

const record = (over: Partial<ConflictRecord>): ConflictRecord => ({
  id: '2026-10-04-c0n1',
  path: 'sessions/2026/2026-10-04-k3f9.json',
  key: null,
  found_at: '2026-10-04T18:00:00.000Z',
  device_id: 'phone',
  version: session(8.5),
  ...over,
});

describe('a conflict, as the sync screen shows it', () => {
  it('sets a session beside the saved one, set by set', () => {
    const view = describeConflict(record({}), session(8), names);
    expect(view.what).toBe('session 2026-10-04-k3f9');
    expect(view.current).toEqual([`Low-Bar Squat: ${set('140 × 5 @ 8')}`]);
    expect(view.saved).toEqual([`Low-Bar Squat: ${set('140 × 5 @ 8.5')}`]);
  });

  it('shows a version that was deleted as deleted', () => {
    expect(describeConflict(record({}), null, names).current).toEqual(['deleted']);
  });

  it('shows a table row by its key and its cells', () => {
    const view = describeConflict(
      record({
        path: 'lifter/bodyweight.csv',
        key: { date: '2026-10-04' },
        version: { date: '2026-10-04', weight_kg: '82.5', source: 'manual' },
      }),
      { date: '2026-10-04', weight_kg: '83', source: 'manual' },
      names,
    );
    expect(view.what).toBe('bodyweight: 2026-10-04');
    expect(view.current).toContain('83 kg');
    expect(view.saved).toContain('82.5 kg');
  });
});

describe('the lines of two versions, side by side', () => {
  const same = (line: string) => ({ current: line, saved: line, same: true });

  it('matches identical versions line for line', () => {
    expect(diffLines(['a', 'b'], ['a', 'b'])).toEqual([same('a'), same('b')]);
  });

  it('faces two different lines in the same place', () => {
    expect(diffLines(['date', 'squat: 8'], ['date', 'squat: 8.5'])).toEqual([
      same('date'),
      { current: 'squat: 8', saved: 'squat: 8.5', same: false },
    ]);
  });

  it('does not mark every later line changed when one is inserted', () => {
    const rows = diffLines(['date', 'squat', 'bench'], ['date', 'squat', 'row', 'bench']);
    expect(rows).toEqual([
      same('date'),
      same('squat'),
      { current: null, saved: 'row', same: false },
      same('bench'),
    ]);
  });

  it('leaves the other side empty for a line only one has', () => {
    expect(diffLines(['a', 'b', 'c'], ['a', 'c'])).toEqual([
      same('a'),
      { current: 'b', saved: null, same: false },
      same('c'),
    ]);
  });

  it('pairs what is left over in order when a run differs', () => {
    expect(diffLines(['a', 'x1', 'x2', 'x3', 'z'], ['a', 'y1', 'z'])).toEqual([
      same('a'),
      { current: 'x1', saved: 'y1', same: false },
      { current: 'x2', saved: null, same: false },
      { current: 'x3', saved: null, same: false },
      same('z'),
    ]);
  });

  it('handles repeated lines and empty sides', () => {
    expect(diffLines(['a', 'a', 'b'], ['a', 'b'])).toEqual([
      same('a'),
      { current: 'a', saved: null, same: false },
      same('b'),
    ]);
    expect(diffLines([], [])).toEqual([]);
    expect(diffLines(['deleted'], [])).toEqual([{ current: 'deleted', saved: null, same: false }]);
    expect(diffLines([], ['a'])).toEqual([{ current: null, saved: 'a', same: false }]);
  });

  it('keeps every line of both sides, in order', () => {
    const current = ['a', 'b', 'c', 'd', 'e'];
    const saved = ['a', 'x', 'c', 'y', 'z', 'e'];
    const rows = diffLines(current, saved);
    expect(rows.flatMap((r) => (r.current === null ? [] : [r.current]))).toEqual(current);
    expect(rows.flatMap((r) => (r.saved === null ? [] : [r.saved]))).toEqual(saved);
  });

  it('comes with a conflict, so the screen can highlight what differs', () => {
    const view = describeConflict(record({}), session(8), names);
    expect(view.diff).toEqual([
      {
        current: `Low-Bar Squat: ${set('140 × 5 @ 8')}`,
        saved: `Low-Bar Squat: ${set('140 × 5 @ 8.5')}`,
        same: false,
      },
    ]);
  });

  it('shows a deletion as every line of the other version changed', () => {
    const view = describeConflict(record({ version: null }), session(8), names);
    expect(view.diff.every((r) => !r.same)).toBe(true);
    expect(view.diff[0].saved).toBe('deleted');
  });
});

const text = (spans: { text: string }[]) => spans.map((s) => s.text).join('');
const changed = (spans: { text: string; changed: boolean }[]) =>
  spans.filter((s) => s.changed).map((s) => s.text);

describe('two lines, word by word', () => {
  it('marks only the figure that differs', () => {
    const { a, b } = diffWords('Deadlift: 180 × 3 @ 8', 'Deadlift: 180 × 2 @ 8');
    expect(changed(a)).toEqual(['3']);
    expect(changed(b)).toEqual(['2']);
    expect(text(a)).toBe('Deadlift: 180 × 3 @ 8');
    expect(text(b)).toBe('Deadlift: 180 × 2 @ 8');
  });

  it('keeps a decimal whole, so 8 against 8.5 is one mark', () => {
    const { a, b } = diffWords('squat @ 8', 'squat @ 8.5');
    expect(changed(a)).toEqual(['8']);
    expect(changed(b)).toEqual(['8.5']);
  });

  it('joins neighbouring changes into one mark, and leaves matching words between plain', () => {
    const { a } = diffWords('140 × 5 @ 8', '150 × 5 @ 9');
    expect(changed(a)).toEqual(['140', '8']);
    const joined = diffWords('1 2 same', '3 4 same');
    expect(changed(joined.a)).toEqual(['1 2']);
  });

  it('marks all of a line the other version lacks, and none of identical lines', () => {
    expect(changed(diffWords('row 1', '').a)).toEqual(['row 1']);
    expect(changed(diffWords('same', 'same').a)).toEqual([]);
    expect(diffWords('', '')).toEqual({ a: [], b: [] });
  });

  it('never loses or adds a character', () => {
    const a = 'Low-Bar Squat: 140 × 5 @ 8, 140 × 5 @ 8.5';
    const b = 'Low-Bar Squat: 140 × 5 @ 8, 145 × 3 @ 9';
    const pair = diffWords(a, b);
    expect(text(pair.a)).toBe(a);
    expect(text(pair.b)).toBe(b);
  });
});

describe('the card of a conflict', () => {
  const here = { id: 'phone', name: '' };

  it('names it for what it is, in a plain line with the date', () => {
    const view = describeConflict(record({ device_id: 'laptop' }), session(8), names, here);
    expect(view.title).toBe('Two versions of one session');
    expect(view.line).toBe('Sunday 4 October was changed on two devices. Keep one.');
  });

  it('says a deletion as a deletion', () => {
    const view = describeConflict(record({ version: null }), session(8), names, here);
    expect(view.line).toBe(
      'Sunday 4 October was deleted on one device and changed on another. Keep one.',
    );
  });

  it('puts this device first, named, and the other as another device', () => {
    const view = describeConflict(
      record({ device_id: 'laptop', version: { ...session(8.5), device_id: 'laptop' } }),
      session(8),
      names,
      { id: 'phone', name: "Matheus's iPhone" },
    );
    expect(view.sides.map((s) => s.device)).toEqual(["Matheus's iPhone", 'Another device']);
    // The log's version is this device's, so keeping it is "keep_log".
    expect(view.sides.map((s) => s.choice)).toEqual(['keep_log', 'use_saved']);
  });

  it('calls this device "This phone" until it has a name', () => {
    expect(deviceLabel('phone', here)).toBe('This phone');
    expect(deviceLabel('phone', { id: 'phone', name: 'Pixel' })).toBe('Pixel');
    expect(deviceLabel('laptop', here)).toBe('Another device');
    expect(deviceLabel(null, here)).toBe('Another device');
  });

  it('puts the saved version first when it is this device that saved it', () => {
    const view = describeConflict(
      record({ device_id: 'phone' }),
      { ...session(8), device_id: 'laptop' },
      names,
      here,
    );
    expect(view.sides.map((s) => s.choice)).toEqual(['use_saved', 'keep_log']);
    expect(view.sides.map((s) => s.device)).toEqual(['This phone', 'Another device']);
  });

  it('marks only the changed figure in each version, with when each was changed', () => {
    const view = describeConflict(record({ device_id: 'laptop' }), session(8), names, here);
    const [mine, theirs] = view.sides;
    expect(changed(mine.lines[0])).toEqual(['8']);
    expect(changed(theirs.lines[0])).toEqual(['8.5']);
    expect(mine.when).toBe('2026-10-04T17:30:00.000Z');
  });

  it('gives warm-ups a line of their own, so a difference in them still shows', () => {
    const withWarmup = (reps: number): Session => {
      const s = session(8);
      s.exercises[0].performed.unshift({
        ...s.exercises[0].performed[0],
        id: 'w1',
        is_warmup: true,
        rpe: null,
        reps,
      });
      return s;
    };
    const view = describeConflict(record({ version: withWarmup(3) }), withWarmup(5), names, here);
    expect(view.current).toEqual([
      `Low-Bar Squat: ${set('140 × 5 @ 8')}`,
      `Low-Bar Squat warm-up: ${set('140 × 5')}`,
    ]);
    expect(view.diff.map((r) => r.same)).toEqual([true, false]);
  });

  it('leaves the key of a table row out of its lines, since the title says it', () => {
    const view = describeConflict(
      record({
        path: 'lifter/bodyweight.csv',
        key: { date: '2026-10-04' },
        version: { date: '2026-10-04', weight_kg: '82.5', source: 'manual' },
      }),
      { date: '2026-10-04', weight_kg: '83', source: 'manual' },
      names,
      here,
    );
    expect(view.current).toEqual(['83 kg', 'entered by hand']);
  });

  it('says a record by hand in words, leaving its empty cells out', () => {
    const view = describeConflict(
      record({
        path: 'lifter/manual-records.csv',
        key: { date: '2026-03-14', exercise_id: 'low_bar_squat', reps: '1' },
        version: {
          date: '2026-03-14',
          exercise_id: 'low_bar_squat',
          reps: '1',
          weight_kg: '155',
          rpe: '',
          context: 'Mock meet',
        },
      }),
      null,
      names,
      here,
    );
    expect(view.saved).toEqual(['155 kg', '“Mock meet”']);
  });

  it('knows nothing of when a table row changed, and says so by leaving it out', () => {
    const view = describeConflict(
      record({
        path: 'lifter/bodyweight.csv',
        key: { date: '2026-10-04' },
        version: { date: '2026-10-04', weight_kg: '82.5', source: 'manual' },
      }),
      { date: '2026-10-04', weight_kg: '83', source: 'manual' },
      names,
      here,
    );
    expect(view.title).toBe('Two versions of one weigh-in');
    expect(view.line).toBe(
      'The weigh-in for Sunday 4 October was changed on two devices. Keep one.',
    );
    expect(view.sides.every((s) => s.when === null)).toBe(true);
    expect(view.sides.map((s) => s.device).sort()).toEqual(['Another device', 'This phone']);
  });
});

describe('a conflict on a meet', () => {
  const here = { id: 'phone', name: '' };
  const meet = (over: Partial<Meet> = {}): Meet => ({
    id: '2026-05-16-8mzt',
    date: '2026-05-16',
    name: 'Nationals 2026',
    location: 'Lisbon',
    federation: null,
    weight_class: null,
    equipment: 'raw',
    bodyweight_kg: 82.6,
    placing: 2,
    notes: null,
    lifts: {
      squat: [
        { exercise_id: 'low_bar_squat', weight_kg: 200, good: true },
        { exercise_id: 'low_bar_squat', weight_kg: 205, good: false },
        null,
      ],
      bench: [null, null, null],
      deadlift: [{ exercise_id: 'sumo_deadlift', weight_kg: 240, good: true }, null, null],
    },
    created_at: '2026-05-17T09:00:00.000Z',
    updated_at: '2026-05-17T09:00:00.000Z',
    device_id: 'phone',
    ...over,
  });
  const about = (version: Meet | null) =>
    record({ path: 'meets/2026-05-16-8mzt.json', key: null, version, device_id: 'laptop' });

  it('names the meet in its title line', () => {
    const view = describeConflict(about(meet()), meet({ placing: 1 }), names, here);
    expect(view.what).toBe('meet 2026-05-16-8mzt');
    expect(view.title).toBe('Two versions of one meet');
    expect(view.line).toBe('The meet Nationals 2026 was changed on two devices. Keep one.');
  });

  it('names a meet with no name by its day, even when deleted', () => {
    const unnamed = describeConflict(
      about(meet({ name: null })),
      meet({ name: null }),
      names,
      here,
    );
    expect(unnamed.line).toBe('The meet of Saturday 16 May was changed on two devices. Keep one.');
    const gone = describeConflict(about(null), meet({ name: null }), names, here);
    expect(gone.line).toBe(
      'The meet of Saturday 16 May was deleted on one device and changed on another. Keep one.',
    );
    expect(conflictSubject(about(null), names)).toBe('The meet of Saturday 16 May');
  });

  it('says a meet from the record alone', () => {
    expect(conflictSubject(about(meet()), names)).toBe('The meet Nationals 2026');
    expect(conflictSubject(about(meet({ name: null })), names)).toBe('The meet of Saturday 16 May');
  });

  it('gives one line for each attempt taken, as lift, number, exercise, weight and verdict', () => {
    const view = describeConflict(about(meet()), meet(), names, here);
    expect(view.current).toEqual([
      'Date: 2026-05-16',
      'Location: Lisbon',
      'Equipment: raw',
      'Bodyweight: 82.6 kg',
      'Placing: 2',
      'Squat 1 · Low-Bar Squat · 200 kg · good',
      'Squat 2 · Low-Bar Squat · 205 kg · missed',
      'Deadlift 1 · Sumo Deadlift · 240 kg · good',
    ]);
    expect(view.diff.every((row) => row.same)).toBe(true);
  });

  it('marks the attempt that differs, and only that', () => {
    const changed = meet({
      lifts: {
        ...meet().lifts,
        squat: [
          { exercise_id: 'low_bar_squat', weight_kg: 200, good: true },
          { exercise_id: 'low_bar_squat', weight_kg: 205, good: true },
          null,
        ],
      },
    });
    const view = describeConflict(about(changed), meet(), names, here);
    expect(view.diff.filter((row) => !row.same)).toEqual([
      {
        current: 'Squat 2 · Low-Bar Squat · 205 kg · missed',
        saved: 'Squat 2 · Low-Bar Squat · 205 kg · good',
        same: false,
      },
    ]);
    const marked = (lines: { text: string; changed: boolean }[][]) =>
      lines
        .flat()
        .filter((s) => s.changed)
        .map((s) => s.text);
    expect(marked(view.sides[0].lines)).toEqual(['missed']);
    expect(marked(view.sides[1].lines)).toEqual(['good']);
  });

  it('shows an attempt taken on one side only as a line the other lacks', () => {
    const third = meet({
      lifts: {
        ...meet().lifts,
        squat: [
          ...meet().lifts.squat.slice(0, 2),
          { exercise_id: 'low_bar_squat', weight_kg: 210, good: true },
        ] as Meet['lifts']['squat'],
      },
    });
    const view = describeConflict(about(third), meet(), names, here);
    expect(view.diff.filter((row) => !row.same)).toEqual([
      { current: null, saved: 'Squat 3 · Low-Bar Squat · 210 kg · good', same: false },
    ]);
  });

  it('says when each version was changed, and by which device', () => {
    const view = describeConflict(
      about(meet({ device_id: 'laptop', updated_at: '2026-05-18T10:00:00.000Z' })),
      meet(),
      names,
      here,
    );
    expect(view.sides.map((s) => [s.device, s.when])).toEqual([
      ['This phone', '2026-05-17T09:00:00.000Z'],
      ['Another device', '2026-05-18T10:00:00.000Z'],
    ]);
  });
});

describe('a library conflict', () => {
  const exercise = (name: string, tier: Exercise['tier']): Exercise =>
    ({
      id: 'pause_squat',
      name,
      base_lift: 'squat',
      tier,
      unilateral: false,
      load_type: 'external',
      default_unit: 'kg',
      muscles: { primary: ['quads'], aux: ['glutes'] },
    }) as Exercise;

  it('sets the app version against the lifter own, marking what differs', () => {
    const view = describeLibraryConflict({
      id: 'pause_squat',
      shipped: exercise('Pause Squat', 'high_spec'),
      addition: exercise('Pause Squat', 'low_spec'),
    } as LibraryConflict);
    expect(view.title).toBe('Two versions of one exercise');
    expect(view.sides.map((s) => s.keepMine)).toEqual([false, true]);
    expect(changed(view.sides[0].lines[1])).toEqual(['high']);
    expect(changed(view.sides[1].lines[1])).toEqual(['low']);
  });
});

describe('when a version was changed', () => {
  const at = (day: number, h: number, m: number) => new Date(2026, 9, day, h, m).toISOString();
  const now = new Date(2026, 9, 5, 20, 0);

  it('says today, yesterday, then the date', () => {
    expect(whenLabel(at(5, 18, 2), now)).toBe('today 18:02');
    expect(whenLabel(at(4, 9, 5), now)).toBe('yesterday 09:05');
    expect(whenLabel(at(1, 17, 30), now)).toBe('Thu 1 Oct 17:30');
  });

  it('says nothing of a time it cannot read', () => {
    expect(whenLabel('not a time', now)).toBe('');
  });
});

describe('whether the full-screen notice is up', () => {
  const gate = { requested: true, count: 2, inSession: false, finishing: false, takeover: false };

  it('is up when asked for and conflicts remain', () => {
    expect(noticeShown(gate)).toBe(true);
  });

  it('is never up in a session, where only the banner shows', () => {
    expect(noticeShown({ ...gate, inSession: true })).toBe(false);
  });

  it('comes once the session is over, when it was asked for during it', () => {
    const asked = { ...gate, inSession: true };
    expect(noticeShown(asked)).toBe(false);
    expect(noticeShown({ ...asked, inSession: false, finishing: true })).toBe(false);
    expect(noticeShown({ ...asked, inSession: false })).toBe(true);
  });

  it('waits for Done on the finish screen, and for setup', () => {
    expect(noticeShown({ ...gate, finishing: true })).toBe(false);
    expect(noticeShown({ ...gate, takeover: true })).toBe(false);
  });

  it('goes once none is left, or once the lifter said Later', () => {
    expect(noticeShown({ ...gate, count: 0 })).toBe(false);
    expect(noticeShown({ ...gate, requested: false })).toBe(false);
  });
});

describe('the toast after keeping one', () => {
  it('names the device, in running text', () => {
    expect(keptMessage('This phone')).toBe('Kept the version from this phone');
    expect(keptMessage("Matheus's iPhone")).toBe("Kept the version from Matheus's iPhone");
    expect(keptMessage('Another device')).toBe('Kept the version from another device');
  });
});

describe('the launch notice', () => {
  it('counts, and says nothing was lost', () => {
    expect(noticeCopy(1).title).toBe('1 conflict to settle');
    expect(noticeCopy(3).title).toBe('3 conflicts to settle');
    expect(noticeCopy(2).line).toContain('Nothing was lost');
  });

  it('names what each conflict is about, from the record alone', () => {
    expect(conflictSubject(record({}), names)).toBe('The session of Sunday 4 October');
    // A deleted session still has its date, in its id.
    expect(conflictSubject(record({ version: null }), names)).toBe(
      'The session of Sunday 4 October',
    );
    expect(
      conflictSubject(
        record({
          path: 'lifter/manual-records.csv',
          key: { date: '2026-03-14', exercise_id: 'low_bar_squat', reps: '1' },
          version: null,
        }),
        names,
      ),
    ).toBe('The record for Saturday 14 March, Low-Bar Squat, 1 rep');
  });
});
