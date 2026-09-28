import { describe, it, expect } from 'vitest';
import { csvLine, parseCsv } from '../src/csv';
import { parseExercises } from '../src/library/parse';
import exercisesCsv from '../src/library/exercises.csv?raw';
import type {
  BodyweightEntry,
  CompetitionLift,
  ConflictRecord,
  ExerciseAddition,
  ExerciseInstance,
  Interval,
  IsoDate,
  Load,
  LoadPrescription,
  ManualRecord,
  OneRmEntry,
  PerformedSet,
  PrescribedSet,
  Session,
  TableRow,
  Template,
  WeightPrescription,
} from '../src/model';
import { FormatError } from '../src/storage/errors';
import {
  SHIPPED_EXERCISE_COLUMNS,
  TABLES,
  exerciseRowHash,
  lineRow,
  parseConflict,
  parseFormatMarker,
  parseSession,
  parseTemplate,
  rowKey,
  rowLine,
  serializeConflict,
  serializeFormatMarker,
  serializeSession,
  serializeTemplate,
  tableRows,
  tableText,
  tableUnits,
  unitsText,
  type RecordOf,
  type TableSchema,
} from '../src/storage/formats';
import { sha1Hex } from '../src/storage/hash';
import { sessionPath, templatePath, TABLE_KINDS, type TableKind } from '../src/storage/paths';

// --- generating values -------------------------------------------------------------

/** Mulberry32: a small seeded PRNG, so every generated case is reproducible. */
function prng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Strings that each exercise a quoting or trimming rule, or sit just beside one. */
const AWKWARD = [
  '',
  ' ',
  '  leading',
  'trailing  ',
  '\tTab',
  ' nbsp',
  'a,b',
  '"',
  'say "hi"',
  'two\nlines',
  '\r\n',
  'a\rb',
  '#',
  '# not a comment',
  'x#y',
  'Crème brûlée',
  '💪',
  '中文',
  'null',
  'true',
  '0',
  // Halves of a surrogate pair, as a note cut in the middle of an emoji holds.
  'a\uD83Db',
  '\uDCAA',
  '\uDCAA\uD83D',
];
// With the two halves of 💪 on their own: drawn apart they are lone, in order a pair.
const CHARS = [
  ...['a', 'Z', '0', ' ', ',', '"', '\r', '\n', '#', 'é', '💪', '\t', '{', '}'],
  ...['\uD83D', '\uDCAA'],
];
/** What an exercise id may hold: the submission workflow's rule. */
const ID_CHARS = [...'abcxyz0189_'];
const NUMBERS = [0, 1, 2, 5, 10, 82.5, 102.5, 0.1 + 0.2, -2.5, 1e21, 5e-7, 1234567.891];
const LIFTS: CompetitionLift[] = ['squat', 'bench', 'deadlift'];

