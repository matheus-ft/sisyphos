import { describe, expect, it } from 'vitest';
import {
  decideFile,
  decideTable,
  type FileDecision,
  type FileVersions,
  type Mode,
  type TableDecision,
  type TableVersions,
} from '../src/storage/decide';

/**
 * The decision is tested against the specification rather than examples
 * (docs/STORAGE.md 10): every combination of absent, equal and different base,
 * local and remote, in full syncs and pulls, checked against the table of 4.3
 * transcribed below. The named cases are there to be read.
 */

const MODES: readonly Mode[] = ['full', 'pull'];

/** Absent and three different contents: every pattern of equal and different among three versions. */
const VALUES = [null, 'v1', 'v2', 'v3'] as const;

const COMBOS: FileVersions[] = VALUES.flatMap((base) =>
  VALUES.flatMap((local) => VALUES.map((remote) => ({ base, local, remote }))),
);

const show = ({ base, local, remote }: FileVersions) =>
  `B=${base ?? '-'} L=${local ?? '-'} R=${remote ?? '-'}`;

/** The table of 4.3, row for row. The first case that holds applies. */
const TABLE: ReadonlyArray<[(v: FileVersions) => boolean, FileDecision]> = [
  [(v) => v.local === v.remote, 'same'],
  [(v) => v.local === v.base, 'take'],
  [(v) => v.remote === v.base, 'push'],
  [() => true, 'conflict'],
];

function reference(v: FileVersions, mode: Mode): FileDecision {
  const decision = TABLE.find(([holds]) => holds(v))![1];
  // 4.4: a pull applies only L = B and L = R, and leaves every local change as it is.
  const localChange = v.local !== v.base && v.local !== v.remote;
  return mode === 'pull' && localChange ? 'skip' : decision;
}

/** Which version each decision leaves on the device (the doc comments on `FileDecision`). */
const HOLDS: Record<FileDecision, 'local' | 'remote'> = {
  same: 'remote',
  take: 'remote',
  push: 'local',
  conflict: 'remote',
  skip: 'local',
};

/**
 * A file after its decision is applied and before any push lands (4.2 step 5):
 * the device holds the result, and the base moves to the remote wherever the
 * result equals it.
 */
function applied(v: FileVersions, decision: FileDecision): FileVersions {
  const local = HOLDS[decision] === 'remote' ? v.remote : v.local;
  return { base: local === v.remote ? v.remote : v.base, local, remote: v.remote };
}

describe('decideFile', () => {
  it.each(MODES)('follows the table of 4.3 for every combination, in a %s', (mode) => {
    expect(COMBOS).toHaveLength(64);
    expect(COMBOS.map((v) => `${show(v)} ${decideFile(v, mode)}`)).toEqual(
      COMBOS.map((v) => `${show(v)} ${reference(v, mode)}`),
    );
  });

  it('reaches every outcome of its mode, and a pull never pushes or conflicts', () => {
    const outcomes = (mode: Mode) => new Set(COMBOS.map((v) => decideFile(v, mode)));
    expect(outcomes('full')).toEqual(new Set(['same', 'take', 'push', 'conflict']));
    expect(outcomes('pull')).toEqual(new Set(['same', 'take', 'skip']));
  });

  it('takes what changed on one side from that side, and calls both changed differently a conflict', () => {
    // The paragraph at the top of STORAGE.md, stated without the table's order.
    for (const v of COMBOS) {
      const here = v.local !== v.base;
      const there = v.remote !== v.base;
      const expected =
        v.local === v.remote ? 'same' : here && there ? 'conflict' : here ? 'push' : 'take';
      expect(decideFile(v, 'full'), show(v)).toBe(expected);
    }
  });

  const NAMED: Array<[string, FileVersions, Mode, FileDecision]> = [
    ['nothing changed', { base: 'v1', local: 'v1', remote: 'v1' }, 'full', 'same'],
    ['both sides made the same edit', { base: 'v1', local: 'v2', remote: 'v2' }, 'full', 'same'],
    ['both sides deleted it', { base: 'v1', local: null, remote: null }, 'full', 'same'],
    ['edited elsewhere: take it', { base: 'v1', local: 'v1', remote: 'v2' }, 'full', 'take'],
    [
      'deleted elsewhere: delete it here',
      { base: 'v1', local: 'v1', remote: null },
      'full',
      'take',
    ],
    ['edited here: push it', { base: 'v1', local: 'v2', remote: 'v1' }, 'full', 'push'],
    ['deleted here: delete it remotely', { base: 'v1', local: null, remote: 'v1' }, 'full', 'push'],
    ['both edited differently', { base: 'v1', local: 'v2', remote: 'v3' }, 'full', 'conflict'],
    [
      'edited here, deleted elsewhere: the deletion stands, the edit is saved',
      { base: 'v1', local: 'v2', remote: null },
      'full',
      'conflict',
    ],
    [
      'deleted here, edited elsewhere: the edit stands, the deletion is saved',
      { base: 'v1', local: null, remote: 'v2' },
      'full',
      'conflict',
    ],
    [
      'first sync, only the log has it: take it',
      { base: null, local: null, remote: 'v1' },
      'full',
      'take',
    ],
    [
      'first sync, only the device has it: push it',
      { base: null, local: 'v1', remote: null },
      'full',
      'push',
    ],
    ['first sync, both hold the same', { base: null, local: 'v1', remote: 'v1' }, 'full', 'same'],
    [
      'first sync, both hold different content',
      { base: null, local: 'v1', remote: 'v2' },
      'full',
      'conflict',
    ],
    [
      'pull: takes an edit made elsewhere',
      { base: 'v1', local: 'v1', remote: 'v2' },
      'pull',
      'take',
    ],
    ['pull: skips an edit made here', { base: 'v1', local: 'v2', remote: 'v1' }, 'pull', 'skip'],
    ['pull: skips a deletion made here', { base: 'v1', local: null, remote: 'v1' }, 'pull', 'skip'],
    ['pull: skips a conflict', { base: 'v1', local: 'v2', remote: 'v3' }, 'pull', 'skip'],
    [
      'pull: skips a record created here',
      { base: null, local: 'v1', remote: null },
      'pull',
      'skip',
    ],
  ];

  it.each(NAMED)('%s', (_name, versions, mode, expected) => {
    expect(decideFile(versions, mode)).toBe(expected);
  });

  it.each(MODES)(
    'settles after one %s: deciding again takes and saves nothing, and pushes only what had not landed',
    (mode) => {
      for (const v of COMBOS) {
        const first = decideFile(v, mode);
        const again = decideFile(applied(v, first), mode);
        expect(again, show(v)).toBe(first === 'push' || first === 'skip' ? first : 'same');
      }
    },
  );
});

