/**
 * Minimal CSV reader for the config and library files.
 *
 * These files are ours: no embedded newlines, no quoted commas — list-valued
 * cells use `/` as a separator precisely so nothing ever needs quoting. That
 * keeps this to a split, and keeps a CSV library out of the dependency list.
 */
export type Row = Record<string, string>;

export function parseCsv(text: string): Row[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  if (lines.length === 0) return [];

  const header = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row: Row = {};
    header.forEach((key, i) => {
      row[key] = (cells[i] ?? '').trim();
    });
    return row;
  });
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
