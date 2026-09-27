/**
 * The three-way decision (docs/STORAGE.md 4.3, 4.4). Pure: no I/O, no clock, no
 * randomness. The sync gathers the versions and applies the result; this only
 * decides.
 *
 * The rule, checked in order, first match wins:
 *
 *   L = R      nothing to change
 *   L = B      take R
 *   R = B      push L
 *   otherwise  conflict: take R, save L
 *
 * In a pull, a unit with a local change (L ≠ B and L ≠ R) is skipped entirely:
 * nothing taken, nothing saved, base untouched.
 *
 * STUB — implemented by the decisions work package.
 */

export type Mode = 'full' | 'pull';

/**
 * A file holding one record, as three fingerprints: any values where equal
 * content gives equal values (blob shas, or the text itself). Null is absent.
 */
export interface FileVersions {
  base: string | null;
  local: string | null;
  remote: string | null;
}

export type FileDecision =
  /** L = R. Nothing changes on either side; the base moves to R. */
  | 'same'
  /** L = B. Write R to the device (delete it if R is absent); the base moves to R. */
  | 'take'
  /** R = B. Push L (delete remotely if L is absent). */
  | 'push'
  /** Both changed differently. Take R; save L as a conflict record; the base moves to R. */
  | 'conflict'
  /** Pull only: L changed and differs from R. Leave the path exactly as it is. */
  | 'skip';

export function decideFile(_versions: FileVersions, _mode: Mode): FileDecision {
  throw new Error('not implemented: storage/decide');
}

/**
 * A table, as three maps from row key to row line (`tableUnits` in formats.ts).
 * A key missing from a map is a row absent from that version.
 */
export interface TableVersions {
  base: Map<string, string>;
  local: Map<string, string>;
  remote: Map<string, string>;
}

export interface TableDecision {
  /** The rows the device must hold afterwards. */
  result: Map<string, string>;
  /**
   * The base after this decision, key by key (4.2 step 5): the remote row for
   * every key whose result equals the remote's (absent if both are absent), the
   * old base row for every other key.
   */
  nextBase: Map<string, string>;
  /** One per conflicting key: this device's row line, or null if it had deleted the row. */
  conflicts: Array<{ key: string; local: string | null }>;
}

export function decideTable(_versions: TableVersions, _mode: Mode): TableDecision {
  throw new Error('not implemented: storage/decide');
}
