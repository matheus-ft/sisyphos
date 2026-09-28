import { describe, it, expect } from 'vitest';
import { csvCell, csvLine, parseCsv, parseCsvRecords, wellFormed } from '../src/csv';
import { FormatError } from '../src/storage/errors';
import exercisesCsv from '../src/library/exercises.csv?raw';
import musclesCsv from '../src/library/muscles.csv?raw';
import rpeCsv from '../src/metrics/rpe-chart.csv?raw';
import stressCsv from '../src/metrics/stress-chart.csv?raw';

/** Mulberry32: a small seeded PRNG, so every generated case is reproducible. */
function prng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Values that each exercise one quoting rule, or sit just beside one. */
const AWKWARD = [
  '',
  ' ',
  '  leading',
  'trailing  ',
  '\tTab',
  ' nbsp',
  ',',
  'a,b',
  '"',
  'say "hi"',
  '""',
  '\n',
  'two\nlines',
  '\r\n',
  'a\rb',
  '#',
  '# not a comment',
  'x#y',
  '/',
  'a/b',
  'Crème brûlée',
  '💪',
  '中文',
  ' ',
  'plain',
  // Halves of a surrogate pair, as a note cut in the middle of an emoji holds.
  'a\uD83Db',
  '\uD83D',
  '\uDCAA',
  '\uDCAA\uD83D',
  ' \uD83D',
];
// With the two halves of 💪 on their own: drawn apart they are lone, in order a pair.
const CHARS = [
  '\uD83D',
  '\uDCAA',
  'a',
  'Z',
  '0',
  ' ',
  ',',
  '"',
  '\r',
  '\n',
  '#',
  '/',
  'é',
  '💪',
  '\t',
  ' ',
];

/**
 * Text as UTF-8 carries it, which is what every other copy of a file holds:
 * the same, but for lone surrogates, which come back as U+FFFD.
 */
const utf8 = (text: string) => new TextDecoder().decode(new TextEncoder().encode(text));

function awkward(random: () => number): string {
  if (random() < 0.5) return AWKWARD[Math.floor(random() * AWKWARD.length)];
  let s = '';
  const length = Math.floor(random() * 8);
  for (let i = 0; i < length; i++) s += CHARS[Math.floor(random() * CHARS.length)];
  return s;
}

const strict = { strict: true };