// --- tables ------------------------------------------------------------------

type Rows = Record<string, string>;

const rows = (entries: Rows) => new Map(Object.entries(entries));

/** A decision as plain data, so a failure shows which key went wrong. */
function plain(d: TableDecision) {
  return {
    result: Object.fromEntries(d.result),
    nextBase: Object.fromEntries(d.nextBase),
    conflicts: [...d.conflicts].sort((a, b) => (a.key < b.key ? -1 : 1)),
  };
}

/** One table unit per key; row lines carry their key, as real ones do. */
type Units = Map<string, FileVersions>;

const line = (key: string, value: string | null) => (value === null ? null : `${key},${value}`);

function tableOf(units: Units): TableVersions {
  const pick = (side: keyof FileVersions) => {
    const map = new Map<string, string>();
    for (const [key, v] of units) {
      const row = line(key, v[side]);
      if (row !== null) map.set(key, row);
    }
    return map;
  };
  return { base: pick('base'), local: pick('local'), remote: pick('remote') };
}

/** The expected decision, key by key: the file reference, and `nextBase` as its doc comment words it. */
function expectedOf(units: Units, mode: Mode): ReturnType<typeof plain> {
  const expected: ReturnType<typeof plain> = { result: {}, nextBase: {}, conflicts: [] };
  for (const [key, v] of units) {
    const decision = reference(v, mode);
    const result = HOLDS[decision] === 'local' ? v.local : v.remote;
    const nextBase = result === v.remote ? v.remote : v.base;
    if (result !== null) expected.result[key] = line(key, result)!;
    if (nextBase !== null) expected.nextBase[key] = line(key, nextBase)!;
    if (decision === 'conflict') expected.conflicts.push({ key, local: line(key, v.local) });
  }
  return expected;
}

const single = (v: FileVersions): Units => new Map([['2026-09-14', v]]);

/** Every combination at once, one key each. */
const EVERY: Units = new Map(COMBOS.map((v, i) => [`k${String(i).padStart(2, '0')}`, v]));

