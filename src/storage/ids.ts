import type { Id, IsoDate } from '../model';

/**
 * Readable ids for the records that name files (docs/STORAGE.md 1.2).
 *
 * `taken` reports ids the device already holds; a generator never returns one.
 * `random` is injectable so tests and the simulation are deterministic; it
 * returns a float in [0, 1) like Math.random.
 *
 * STUB — implemented by the formats work package.
 */

/** Lowercase Crockford base 32: no i, l, o or u. */
export const ID_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

const todo = (): never => {
  throw new Error('not implemented: storage/ids');
};

/** `2026-09-14-k3f9`: the session's date when created, then four random characters. */
export function newSessionId(
  _date: IsoDate,
  _taken: (id: Id) => boolean,
  _random?: () => number,
): Id {
  return todo();
}

/** `squat-day-a-k3f9`: a slug of the template's name when created, then four random characters. */
export function newTemplateId(
  _name: string,
  _taken: (id: Id) => boolean,
  _random?: () => number,
): Id {
  return todo();
}

/** `2026-09-27-7xq2`: the date the conflict was found, then four random characters. */
export function newConflictId(
  _date: IsoDate,
  _taken: (id: Id) => boolean,
  _random?: () => number,
): Id {
  return todo();
}

/**
 * Lowercased; every run of characters other than ASCII letters and digits
 * becomes one hyphen; trimmed of hyphens; cut to 40 characters (and trimmed of
 * a trailing hyphen again). An empty result becomes `template`.
 */
export function slug(_name: string): string {
  return todo();
}
