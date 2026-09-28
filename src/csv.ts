import { FormatError } from './storage/errors';

/**
 * The CSV reader and writer, for the shipped library and charts and for the
 * tables in the log repo (docs/STORAGE.md 1.4). No dependency.
 *
 * RFC 4180 quoting: a quoted cell may hold commas, doubled quotes and line
 * breaks. The shipped files never quote anything (list cells use `/` for that
 * reason), but a lifter's note can hold anything, and the writer must never
 * produce a file the reader cannot read back exactly.
 *
 * Unquoted cells are trimmed, which the hand-aligned shipped files rely on, so
 * the writer quotes any value with whitespace at either end. Blank lines, and
 * lines whose first non-blank character is `#`, are skipped; the writer quotes a
 * value starting with `#` so a row can never be mistaken for a comment.
 */
export type Row = Record<string, string>;

export interface CsvOptions {
  /**
   * Throw `FormatError` on anything the writer would never produce: an
   * unterminated quote, text after a closing quote, a quote inside an unquoted
   * cell, a record with a different number of cells than the first, a repeated
   * column name. For log-repo files, where a file that does not parse must be
   * reported as unreadable rather than guessed at.
   *
   * Lenient (the default) never throws: it reads a stray quote literally, pads
   * short rows with empty cells and ignores extra ones.
   */
  strict?: boolean;
}

/** Every record in the text as its cells, the header included. */
export function parseCsvRecords(text: string, options: CsvOptions = {}): string[][] {
  const strict = options.strict ?? false;
  const records: string[][] = [];
  const n = text.length;
  let i = 0;

  const fail = (at: number, problem: string): never => {
    const line = text.slice(0, at).split('\n').length;
    throw new FormatError(`line ${line}: ${problem}`);
  };

  while (i < n) {
    // At the start of a line, outside any quote: skip it whole if it is blank
    // or a comment.
    const eol = text.indexOf('\n', i);
    const lineEnd = eol === -1 ? n : eol;
    const line = text.slice(i, lineEnd).trim();
    if (line === '' || line.startsWith('#')) {
      i = lineEnd + 1;
      continue;
    }

    const start = i;
    const cells: string[] = [];
    for (;;) {
      let cell: string;
      // Lenient mode lets a quoted cell follow blanks, as in `a, "b, c"`.
      let j = i;
      if (!strict) while (text[j] === ' ' || text[j] === '\t') j++;

      if (text[j] === '"') {
        cell = '';
        j++;
        for (;;) {
          const quote = text.indexOf('"', j);
          if (quote === -1) {
            if (strict) fail(i, 'a quoted cell is never closed');
            cell += text.slice(j);
            j = n;
            break;
          }
          cell += text.slice(j, quote);
          if (text[quote + 1] === '"') {
            cell += '"';
            j = quote + 2;
          } else {
            j = quote + 1;
            break;
          }
        }
        // After the closing quote: the next cell, or the end of the record (a
        // CRLF line ending leaves its CR here).
        const end = cellEnd(text, j);
        const rest = text.slice(j, end);
        if (rest !== '' && !(rest === '\r' && text[end] !== ',')) {
          if (strict) fail(j, 'text after a closing quote');
          cell += rest.trimEnd();
        }
        i = end;
      } else {
        const end = cellEnd(text, i);
        cell = text.slice(i, end).trim();
        if (strict && cell.includes('"')) fail(i, 'a quote inside an unquoted cell');
        i = end;
      }

      cells.push(cell);
      if (text[i] === ',') {
        i++;
        continue;
      }
      i++; // past the newline, or past the end of the text
      break;
    }

    if (strict && records.length > 0 && cells.length !== records[0].length) {
      fail(start, `${cells.length} cells where the header has ${records[0].length}`);
    }
    records.push(cells);
  }
  return records;
}

/** Where an unquoted stretch starting at `from` ends: the next comma or newline. */
function cellEnd(text: string, from: number): number {
  for (let k = from; k < text.length; k++) {
    if (text[k] === ',' || text[k] === '\n') return k;
  }
  return text.length;
}

/** The records after the header, as column name to cell. */
export function parseCsv(text: string, options: CsvOptions = {}): Row[] {
  const records = parseCsvRecords(text, options);
  if (records.length === 0) return [];

  const [header, ...rows] = records;
  if (options.strict && new Set(header).size !== header.length) {
    throw new FormatError('line 1: a column name is repeated');
  }
  return rows.map((cells) => {
    const row: Row = {};
    header.forEach((key, i) => {
      row[key] = cells[i] ?? '';
    });
    return row;
  });
}

/**
 * The text as UTF-8 carries it: every lone UTF-16 surrogate replaced by U+FFFD.
 *
 * A JavaScript string can hold half of a surrogate pair (a note cut in the
 * middle of an emoji), which UTF-8 cannot. `TextEncoder` replaces it with U+FFFD
 * when a file is hashed or uploaded, so a file written with the half kept would
 * differ on the device from the remote's copy while their shas agree. The
 * writer replaces it first, so the text the device holds is exactly the text
 * every other copy holds. JSON needs none of this: `JSON.stringify` escapes a
 * lone surrogate as `\udxxx`, which is plain ASCII.
 */
export function wellFormed(value: string): string {
  // With the `u` flag a surrogate pair is one code point, so only lone halves match.
  return value.replace(/\p{Surrogate}/gu, '\uFFFD');
}

/**
 * One cell as the writer emits it: quoted exactly when the value holds a comma,
 * a double quote, CR or LF, starts with `#`, or has whitespace at either end
 * (1.4). "Whitespace" is whatever `trim` removes, since that is what the reader
 * would strip from an unquoted cell. Lone surrogates are written as U+FFFD
 * (`wellFormed`).
 */
export function csvCell(value: string): string {
  const text = wellFormed(value);
  const quote = /[",\r\n]/.test(text) || text.startsWith('#') || text.trim() !== text;
  return quote ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * One record, without its newline. A record of a single empty cell comes out as
 * a blank line, which the reader skips; every table here has several columns.
 */
export function csvLine(cells: readonly string[]): string {
  return cells.map(csvCell).join(',');
}

/** A list-valued cell. Empty means an empty list, not a list containing "". */
export function parseList(cell: string): string[] {
  return cell
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** A boolean cell. Blank means false, which is how `unilateral` gets its default. */
export function parseBool(cell: string): boolean {
  const v = cell.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

export function parseNumber(cell: string): number | null {
  const v = cell.trim();
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