describe('decideTable', () => {
  it.each(MODES)('decides a single key like a file, for every combination, in a %s', (mode) => {
    for (const v of COMBOS) {
      expect(plain(decideTable(tableOf(single(v)), mode)), show(v)).toEqual(
        expectedOf(single(v), mode),
      );
    }
  });

  it.each(MODES)(
    'moves the base to the remote exactly where the decision says so, in a %s',
    (mode) => {
      // Cross-checks the doc comment of `nextBase` against those of `FileDecision`.
      const moves: Record<FileDecision, boolean> = {
        same: true,
        take: true,
        push: false,
        conflict: true,
        skip: false,
      };
      for (const v of COMBOS) {
        const { nextBase } = decideTable(tableOf(single(v)), mode);
        const moved = moves[decideFile(v, mode)] ? v.remote : v.base;
        expect(nextBase.get('2026-09-14') ?? null, show(v)).toBe(line('2026-09-14', moved));
      }
    },
  );

  it.each(MODES)(
    'decides every key on its own in a table mixing every outcome, in a %s',
    (mode) => {
      expect(plain(decideTable(tableOf(EVERY), mode))).toEqual(expectedOf(EVERY, mode));
    },
  );

  it('decides nothing for an empty table', () => {
    const empty = { base: new Map(), local: new Map(), remote: new Map() };
    expect(plain(decideTable(empty, 'full'))).toEqual({ result: {}, nextBase: {}, conflicts: [] });
  });

  describe('a bodyweight table with every kind of change', () => {
    const versions: TableVersions = {
      base: rows({
        '2026-09-01': '2026-09-01,82.5,manual',
        '2026-09-04': '2026-09-04,82,manual',
        '2026-09-05': '2026-09-05,81.5,manual',
        '2026-09-06': '2026-09-06,81,manual',
        '2026-09-07': '2026-09-07,80.5,manual',
        '2026-09-08': '2026-09-08,80,manual',
      }),
      local: rows({
        '2026-09-01': '2026-09-01,82.5,manual', // untouched
        '2026-09-02': '2026-09-02,82.4,manual', // added here
        '2026-09-04': '2026-09-04,82.1,manual', // edited here
        '2026-09-05': '2026-09-05,81.6,manual', // edited on both, differently
        // 2026-09-06 deleted here, edited elsewhere
        '2026-09-07': '2026-09-07,80.5,manual', // deleted elsewhere
        '2026-09-08': '2026-09-08,80,manual', // edited elsewhere
      }),
      remote: rows({
        '2026-09-01': '2026-09-01,82.5,manual',
        '2026-09-03': '2026-09-03,82.2,manual', // added elsewhere
        '2026-09-04': '2026-09-04,82,manual',
        '2026-09-05': '2026-09-05,81.7,manual',
        '2026-09-06': '2026-09-06,81.2,manual',
        '2026-09-08': '2026-09-08,80.1,manual',
      }),
    };

    it('in a full sync, merges the changes, keeps the log for conflicts and saves this device’s rows', () => {
      expect(plain(decideTable(versions, 'full'))).toEqual({
        result: {
          '2026-09-01': '2026-09-01,82.5,manual',
          '2026-09-02': '2026-09-02,82.4,manual',
          '2026-09-03': '2026-09-03,82.2,manual',
          '2026-09-04': '2026-09-04,82.1,manual',
          '2026-09-05': '2026-09-05,81.7,manual',
          '2026-09-06': '2026-09-06,81.2,manual',
          '2026-09-08': '2026-09-08,80.1,manual',
        },
        // Pushed rows keep their old base (none for the new one) until the push lands.
        nextBase: {
          '2026-09-01': '2026-09-01,82.5,manual',
          '2026-09-03': '2026-09-03,82.2,manual',
          '2026-09-04': '2026-09-04,82,manual',
          '2026-09-05': '2026-09-05,81.7,manual',
          '2026-09-06': '2026-09-06,81.2,manual',
          '2026-09-08': '2026-09-08,80.1,manual',
        },
        conflicts: [
          { key: '2026-09-05', local: '2026-09-05,81.6,manual' },
          { key: '2026-09-06', local: null },
        ],
      });
    });

    it('in a pull, takes only what changed elsewhere and leaves every local change with its base', () => {
      expect(plain(decideTable(versions, 'pull'))).toEqual({
        result: {
          '2026-09-01': '2026-09-01,82.5,manual',
          '2026-09-02': '2026-09-02,82.4,manual',
          '2026-09-03': '2026-09-03,82.2,manual',
          '2026-09-04': '2026-09-04,82.1,manual',
          '2026-09-05': '2026-09-05,81.6,manual',
          '2026-09-08': '2026-09-08,80.1,manual',
        },
        nextBase: {
          '2026-09-01': '2026-09-01,82.5,manual',
          '2026-09-03': '2026-09-03,82.2,manual',
          '2026-09-04': '2026-09-04,82,manual',
          '2026-09-05': '2026-09-05,81.5,manual',
          '2026-09-06': '2026-09-06,81,manual',
          '2026-09-08': '2026-09-08,80.1,manual',
        },
        conflicts: [],
      });
    });
  });

  it.each(MODES)(
    'settles after one %s: deciding again changes nothing and finds no conflict, for every combination',
    (mode) => {
      const settles = (units: Units) => {
        const versions = tableOf(units);
        const first = decideTable(versions, mode);
        const again = decideTable(
          { base: first.nextBase, local: first.result, remote: versions.remote },
          mode,
        );
        // Same result, so the table is pushed again only if the first push had not landed.
        expect(plain(again)).toEqual({ ...plain(first), conflicts: [] });

        // Once it lands, the device, the base and the remote all hold the result.
        const landed = first.result;
        expect(plain(decideTable({ base: landed, local: landed, remote: landed }, mode))).toEqual({
          result: Object.fromEntries(landed),
          nextBase: Object.fromEntries(landed),
          conflicts: [],
        });
      };
      for (const v of COMBOS) settles(single(v));
      settles(EVERY);
    },
  );

  it('decides the next full sync as if the pull before it had not happened', () => {
    // 4.4: a pull leaves every local change, base included, for the next full sync.
    const versions = tableOf(EVERY);
    const pulled = decideTable(versions, 'pull');
    const after = decideTable(
      { base: pulled.nextBase, local: pulled.result, remote: versions.remote },
      'full',
    );
    expect(plain(after)).toEqual(plain(decideTable(versions, 'full')));
  });
});