class Gen {
  constructor(readonly random: () => number) {}
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.random() * (hi - lo + 1));
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.random() * items.length)];
  }
  bool(): boolean {
    return this.random() < 0.5;
  }
  maybe<T>(make: () => T): T | null {
    return this.random() < 0.3 ? null : make();
  }
  list<T>(make: () => T, max: number): T[] {
    return Array.from({ length: this.int(0, max) }, make);
  }
  string(): string {
    if (this.bool()) return this.pick(AWKWARD);
    return Array.from({ length: this.int(0, 8) }, () => this.pick(CHARS)).join('');
  }
  /** Non-empty: an empty cell is how null is written, so '' is not a value of its own there. */
  text(): string {
    return this.string() || 'x';
  }
  exerciseId(): string {
    return Array.from({ length: this.int(1, 10) }, () => this.pick(ID_CHARS)).join('');
  }
  number(): number {
    if (this.bool()) return this.pick(NUMBERS);
    return this.bool() ? Math.round(this.random() * 4000) / 8 : this.random() * 1000;
  }
  date(): IsoDate {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${this.pick([1999, 2026])}-${pad(this.int(1, 3))}-${pad(this.int(1, 9))}`;
  }
  instant(): string {
    return new Date(
      Date.UTC(2026, this.int(0, 11), this.int(1, 28), this.int(0, 23)),
    ).toISOString();
  }
  interval(): Interval {
    return [this.maybe(() => this.number()), this.maybe(() => this.number())];
  }
}

function weightPrescription(g: Gen): WeightPrescription {
  switch (g.int(0, 3)) {
    case 0:
      return { mode: 'absolute', kg: g.interval() };
    case 1:
      return { mode: 'pct_1rm', pct: g.interval(), lift: g.pick(LIFTS) };
    case 2:
      return { mode: 'rpe_driven' };
    default:
      return { mode: 'bw_plus', added_kg: g.interval() };
  }
}

function loadPrescription(g: Gen): LoadPrescription {
  switch (g.int(0, 2)) {
    case 0:
      return { kind: 'weight', weight: weightPrescription(g) };
    case 1:
      return { kind: 'time', seconds: g.interval() };
    default:
      return { kind: 'distance', meters: g.interval() };
  }
}

function prescription(g: Gen): Omit<PrescribedSet, 'id'> {
  return {
    reps: g.maybe(() => g.interval()),
    rpe: g.maybe(() => g.interval()),
    load: loadPrescription(g),
    is_warmup: g.bool(),
    notes: g.maybe(() => g.string()),
  };
}

function load(g: Gen): Load {
  switch (g.int(0, 2)) {
    case 0:
      return { kind: 'weight', value: g.number(), unit: g.pick(['kg', 'lb', 'pins'] as const) };
    case 1:
      return { kind: 'time', seconds: g.number() };
    default:
      return { kind: 'distance', meters: g.number() };
  }
}

function performed(g: Gen): PerformedSet {
  return {
    id: g.string(),
    prescribed_id: g.maybe(() => g.string()),
    state: g.pick(['pending', 'done', 'skipped'] as const),
    reps: g.maybe(() => g.number()),
    rpe: g.maybe(() => g.number()),
    load: g.maybe(() => load(g)),
    is_warmup: g.bool(),
    notes: g.maybe(() => g.string()),
  };
}

function instance(g: Gen): ExerciseInstance {
  return {
    id: g.string(),
    exercise_id: g.string(),
    prescribed: g.list(() => ({ id: g.string(), ...prescription(g) }), 3),
    performed: g.list(() => performed(g), 3),
    notes: g.maybe(() => g.string()),
  };
}

function session(g: Gen): Session {
  return {
    id: `${g.date()}-k3f9`,
    date: g.date(),
    started_at: g.instant(),
    tz: g.pick(['Europe/Lisbon', 'America/Sao_Paulo', g.string()]),
    time_precision: g.pick(['instant', 'date_only'] as const),
    ended_at: g.maybe(() => g.instant()),
    label: {
      name: g.maybe(() => g.string()),
      block: g.maybe(() => g.number()),
      week: g.maybe(() => g.number()),
      day: g.maybe(() => g.number()),
      weekday: g.maybe(() => g.string()),
    },
    bodyweight_kg: g.maybe(() => g.number()),
    notes: g.maybe(() => g.string()),
    exercises: g.list(() => instance(g), 3),
    created_at: g.instant(),
    updated_at: g.instant(),
    device_id: g.string(),
  };
}

function template(g: Gen): Template {
  return {
    id: `${g.pick(['squat-day-a', 'bench', 'template'])}-7xq2`,
    name: g.string(),
    intention: g.maybe(() => g.string()),
    exercises: g.list(
      () => ({ exercise_id: g.string(), prescribed: g.list(() => prescription(g), 3) }),
      3,
    ),
    created_at: g.instant(),
    updated_at: g.instant(),
  };
}

/** A muscle id as a list cell can hold one: no `/`, nothing to trim, not empty. */
function muscle(g: Gen): string {
  if (g.bool()) return g.pick(['quads', 'glutes', 'lats', 'upper_back']);
  return g.string().replaceAll('/', '').trim() || 'pecs';
}

const records: { [K in TableKind]: (g: Gen) => RecordOf<K> } = {
  bodyweight: (g): BodyweightEntry => ({
    date: g.date(),
    weight_kg: g.number(),
    source: g.pick(['manual', 'import'] as const),
  }),
  oneRm: (g): OneRmEntry => ({
    date: g.date(),
    lift: g.pick(LIFTS),
    weight_kg: g.number(),
    note: g.maybe(() => g.text()),
  }),
  manualRecords: (g): ManualRecord => ({
    source: 'manual',
    date: g.date(),
    exercise_id: g.pick(['bench', 'low_bar_squat', g.text()]),
    reps: g.bool() ? g.int(1, 12) : g.number(),
    weight_kg: g.number(),
    rpe: g.maybe(() => g.number()),
    context: g.maybe(() => g.text()),
  }),
  additions: (g): ExerciseAddition => ({
    id: g.pick(['bench', 'low_bar_squat', g.exerciseId()]),
    name: g.text(),
    base_lift: g.maybe(() => g.pick(LIFTS)),
    tier: g.pick(['comp', 'high_spec', 'low_spec', 'acc'] as const),
    unilateral: g.bool(),
    load_type: g.pick(['external', 'bw_plus', 'none'] as const),
    default_unit: g.pick(['kg', 'lb', 'pins'] as const),
    muscles: { primary: g.list(() => muscle(g), 3), aux: g.list(() => muscle(g), 3) },
    based_on: g.maybe(() => g.text()),
  }),
};

/** Records with distinct keys, as a table holds them. */
function distinct<R>(schema: TableSchema<R>, all: R[]): R[] {
  const byKey = new Map(all.map((r) => [rowKey(schema, schema.toRow(r)), r]));
  return [...byKey.values()];
}

function keyed<R>(schema: TableSchema<R>, all: R[]): Map<string, R> {
  return new Map(all.map((r) => [rowKey(schema, schema.toRow(r)), r]));
}

function shuffled<T>(items: T[], g: Gen): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = g.int(0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Text as UTF-8 carries it, which is what every other copy of a file holds. */
const utf8 = (text: string) => new TextDecoder().decode(new TextEncoder().encode(text));

/** A record as a CSV file gives it back: every string through UTF-8, lone surrogates as U+FFFD. */
function viaUtf8<T>(value: T): T {
  if (typeof value === 'string') return utf8(value) as T;
  if (Array.isArray(value)) return value.map(viaUtf8) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, viaUtf8(v)])) as T;
  }
  return value;
}

/** The same value with every object's keys in reverse order. */
function reversedKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reversedKeys) as T;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).reverse();
    return Object.fromEntries(entries.map(([k, v]) => [k, reversedKeys(v)])) as T;
  }
  return value;
}

// --- tables --------------------------------------------------------------------------

describe('table schemas', () => {
  it('have the columns and keys of docs/DATA.md', () => {
    const shape = (s: TableSchema<unknown>) => [s.path, s.columns, s.key, s.numeric];
    expect(shape(TABLES.bodyweight)).toEqual([
      'lifter/bodyweight.csv',
      ['date', 'weight_kg', 'source'],
      ['date'],
      [],
    ]);
    expect(shape(TABLES.oneRm)).toEqual([
      'lifter/one-rm-history.csv',
      ['date', 'lift', 'weight_kg', 'note'],
      ['date', 'lift'],
      [],
    ]);
    expect(shape(TABLES.manualRecords)).toEqual([
      'lifter/manual-records.csv',
      ['date', 'exercise_id', 'reps', 'weight_kg', 'rpe', 'context'],
      ['date', 'exercise_id', 'reps'],
      ['reps'],
    ]);
    expect(shape(TABLES.additions)).toEqual([
      'library/additions.csv',
      [...SHIPPED_EXERCISE_COLUMNS, 'based_on'],
      ['id'],
      [],
    ]);
    for (const kind of TABLE_KINDS) expect(TABLES[kind].kind).toBe(kind);
  });

  it('encode cells per 1.4: null empty, booleans true or empty, numbers as String(n)', () => {
    expect(
      TABLES.manualRecords.toRow({
        source: 'manual',
        date: '2026-09-14',
        exercise_id: 'bench',
        reps: 3,
        weight_kg: 142.5,
        rpe: null,
        context: null,
      }),
    ).toEqual({
      date: '2026-09-14',
      exercise_id: 'bench',
      reps: '3',
      weight_kg: '142.5',
      rpe: '',
      context: '',
    });
    const row = TABLES.additions.toRow({
      id: 'x',
      name: 'X',
      base_lift: null,
      tier: 'acc',
      unilateral: false,
      load_type: 'external',
      default_unit: 'kg',
      muscles: { primary: ['lats', 'biceps'], aux: [] },
      based_on: null,
    });
    expect(row).toMatchObject({ base_lift: '', unilateral: '', primary: 'lats/biceps', aux: '' });
    expect(TABLES.additions.toRow({ ...TABLES.additions.fromRow(row), unilateral: true })).toEqual({
      ...row,
      unilateral: 'true',
    });
  });
});

describe.each(TABLE_KINDS)('the %s table', (kind) => {
  const schema = TABLES[kind] as TableSchema<unknown>;
  const make = records[kind] as (g: Gen) => unknown;

  it('reads back the records it wrote, and writes back the same file', () => {
    const g = new Gen(prng(TABLE_KINDS.indexOf(kind) + 1));
    for (let run = 0; run < 150; run++) {
      const written = distinct(
        schema,
        g.list(() => make(g), 8),
      );
      const text = tableText(
        schema,
        written.map((r) => schema.toRow(r)),
      );
      // The device holds exactly what UTF-8 carries to the remote.
      expect(utf8(text)).toBe(text);
      const rows = tableRows(schema, text);

      // Exactly the records written, but for lone surrogates, which UTF-8 cannot carry.
      expect(
        keyed(
          schema,
          rows.map((r) => schema.fromRow(r)),
        ),
      ).toEqual(keyed(schema, written.map(viaUtf8)));
      expect(tableText(schema, rows)).toBe(text);
      expect(unitsText(schema, tableUnits(schema, text))).toBe(text);
      for (const row of rows) expect(lineRow(schema, rowLine(schema, row))).toEqual(row);
    }
  });

  it('writes the same file whatever order the rows come in', () => {
    const g = new Gen(prng(100 + TABLE_KINDS.indexOf(kind)));
    for (let run = 0; run < 50; run++) {
      const rows = distinct(
        schema,
        g.list(() => make(g), 8),
      ).map((r) => schema.toRow(r));
      expect(tableText(schema, shuffled(rows, g))).toBe(tableText(schema, rows));
    }
  });

  it('writes an empty table as its header alone', () => {
    const text = tableText(schema, []);
    expect(text).toBe(`${schema.columns.join(',')}\n`);
    expect(tableRows(schema, text)).toEqual([]);
    expect(tableUnits(schema, text).size).toBe(0);
  });

  it('reads no file as no rows', () => {
    expect(tableUnits(schema, null)).toEqual(new Map());
  });

  it('reads a key alone as it reads the key cells of a whole row', () => {
    const g = new Gen(prng(200 + TABLE_KINDS.indexOf(kind)));
    for (let run = 0; run < 100; run++) {
      const row = schema.toRow(make(g));
      const key = Object.fromEntries(schema.key.map((column) => [column, row[column]]));
      expect(schema.readKey(key)).toEqual(key);
      expect(schema.readKey(row)).toEqual(key);
    }
  });
});

describe('table files', () => {
  const bw = TABLES.bodyweight;
  const manual = TABLES.manualRecords;
  const record = (reps: number, date = '2026-09-14', exercise_id = 'bench'): ManualRecord => ({
    source: 'manual',
    date,
    exercise_id,
    reps,
    weight_kg: 100,
    rpe: 9,
    context: null,
  });

  it('are exactly header, sorted rows and a trailing newline', () => {
    const rows = [
      { date: '2026-09-14', weight_kg: 82.5, source: 'manual' },
      { date: '2026-09-13', weight_kg: 82, source: 'import' },
    ] as const;
    expect(
      tableText(
        bw,
        rows.map((r) => bw.toRow(r)),
      ),
    ).toBe('date,weight_kg,source\n2026-09-13,82,import\n2026-09-14,82.5,manual\n');
  });

  it('sort reps numerically, so 2 comes before 10', () => {
    const text = tableText(manual, [manual.toRow(record(10)), manual.toRow(record(2))]);
    expect(text.split('\n').slice(1, 3)).toEqual([
      '2026-09-14,bench,2,100,9,',
      '2026-09-14,bench,10,100,9,',
    ]);
  });

  it('sort by each key column in turn', () => {
    const rows = [
      record(1, '2026-09-15', 'bench'),
      record(5, '2026-09-14', 'squat'),
      record(3, '2026-09-14', 'bench'),
      record(1, '2026-09-14', 'squat'),
    ];
    const g = new Gen(prng(7));
    const expected = tableText(
      manual,
      rows.map((r) => manual.toRow(r)),
    );
    for (let run = 0; run < 20; run++) {
      expect(
        tableText(
          manual,
          shuffled(rows, g).map((r) => manual.toRow(r)),
        ),
      ).toBe(expected);
    }
    expect(
      tableRows(manual, expected).map((r) => [r.date, r.exercise_id, r.reps].join(' ')),
    ).toEqual([
      '2026-09-14 bench 3',
      '2026-09-14 squat 1',
      '2026-09-14 squat 5',
      '2026-09-15 bench 1',
    ]);
  });

  it('sort text by code point, not by UTF-16 unit', () => {
    // U+FF5A sorts before U+1F4AA by code point, after it by UTF-16 unit.
    const ids = ['💪', 'ｚ', 'b', 'B', 'a'];
    const text = tableText(
      manual,
      ids.map((id) => manual.toRow(record(1, '2026-09-14', id))),
    );
    expect(tableRows(manual, text).map((r) => r.exercise_id)).toEqual(['B', 'a', 'b', 'ｚ', '💪']);
  });

  it('write a lone surrogate as U+FFFD, so the device holds what UTF-8 carries', () => {
    const one = TABLES.oneRm;
    const entry: OneRmEntry = {
      date: '2026-09-14',
      lift: 'squat',
      weight_kg: 200,
      note: 'PR \uD83D',
    };
    const text = tableText(one, [one.toRow(entry)]);
    expect(text).toBe('date,lift,weight_kg,note\n2026-09-14,squat,200,PR \uFFFD\n');
    expect(utf8(text)).toBe(text);
    expect(one.fromRow(tableRows(one, text)[0]).note).toBe('PR \uFFFD');
    // A whole pair is a character like any other.
    const whole = tableText(one, [one.toRow({ ...entry, note: 'PR 💪' })]);
    expect(whole).toContain(',PR 💪\n');
  });

  it('sort and key rows as they are written, lone surrogates as U+FFFD', () => {
    // U+D83D sorts before U+FF5A, but the U+FFFD written for it sorts after.
    const text = tableText(manual, [
      manual.toRow(record(1, '2026-09-14', '\uD83D')),
      manual.toRow(record(1, '2026-09-14', 'ｚ')),
    ]);
    expect(tableRows(manual, text).map((r) => r.exercise_id)).toEqual(['ｚ', '\uFFFD']);
    expect(tableText(manual, tableRows(manual, text))).toBe(text);

    // Two halves that each become U+FFFD are one key in the file.
    const twice = [
      manual.toRow(record(1, '2026-09-14', 'a\uD83D')),
      manual.toRow(record(1, '2026-09-14', 'a\uDCAA')),
    ];
    expect(rowKey(manual, twice[0])).toBe(rowKey(manual, twice[1]));
    expect(() => tableText(manual, twice)).toThrow(/two rows/);
    expect(() => tableText(manual, twice)).not.toThrow(FormatError);
  });

  it('quote awkward cells and read them back', () => {
    const one = TABLES.oneRm;
    const entry: OneRmEntry = {
      date: '2026-09-14',
      lift: 'squat',
      weight_kg: 200,
      note: '  "Meet", day two\n# PR ',
    };
    const text = tableText(one, [one.toRow(entry)]);
    expect(text).toBe(
      'date,lift,weight_kg,note\n2026-09-14,squat,200,"  ""Meet"", day two\n# PR "\n',
    );
    expect(one.fromRow(tableRows(one, text)[0])).toEqual(entry);
  });

  it('read hand-written cells in the app’s own form', () => {
    const text = 'date,exercise_id,reps,weight_kg,rpe,context\n2026-09-14,bench,2.0,1e2,,\n';
    expect(tableRows(manual, text)).toEqual([manual.toRow({ ...record(2), rpe: null })]);
    const units = tableUnits(manual, text);
    expect([...units.values()]).toEqual(['2026-09-14,bench,2,100,,']);
    expect(unitsText(manual, units)).not.toBe(text);
  });

  it('read every decimal spelling of a number in the app’s own form', () => {
    const spellings = [
      ['82', '82'],
      ['+82', '82'],
      ['082', '82'],
      ['82.', '82'],
      ['82.50', '82.5'],
      ['.5', '0.5'],
      ['-2.5', '-2.5'],
      ['-0', '0'],
      ['8.25e1', '82.5'],
      ['825E-1', '82.5'],
      ['1e+2', '100'],
    ];
    for (const [cell, written] of spellings) {
      const text = `date,weight_kg,source\n2026-09-14,${cell},manual\n`;
      expect(tableRows(bw, text)[0].weight_kg, cell).toBe(written);
    }
  });

  it('give equal keys equal strings and different keys different ones', () => {
    const one = TABLES.oneRm;
    const row = (date: string, lift: CompetitionLift, weight_kg: number) =>
      one.toRow({ date, lift, weight_kg, note: null });
    expect(rowKey(one, row('2026-09-14', 'bench', 100))).toBe(
      rowKey(one, row('2026-09-14', 'bench', 120)),
    );
    expect(rowKey(one, row('2026-09-14', 'bench', 100))).not.toBe(
      rowKey(one, row('2026-09-14', 'squat', 100)),
    );
    // Cells holding the separator cannot run into each other.
    const additions = TABLES.additions;
    expect(rowKey(additions, { id: 'a,b' })).not.toBe(rowKey(additions, { id: 'a' }));
    expect(rowKey(manual, { date: 'a', exercise_id: 'b,c', reps: '1' })).not.toBe(
      rowKey(manual, { date: 'a,b', exercise_id: 'c', reps: '1' }),
    );
  });
});

describe('reading a table file fails with FormatError', () => {
  const bw = TABLES.bodyweight;
  const cases: Array<[string, string, RegExp]> = [
    ['no header', '', /header/],
    ['a missing column', 'date,weight_kg\n2026-09-14,82\n', /header/],
    ['reordered columns', 'weight_kg,date,source\n82,2026-09-14,manual\n', /header/],
    ['an extra column', 'date,weight_kg,source,x\n2026-09-14,82,manual,\n', /header/],
    ['a short row', 'date,weight_kg,source\n2026-09-14,82\n', /2 cells/],
    ['bad quoting', 'date,weight_kg,source\n"2026-09-14,82,manual\n', /never closed/],
    [
      'a duplicate key',
      'date,weight_kg,source\n2026-09-14,82,manual\n2026-09-14,83,import\n',
      /row 2: a second row/,
    ],
    ['a bad date', 'date,weight_kg,source\n14/09/2026,82,manual\n', /row 1: date/],
    ['a bad number', 'date,weight_kg,source\n2026-09-14,heavy,manual\n', /weight_kg/],
    ['a missing number', 'date,weight_kg,source\n2026-09-14,,manual\n', /weight_kg/],
    // `Number` reads all three; none is how a person writes a weight.
    ['a hexadecimal number', 'date,weight_kg,source\n2026-09-14,0x52,manual\n', /got "0x52"/],
    ['a binary number', 'date,weight_kg,source\n2026-09-14,0b101,manual\n', /got "0b101"/],
    ['an octal number', 'date,weight_kg,source\n2026-09-14,0o7,manual\n', /got "0o7"/],
    ['a number too large', 'date,weight_kg,source\n2026-09-14,1e999,manual\n', /got "1e999"/],
    [
      'a quoted number with blanks',
      'date,weight_kg,source\n2026-09-14," 82",manual\n',
      /got " 82"/,
    ],
    ['a bad source', 'date,weight_kg,source\n2026-09-14,82,scale\n', /source/],
  ];
  it.each(cases)('%s', (_name, text, message) => {
    expect(() => tableRows(bw, text)).toThrow(FormatError);
    expect(() => tableRows(bw, text)).toThrow(message);
    expect(() => tableUnits(bw, text)).toThrow(FormatError);
  });

  it('two spellings of one key', () => {
    const text =
      'date,exercise_id,reps,weight_kg,rpe,context\n2026-09-14,bench,2,100,,\n2026-09-14,bench,2.0,105,,\n';
    expect(() => tableRows(TABLES.manualRecords, text)).toThrow(/a second row/);
  });

  it('an invalid exercise in the additions', () => {
    const header = TABLES.additions.columns.join(',');
    expect(() => tableRows(TABLES.additions, `${header}\nx,X,,nonsense,,,,lats,,\n`)).toThrow(
      FormatError,
    );
    expect(() => tableRows(TABLES.additions, `${header}\nx,X,,nonsense,,,,lats,,\n`)).toThrow(
      /tier must be one of/,
    );
  });

  // A lifter's additions are read strictly, where the shipped library is not.
  it.each([
    ['garbage', ',,,acc,banana,,,not_a_muscle,,', /row 1: id: must not be empty/],
    ['an addition with no name', 'seal_row,,,acc,,,,lats,,', /row 1: name: must not be empty/],
    ['an id with capitals', 'Seal_Row,Seal row,,acc,,,,lats,,', /id: expected lowercase/],
    ['an id with a hyphen', 'seal-row,Seal row,,acc,,,,lats,,', /got "seal-row"/],
    ['an id with a space', '"seal row",Seal row,,acc,,,,lats,,', /got "seal row"/],
    ['an id beyond ASCII', 'remada_cavalinho_é,Remada,,acc,,,,lats,,', /id: expected lowercase/],
    ['unilateral as a word it is not', 'seal_row,Seal row,,acc,banana,,,lats,,', /got "banana"/],
    ['unilateral typed as Y', 'seal_row,Seal row,,acc,Y,,,lats,,', /unilateral: .* got "Y"/],
  ])('%s in the additions', (_name, line, message) => {
    const text = `${TABLES.additions.columns.join(',')}\n${line}\n`;
    expect(() => tableRows(TABLES.additions, text)).toThrow(FormatError);
    expect(() => tableRows(TABLES.additions, text)).toThrow(message);
  });

  it('a row line that is not one row of the table', () => {
    expect(() => lineRow(bw, '2026-09-14,82')).toThrow(FormatError);
    expect(() => lineRow(bw, '2026-09-14,82,manual\n2026-09-15,82,manual')).toThrow(FormatError);
    expect(() => lineRow(bw, '# comment')).toThrow(FormatError);
    expect(() => lineRow(bw, '2026-09-14,82,scale')).toThrow(FormatError);
  });
});

describe('writing a table refuses rows it could not read back', () => {
  const manual = TABLES.manualRecords;
  const row = manual.toRow({
    source: 'manual',
    date: '2026-09-14',
    exercise_id: 'bench',
    reps: 2,
    weight_kg: 100,
    rpe: null,
    context: null,
  });

  it('two rows with one key', () => {
    expect(() => tableText(manual, [row, { ...row, weight_kg: '105' }])).toThrow(/two rows/);
  });

  it('a row not in the app’s own form', () => {
    expect(() => tableText(manual, [{ ...row, reps: '2.0' }])).toThrow(/its own form/);
  });

  it('a row that does not read at all', () => {
    expect(() => tableText(manual, [{ ...row, date: 'yesterday' }])).toThrow(/cannot write/);
  });

  it('a row missing a column', () => {
    const { context: _, ...short } = row;
    expect(() => tableText(manual, [short])).toThrow(/no context/);
  });

  it('a number that is not finite', () => {
    expect(() =>
      manual.toRow({
        source: 'manual',
        date: '2026-09-14',
        exercise_id: 'bench',
        reps: 2,
        weight_kg: NaN,
        rpe: null,
        context: null,
      }),
    ).toThrow(/NaN/);
  });

  it('units filed under the wrong key', () => {
    const units = new Map([['2026-09-15,bench,2', rowLine(manual, row)]]);
    expect(() => unitsText(manual, units)).toThrow(/filed under/);
  });

  it('never as a FormatError, which would mean an unreadable file', () => {
    expect(() => tableText(manual, [{ ...row, date: 'yesterday' }])).not.toThrow(FormatError);
  });
});

// --- the exercise library ---------------------------------------------------------------

describe('additions and the shipped library', () => {
  const shipped = parseExercises(exercisesCsv);
  const additions = TABLES.additions;

  it('turn every shipped exercise into an addition and back unchanged', () => {
    expect(shipped.length).toBeGreaterThan(50);
    for (const exercise of shipped) {
      const addition: ExerciseAddition = { ...exercise, based_on: null };
      expect(additions.fromRow(additions.toRow(addition))).toEqual(addition);
    }
    const text = tableText(
      additions,
      shipped.map((e) => additions.toRow({ ...e, based_on: null })),
    );
    expect(tableRows(additions, text).map((r) => additions.fromRow(r))).toEqual(
      [...shipped].sort((a, b) => (a.id < b.id ? -1 : 1)).map((e) => ({ ...e, based_on: null })),
    );
  });

  it('read a shipped row, blanks and all, exactly as the library does', () => {
    const rows = parseCsv(exercisesCsv);
    rows.forEach((row, i) => {
      expect(additions.fromRow({ ...row, based_on: '' })).toEqual({
        ...shipped[i],
        based_on: null,
      });
    });
  });

  it('keep based_on', () => {
    const addition = { ...shipped[0], based_on: '7351de705f4a' };
    expect(additions.toRow(addition).based_on).toBe('7351de705f4a');
    expect(additions.fromRow(additions.toRow(addition))).toEqual(addition);
  });

  it('read unilateral in every spelling the library takes, and write it as true or empty', () => {
    const header = additions.columns.join(',');
    const unilateral = (cell: string) =>
      tableRows(additions, `${header}\nseal_row,Seal row,,acc,${cell},,,lats,,\n`)[0].unilateral;
    for (const cell of ['true', 'TRUE', 'True', '1', 'yes', 'Yes']) {
      expect(unilateral(cell), cell).toBe('true');
    }
    // A hand edit saying false plainly is read as false and rewritten as empty,
    // not refused as an unreadable file.
    for (const cell of ['', 'false', 'FALSE', 'False', '0', 'no', 'No']) {
      expect(unilateral(cell), cell).toBe('');
    }
  });

  it('keep a muscle this build does not know, which a newer one may have added', () => {
    const header = additions.columns.join(',');
    const [row] = tableRows(additions, `${header}\nseal_row,Seal row,,acc,,,,new_muscle,lats,\n`);
    expect(additions.fromRow(row).muscles).toEqual({ primary: ['new_muscle'], aux: ['lats'] });
  });

  it('leave the shipped library read leniently', () => {
    const csv = `${SHIPPED_EXERCISE_COLUMNS.join(',')}\nSeal Row,,,acc,Y,,,lats,\n`;
    expect(parseExercises(csv)).toMatchObject([{ id: 'Seal Row', name: '', unilateral: false }]);
  });
});

describe('exerciseRowHash', () => {
  const shipped = parseExercises(exercisesCsv);
  const byId = new Map(shipped.map((e) => [e.id, e]));

  it('is the first 12 hex characters of the SHA-1 of the row as the app writes it', () => {
    // printf '%s' '<line>' | shasum
    expect(exerciseRowHash(byId.get('low_bar_squat')!)).toBe('7351de705f4a');
    expect(exerciseRowHash(byId.get('single_leg_press')!)).toBe('a7cf9d449588');

    const squat = byId.get('low_bar_squat')!;
    const line = csvLine(
      SHIPPED_EXERCISE_COLUMNS.map((c) => TABLES.additions.toRow({ ...squat, based_on: null })[c]),
    );
    expect(line).toBe(
      'low_bar_squat,Low-Bar Squat,squat,comp,,external,kg,quads/adductors,glutes/lower_back',
    );
    expect(exerciseRowHash(squat)).toBe(sha1Hex(new TextEncoder().encode(line)).slice(0, 12));
  });

  it('covers the shipped columns only', () => {
    const squat = byId.get('low_bar_squat')!;
    expect(exerciseRowHash({ ...squat, based_on: 'abc' } as ExerciseAddition)).toBe(
      exerciseRowHash(squat),
    );
  });

  it('changes with every shipped column', () => {
    const squat = byId.get('low_bar_squat')!;
    const changed = [
      { ...squat, id: 'x' },
      { ...squat, name: 'Low-bar squat' },
      { ...squat, base_lift: null },
      { ...squat, tier: 'acc' as const },
      { ...squat, unilateral: true },
      { ...squat, load_type: 'bw_plus' as const },
      { ...squat, default_unit: 'lb' as const },
      { ...squat, muscles: { ...squat.muscles, primary: ['quads'] } },
      { ...squat, muscles: { ...squat.muscles, aux: ['glutes'] } },
    ];
    const hashes = new Set([squat, ...changed].map(exerciseRowHash));
    expect(hashes.size).toBe(changed.length + 1);
  });

  it('tells every shipped exercise apart', () => {
    const hashes = shipped.map(exerciseRowHash);
    expect(new Set(hashes).size).toBe(shipped.length);
    for (const h of hashes) expect(h).toMatch(/^[0-9a-f]{12}$/);
  });
});

// --- JSON files ---------------------------------------------------------------------------

describe('sessions', () => {
  it('read back what they wrote, and write back the same text', () => {
    const g = new Gen(prng(11));
    for (let run = 0; run < 300; run++) {
      const s = session(g);
      const text = serializeSession(s);
      expect(parseSession(text)).toEqual(s);
      expect(serializeSession(parseSession(text))).toBe(text);
    }
  });

  it('write the same text however the object was built', () => {
    const g = new Gen(prng(12));
    for (let run = 0; run < 50; run++) {
      const s = session(g);
      expect(serializeSession(reversedKeys(s))).toBe(serializeSession(s));
    }
  });

  it('write two-space JSON, keys in a fixed order, absent values as null, one final newline', () => {
    const s = session(new Gen(prng(13)));
    const text = serializeSession({ ...s, notes: undefined as unknown as null });
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    expect(text).toContain('\n  "notes": null,\n');
    expect(Object.keys(JSON.parse(text))).toEqual([
      'id',
      'date',
      'started_at',
      'tz',
      'time_precision',
      'ended_at',
      'label',
      'bodyweight_kg',
      'notes',
      'exercises',
      'created_at',
      'updated_at',
      'device_id',
    ]);
  });

  it('write nothing the type does not have', () => {
    const s = session(new Gen(prng(14)));
    const text = serializeSession({ ...s, extra: 1 } as Session);
    expect(text).toBe(serializeSession(s));
    expect(text).not.toContain('extra');
  });

  it('refuse to write a number that is not finite', () => {
    const s = session(new Gen(prng(15)));
    expect(() => serializeSession({ ...s, bodyweight_kg: Infinity })).toThrow(/Infinity/);
    expect(() => serializeSession({ ...s, bodyweight_kg: Infinity })).not.toThrow(FormatError);
  });

  it('write every kind of load and prescription', () => {
    const s: Session = {
      ...session(new Gen(prng(16))),
      exercises: [
        {
          id: 'i',
          exercise_id: 'bench',
          prescribed: [
            {
              id: 'p',
              reps: [5, null],
              rpe: null,
              load: { kind: 'weight', weight: { mode: 'pct_1rm', pct: [0.8, 0.8], lift: 'bench' } },
              is_warmup: false,
              notes: null,
            },
          ],
          performed: [
            {
              id: 's',
              prescribed_id: 'p',
              state: 'done',
              reps: 5,
              rpe: 8.5,
              load: { kind: 'weight', value: 100, unit: 'kg' },
              is_warmup: false,
              notes: null,
            },
          ],
          notes: null,
        },
      ],
    };
    const exercise = JSON.parse(serializeSession(s)).exercises[0];
    expect(exercise.prescribed[0]).toEqual({
      id: 'p',
      reps: [5, null],
      rpe: null,
      load: { kind: 'weight', weight: { mode: 'pct_1rm', pct: [0.8, 0.8], lift: 'bench' } },
      is_warmup: false,
      notes: null,
    });
    expect(Object.keys(exercise.performed[0])).toEqual([
      'id',
      'prescribed_id',
      'state',
      'reps',
      'rpe',
      'load',
      'is_warmup',
      'notes',
    ]);
  });
});

describe('reading a session fails with FormatError', () => {
  const valid = JSON.parse(serializeSession(session(new Gen(prng(21)))));
  const withSet = JSON.parse(
    serializeSession({
      ...session(new Gen(prng(22))),
      exercises: [
        {
          id: 'i',
          exercise_id: 'bench',
          prescribed: [
            {
              id: 'p',
              reps: [5, 5],
              rpe: [8, 9],
              load: { kind: 'weight', weight: { mode: 'absolute', kg: [100, 100] } },
              is_warmup: false,
              notes: null,
            },
          ],
          performed: [
            {
              id: 's',
              prescribed_id: null,
              state: 'done',
              reps: 5,
              rpe: 8,
              load: { kind: 'weight', value: 100, unit: 'kg' },
              is_warmup: false,
              notes: null,
            },
          ],
          notes: null,
        },
      ],
    }),
  );
  const edit = (base: object, change: (s: any) => void): string => {
    const copy = structuredClone(base);
    change(copy);
    return JSON.stringify(copy);
  };

  const cases: Array<[string, string, RegExp]> = [
    ['not JSON', '{"id": ', /not JSON/],
    ['not an object', '[]', /session: expected an object/],
    ['a missing field', edit(valid, (s) => delete s.device_id), /session.device_id: missing/],
    ['a mistyped field', edit(valid, (s) => (s.id = 5)), /session.id: expected a string/],
    ['a bad date', edit(valid, (s) => (s.date = '14 Sep')), /session.date: expected a YYYY/],
    ['null where not allowed', edit(valid, (s) => (s.tz = null)), /session.tz/],
    ['an unknown precision', edit(valid, (s) => (s.time_precision = 'hour')), /time_precision/],
    ['a label that is not an object', edit(valid, (s) => (s.label = 'x')), /session.label/],
    ['exercises not a list', edit(valid, (s) => (s.exercises = {})), /expected an array/],
    [
      'a wrong load tag',
      edit(withSet, (s) => (s.exercises[0].performed[0].load.kind = 'mass')),
      /session.exercises\[0\].performed\[0\].load.kind: expected one of weight, time, distance/,
    ],
    [
      'a load missing its value',
      edit(withSet, (s) => delete s.exercises[0].performed[0].load.value),
      /load.value: missing/,
    ],
    [
      'an unknown unit',
      edit(withSet, (s) => (s.exercises[0].performed[0].load.unit = 'stone')),
      /load.unit/,
    ],
    [
      'an unknown set state',
      edit(withSet, (s) => (s.exercises[0].performed[0].state = 'failed')),
      /state/,
    ],
    [
      'a wrong prescription mode',
      edit(withSet, (s) => (s.exercises[0].prescribed[0].load.weight.mode = 'percent')),
      /weight.mode/,
    ],
    [
      'an interval of three',
      edit(withSet, (s) => (s.exercises[0].prescribed[0].reps = [1, 2, 3])),
      /reps: expected an interval/,
    ],
    [
      'an interval holding text',
      edit(withSet, (s) => (s.exercises[0].prescribed[0].rpe = [8, '9'])),
      /rpe\[1\]: expected a number/,
    ],
    [
      'a boolean as text',
      edit(withSet, (s) => (s.exercises[0].prescribed[0].is_warmup = 'false')),
      /is_warmup: expected a boolean/,
    ],
  ];
  it.each(cases)('%s', (_name, text, message) => {
    expect(() => parseSession(text)).toThrow(FormatError);
    expect(() => parseSession(text)).toThrow(message);
  });

  it('but drops a field it does not know', () => {
    const text = edit(valid, (s) => (s.mood = 'good'));
    expect(parseSession(text)).toEqual(parseSession(JSON.stringify(valid)));
  });
});

describe('templates', () => {
  it('read back what they wrote, and write back the same text', () => {
    const g = new Gen(prng(31));
    for (let run = 0; run < 300; run++) {
      const t = template(g);
      const text = serializeTemplate(t);
      expect(parseTemplate(text)).toEqual(t);
      expect(serializeTemplate(parseTemplate(text))).toBe(text);
      expect(serializeTemplate(reversedKeys(t))).toBe(text);
    }
  });

  it('write prescribed sets without an id', () => {
    const t = template(new Gen(prng(32)));
    t.exercises = [{ exercise_id: 'bench', prescribed: [prescription(new Gen(prng(33)))] }];
    const read = JSON.parse(serializeTemplate(t));
    expect(Object.keys(read)).toEqual([
      'id',
      'name',
      'intention',
      'exercises',
      'created_at',
      'updated_at',
    ]);
    expect(Object.keys(read.exercises[0].prescribed[0])).toEqual([
      'reps',
      'rpe',
      'load',
      'is_warmup',
      'notes',
    ]);
  });

  it('fail to read garbage with FormatError', () => {
    expect(() => parseTemplate('null')).toThrow(FormatError);
    const t = JSON.parse(serializeTemplate(template(new Gen(prng(34)))));
    delete t.name;
    expect(() => parseTemplate(JSON.stringify(t))).toThrow(/template.name: missing/);
  });
});

describe('conflict records', () => {
  function conflict(g: Gen): ConflictRecord {
    const common = { id: '2026-09-27-7xq2', found_at: g.instant(), device_id: g.string() };
    const which = g.int(0, 2);
    if (which === 0) {
      const s = session(g);
      return { ...common, path: sessionPath(s.id), key: null, version: g.bool() ? s : null };
    }
    if (which === 1) {
      const t = template(g);
      return { ...common, path: templatePath(t.id), key: null, version: g.bool() ? t : null };
    }
    const kind = g.pick(TABLE_KINDS);
    const schema = TABLES[kind] as TableSchema<unknown>;
    const row = schema.toRow((records[kind] as (g: Gen) => unknown)(g));
    const key = Object.fromEntries(schema.key.map((c) => [c, row[c]]));
    return { ...common, path: schema.path, key, version: g.bool() ? row : null };
  }

  it('read back what they wrote, and write back the same text', () => {
    const g = new Gen(prng(41));
    for (let run = 0; run < 300; run++) {
      const c = conflict(g);
      const text = serializeConflict(c);
      expect(parseConflict(text)).toEqual(c);
      expect(serializeConflict(parseConflict(text))).toBe(text);
      expect(serializeConflict(reversedKeys(c))).toBe(text);
    }
  });

  it('write a table row with its columns in the table’s order', () => {
    const one = TABLES.oneRm;
    const row = one.toRow({ date: '2026-09-14', lift: 'squat', weight_kg: 200, note: null });
    const text = serializeConflict({
      id: '2026-09-27-7xq2',
      path: one.path,
      key: { lift: 'squat', date: '2026-09-14' },
      found_at: '2026-09-27T10:00:00.000Z',
      device_id: 'phone',
      version: reversedKeys(row),
    });
    expect(text).toBe(
      [
        '{',
        '  "id": "2026-09-27-7xq2",',
        '  "path": "lifter/one-rm-history.csv",',
        '  "key": {',
        '    "date": "2026-09-14",',
        '    "lift": "squat"',
        '  },',
        '  "found_at": "2026-09-27T10:00:00.000Z",',
        '  "device_id": "phone",',
        '  "version": {',
        '    "date": "2026-09-14",',
        '    "lift": "squat",',
        '    "weight_kg": "200",',
        '    "note": ""',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('refuse to write a record whose key does not fit its path', () => {
    const base = {
      id: '2026-09-27-7xq2',
      found_at: '2026-09-27T10:00:00.000Z',
      device_id: 'phone',
      version: null,
    };
    expect(() => serializeConflict({ ...base, path: TABLES.bodyweight.path, key: null })).toThrow(
      /needs the row's key/,
    );
    expect(() =>
      serializeConflict({ ...base, path: 'sessions/2026/2026-09-14-k3f9.json', key: { a: 'b' } }),
    ).toThrow(/has no row key/);
    expect(() => serializeConflict({ ...base, path: 'README.md', key: null })).toThrow(
      /cannot record a conflict/,
    );
  });

  it('fail to read garbage with FormatError', () => {
    const valid = {
      id: '2026-09-27-7xq2',
      path: 'lifter/bodyweight.csv',
      key: { date: '2026-09-14' },
      found_at: '2026-09-27T10:00:00.000Z',
      device_id: 'phone',
      version: { date: '2026-09-14', weight_kg: '82', source: 'manual' },
    };
    expect(parseConflict(JSON.stringify(valid)).version).toEqual(valid.version);

    const bad: Array<[object, RegExp]> = [
      [{ ...valid, path: 'README.md' }, /conflict.path/],
      [{ ...valid, path: 'sisyphos.json' }, /conflict.path/],
      [{ ...valid, key: null }, /conflict.key: expected an object/],
      [{ ...valid, key: { day: '2026-09-14' } }, /conflict.key.date: missing/],
      [{ ...valid, version: { date: '2026-09-14', weight_kg: '82' } }, /version.source: missing/],
      [{ ...valid, version: { ...valid.version, weight_kg: 82 } }, /expected a string/],
      [{ ...valid, version: { ...valid.version, date: 'today' } }, /conflict.version: date/],
      [{ ...valid, path: 'sessions/2026/2026-09-14-k3f9.json', version: null }, /conflict.key/],
      [
        { ...valid, path: 'templates/a-k3f9.json', key: null, version: { name: 'x' } },
        /conflict.version.id: missing/,
      ],
      [{ ...valid, found_at: null }, /found_at/],
    ];
    for (const [value, message] of bad) {
      expect(() => parseConflict(JSON.stringify(value))).toThrow(FormatError);
      expect(() => parseConflict(JSON.stringify(value))).toThrow(message);
    }
  });

  describe('on a table', () => {
    const manual = TABLES.manualRecords;
    const key = { date: '2026-09-14', exercise_id: 'bench', reps: '2' };
    const version = { ...key, weight_kg: '100', rpe: '', context: '' };
    const text = (path: string, key: object, version: object | null) =>
      JSON.stringify({
        id: '2026-09-27-7xq2',
        path,
        key,
        found_at: '2026-09-27T10:00:00.000Z',
        device_id: 'phone',
        version,
      });

    it('read the key and the saved row in the app’s own form, so resolving finds the row', () => {
      const saved = parseConflict(
        text(manual.path, { ...key, reps: '2.0' }, { ...version, reps: '2.0', weight_kg: '1e2' }),
      );
      expect(saved.key).toEqual(key);
      expect(saved.version).toEqual(version);
      // A deletion: the key is all there is.
      expect(parseConflict(text(manual.path, { ...key, reps: '+2' }, null)).key).toEqual(key);
    });

    it.each<[string, string, object, object | null, RegExp]>([
      [
        'a key that is not a key, beside a valid row',
        TABLES.bodyweight.path,
        { date: 'not a date' },
        { date: '2026-09-14', weight_kg: '82', source: 'manual' },
        /conflict.key: date: expected a date, got "not a date"/,
      ],
      ['a key that is not a key, deleted', manual.path, { ...key, reps: 'two' }, null, /key: reps/],
      ['a key that is not a number', manual.path, { ...key, reps: '0x2' }, null, /conflict.key/],
      [
        'an addition’s key the workflow would refuse',
        TABLES.additions.path,
        { id: 'Seal Row' },
        null,
        /conflict.key: id: expected lowercase/,
      ],
      [
        'a saved row that is not the row its key names',
        manual.path,
        { ...key, reps: '3' },
        version,
        /conflict.version: expected the row conflict.key names, 2026-09-14,bench,3/,
      ],
      [
        'a saved row on another date',
        TABLES.bodyweight.path,
        { date: '2026-09-15' },
        { date: '2026-09-14', weight_kg: '82', source: 'manual' },
        /conflict.version: expected the row conflict.key names/,
      ],
    ])('fail to read %s with FormatError', (_name, path, key, version, message) => {
      expect(() => parseConflict(text(path, key, version))).toThrow(FormatError);
      expect(() => parseConflict(text(path, key, version))).toThrow(message);
    });
  });

  it('fail to read a saved session or template that is not the one its path names', () => {
    const g = new Gen(prng(42));
    const record = (path: string, version: object) =>
      JSON.stringify({
        id: '2026-09-27-7xq2',
        path,
        key: null,
        found_at: '2026-09-27T10:00:00.000Z',
        device_id: 'phone',
        version,
      });
    const s = JSON.parse(serializeSession({ ...session(g), id: '2026-09-14-k3f9' }));
    const t = JSON.parse(serializeTemplate({ ...template(g), id: 'bench-k3f9' }));
    expect(parseConflict(record(sessionPath('2026-09-14-k3f9'), s)).version).toEqual(s);
    expect(parseConflict(record(templatePath('bench-k3f9'), t)).version).toEqual(t);

    const bad: Array<[string, object, RegExp]> = [
      [sessionPath('2026-09-14-7xq2'), s, /conflict.version.id: expected "2026-09-14-7xq2"/],
      [sessionPath('2025-09-14-k3f9'), s, /conflict.version.id/],
      [templatePath('squat-k3f9'), t, /conflict.version.id: expected "squat-k3f9"/],
    ];
    for (const [path, version, message] of bad) {
      expect(() => parseConflict(record(path, version))).toThrow(FormatError);
      expect(() => parseConflict(record(path, version))).toThrow(message);
    }
  });
});

describe('the format marker', () => {
  it('is { "format": 1 }', () => {
    expect(serializeFormatMarker({ format: 1 })).toBe('{\n  "format": 1\n}\n');
    expect(parseFormatMarker('{\n  "format": 1\n}\n')).toEqual({ format: 1 });
    expect(parseFormatMarker('{"format":2,"note":"x"}')).toEqual({ format: 2 });
  });

  it.each(['', '{}', '{"format": "1"}', '{"format": 1.5}', '{"format": 0}', '[1]'])(
    'fails to read %j with FormatError',
    (text) => {
      expect(() => parseFormatMarker(text)).toThrow(FormatError);
    },
  );
});

describe('a JSON file with a byte-order mark', () => {
  const g = new Gen(prng(61));

  it('is read as it would be without one, and written back without it', () => {
    const s = session(g);
    const text = serializeSession(s);
    expect(parseSession(`\uFEFF${text}`)).toEqual(s);
    expect(serializeSession(parseSession(`\uFEFF${text}`))).toBe(text);

    const t = template(g);
    expect(parseTemplate(`\uFEFF${serializeTemplate(t)}`)).toEqual(t);

    const c: ConflictRecord = {
      id: '2026-09-27-7xq2',
      path: sessionPath(s.id),
      key: null,
      found_at: '2026-09-27T10:00:00.000Z',
      device_id: 'phone',
      version: s,
    };
    expect(parseConflict(`\uFEFF${serializeConflict(c)}`)).toEqual(c);

    expect(parseFormatMarker('\uFEFF{"format": 1}\n')).toEqual({ format: 1 });
  });

  it('is unreadable with a second one, or one anywhere else', () => {
    expect(() => parseFormatMarker('\uFEFF\uFEFF{"format": 1}')).toThrow(FormatError);
    expect(() => parseFormatMarker(' \uFEFF{"format": 1}')).toThrow(FormatError);
  });
});

describe('awkward strings survive every file', () => {
  it.each(AWKWARD)('%j', (value) => {
    const one = TABLES.oneRm;
    const entry: OneRmEntry = { date: '2026-09-14', lift: 'bench', weight_kg: 1, note: value };
    const read = one.fromRow(tableRows(one, tableText(one, [one.toRow(entry)]))[0]);
    // An empty note is written as null is, so it reads back as null. A lone
    // surrogate comes back as the U+FFFD that UTF-8 carries for it.
    expect(read.note).toBe(value === '' ? null : utf8(value));

    // JSON escapes a lone surrogate, so a session keeps it exactly.
    const s = { ...session(new Gen(prng(51))), notes: value, device_id: value };
    const text = serializeSession(s);
    expect(utf8(text)).toBe(text);
    expect(parseSession(text)).toEqual(s);

    // A name may be anything but empty.
    if (value === '') return;
    const row: TableRow = TABLES.additions.toRow({
      ...parseExercises(exercisesCsv)[0],
      name: value,
      based_on: null,
    });
    expect(lineRow(TABLES.additions, rowLine(TABLES.additions, row))).toEqual(viaUtf8(row));
  });
});
