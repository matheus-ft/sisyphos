/**
 * The three-way decision. Pure: no I/O, no clock, no
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

export function decideFile(versions: FileVersions, mode: Mode): FileDecision {
  // Null is compared like any other value: absent on both sides is equal, which
  // is how a deletion, and a path a device never agreed on, fall out of the rule.
  const { base, local, remote } = versions;
  if (local === remote) return 'same';
  if (local === base) return 'take';
  // From here on the device holds a change the remote does not have, whichever
  // of the two rows below would apply. A pull leaves it for the next full sync.
  if (mode === 'pull') return 'skip';
  if (remote === base) return 'push';
  return 'conflict';
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
   * The base after this decision, key by key: the remote row for
   * every key whose result equals the remote's (absent if both are absent), the
   * old base row for every other key.
   */
  nextBase: Map<string, string>;
  /** One per conflicting key: this device's row line, or null if it had deleted the row. */
  conflicts: Array<{ key: string; local: string | null }>;
}

export function decideTable(versions: TableVersions, mode: Mode): TableDecision {
  const { base, local, remote } = versions;
  const result = new Map<string, string>();
  const nextBase = new Map<string, string>();
  const conflicts: TableDecision['conflicts'] = [];

  // Every key any version has. Sorted, so the same versions always give the
  // same output in the same order, whatever order the maps were built in.
  const keys = [...new Set([...base.keys(), ...local.keys(), ...remote.keys()])].sort();

  for (const key of keys) {
    const b = base.get(key) ?? null;
    const l = local.get(key) ?? null;
    const r = remote.get(key) ?? null;
    const decision = decideFile({ base: b, local: l, remote: r }, mode);

    // Pushing and skipping keep this device's row; every other outcome leaves
    // the device holding the remote's.
    const row = decision === 'push' || decision === 'skip' ? l : r;
    if (row !== null) result.set(key, row);

    // The remote holds `r` at this head whether or not the push lands, so where
    // the device now agrees with it, that is the new base. Everywhere else the
    // old base stays, so the key still reads as changed here next round.
    const agreed = row === r ? r : b;
    if (agreed !== null) nextBase.set(key, agreed);

    if (decision === 'conflict') conflicts.push({ key, local: l });
  }

  return { result, nextBase, conflicts };
}