describe('reading', () => {
  it('reads quoted cells holding commas, doubled quotes and line breaks', () => {
    const text = 'a,b,c\n"x,y","say ""hi""","one\ntwo\r\nthree"\n';
    expect(parseCsv(text, strict)).toEqual([{ a: 'x,y', b: 'say "hi"', c: 'one\ntwo\r\nthree' }]);
  });

  it('trims unquoted cells and takes quoted ones exactly', () => {
    expect(parseCsvRecords('  a  ,"  b  ",\t c\n')).toEqual([['a', '  b  ', 'c']]);
  });

  it('reads empty cells, quoted or not', () => {
    expect(parseCsvRecords('a,,""\n,,\n', strict)).toEqual([
      ['a', '', ''],
      ['', '', ''],
    ]);
  });

  it('skips blank lines and comment lines', () => {
    const text = '# header comment\n\na,b\n   \n  # indented comment\n1,2\n\n';
    expect(parseCsvRecords(text, strict)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('does not take a # inside a quoted cell, or a quoted #, for a comment', () => {
    const text = 'a,b\n"line\n# still the cell",x\n"#1",y\n';
    expect(parseCsvRecords(text, strict)).toEqual([
      ['a', 'b'],
      ['line\n# still the cell', 'x'],
      ['#1', 'y'],
    ]);
  });

  it('accepts CRLF line endings and a missing final newline', () => {
    expect(parseCsvRecords('a,b\r\n"1",2\r\n3,"4"\r\n', strict)).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(parseCsvRecords('a,b\n1,2', strict)).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('reads nothing from an empty file', () => {
    expect(parseCsv('', strict)).toEqual([]);
    expect(parseCsv('# only a comment\n')).toEqual([]);
  });
});

describe('lenient reading', () => {
  it('pads short rows and ignores extra cells', () => {
    expect(parseCsv('a,b,c\n1\n1,2,3,4\n')).toEqual([
      { a: '1', b: '', c: '' },
      { a: '1', b: '2', c: '3' },
    ]);
  });

  it('reads a stray quote literally, and an unclosed quote to the end', () => {
    expect(parseCsvRecords('a"b,c\n')).toEqual([['a"b', 'c']]);
    expect(parseCsvRecords('a,"b\nc')).toEqual([['a', 'b\nc']]);
  });

  it('lets a quoted cell follow blanks, and keeps text after its closing quote', () => {
    expect(parseCsvRecords('a, "b, c" ,"d"e\n')).toEqual([['a', 'b, c', 'de']]);
  });
});

describe('strict reading', () => {
  const fails = (text: string, message: RegExp) => {
    expect(() => parseCsv(text, strict)).toThrow(FormatError);
    expect(() => parseCsv(text, strict)).toThrow(message);
  };

  it('rejects a quote that is never closed', () => {
    fails('a,b\n1,"2\n', /line 2: a quoted cell is never closed/);
  });

  it('rejects text after a closing quote', () => {
    fails('a,b\n"1"x,2\n', /line 2: text after a closing quote/);
    fails('a,b\n"1" ,2\n', /text after a closing quote/);
  });

  it('rejects a quote inside an unquoted cell', () => {
    fails('a,b\n1,2"3\n', /line 2: a quote inside an unquoted cell/);
    fails('a,b\n1, "2"\n', /a quote inside an unquoted cell/);
  });

  it('rejects a row whose cell count differs from the header', () => {
    fails('a,b\n1,2\n1\n', /line 3: 1 cells where the header has 2/);
    fails('a,b\n1,2,3\n', /line 2: 3 cells where the header has 2/);
  });

  it('counts lines through quoted line breaks', () => {
    fails('a,b\n"x\ny",1\n1\n', /line 4:/);
  });

  it('rejects a repeated column name', () => {
    fails('a,a\n1,2\n', /repeated/);
  });
});

describe('writing', () => {
  it('quotes exactly the cells 1.4 says to', () => {
    const quoted = [',', 'a,b', '"', 'a"b', '\r', '\n', '#', '#x', ' a', 'a ', '\ta', ' a', ' '];
    const plain = ['', 'a', 'a b', 'x#', 'a/b', 'é', '💪', '1.5', 'true'];
    for (const value of quoted) expect(csvCell(value), JSON.stringify(value)).toMatch(/^".*"$/s);
    for (const value of plain) expect(csvCell(value)).toBe(value);
  });

  it('doubles inner quotes', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvLine(['a', 'b,c', ''])).toBe('a,"b,c",');
  });

  it('writes a lone surrogate as U+FFFD, as UTF-8 would carry it, and a pair as it is', () => {
    expect(csvCell('a\uD83Db')).toBe('a\uFFFDb');
    expect(csvCell('\uDCAA\uD83D')).toBe('\uFFFD\uFFFD');
    expect(csvCell(' \uD83D,')).toBe('" \uFFFD,"');
    expect(csvCell('💪')).toBe('💪');
    expect(csvLine(['\uD83D', '💪'])).toBe('\uFFFD,💪');
    expect(wellFormed('a\uD83Db\uDCAA💪')).toBe('a\uFFFDb\uFFFD💪');
  });
});

describe('round trip', () => {
  it('reads back exactly the records the writer wrote, and writes back the same text', () => {
    const random = prng(1);
    for (let run = 0; run < 300; run++) {
      // Two cells at least: a record of one empty cell is a blank line.
      const width = 2 + Math.floor(random() * 4);
      const records = Array.from({ length: Math.floor(random() * 6) }, () =>
        Array.from({ length: width }, () => awkward(random)),
      );
      const text = records.map((r) => `${csvLine(r)}\n`).join('');
      // The device holds exactly what UTF-8 carries to the remote.
      expect(utf8(text)).toBe(text);

      // Exactly the records written, but for lone surrogates, which UTF-8 cannot carry.
      const read = parseCsvRecords(text, strict);
      expect(read).toEqual(records.map((r) => r.map(utf8)));
      expect(read.map((r) => `${csvLine(r)}\n`).join('')).toBe(text);
    }
  });

  it('round-trips every awkward value in every position', () => {
    for (const value of AWKWARD) {
      for (const record of [
        [value, 'x'],
        ['x', value],
        [value, value, value],
      ]) {
        expect(parseCsvRecords(csvLine(record), strict)).toEqual([record.map(utf8)]);
      }
    }
  });
});

describe('the shipped files', () => {
  /** What a file with no quotes needs: split on newlines and commas, trim, skip comments. */
  function plainSplit(text: string): Array<Record<string, string>> {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'));
    const header = lines[0].split(',').map((h) => h.trim());
    return lines.slice(1).map((line) => {
      const cells = line.split(',');
      return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? '').trim()]));
    });
  }

  it.each([
    ['exercises.csv', exercisesCsv],
    ['muscles.csv', musclesCsv],
    ['rpe-chart.csv', rpeCsv],
    ['stress-chart.csv', stressCsv],
  ])('reads %s as a plain split would', (_name, text) => {
    const data = text.split('\n').filter((line) => !line.trim().startsWith('#'));
    expect(data.join('\n')).not.toContain('"');
    const rows = parseCsv(text);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows).toEqual(plainSplit(text));
  });

  it('reads the charts as their documented sizes', () => {
    expect(parseCsv(rpeCsv)).toHaveLength(232);
    expect(parseCsv(stressCsv)).toHaveLength(252);
  });
});
