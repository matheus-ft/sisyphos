import type { Id, IsoDate } from '../model';

/**
 * Readable ids for the records that name files (DATA.md, Ids).
 *
 * `taken` reports ids the device already holds; a generator never returns one.
 * `random` is injectable so tests and the simulation are deterministic; it
 * returns a float in [0, 1) like Math.random.
 */

/** Lowercase Crockford base 32: no i, l, o or u. */
export const ID_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/**
 * About a million suffixes per prefix, so a free one turns up at once unless
 * `random` is broken, and a broken `random` should fail loudly, not hang.
 */
const ATTEMPTS = 1000;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function unused(prefix: string, taken: (id: Id) => boolean, random: () => number): Id {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    let id = `${prefix}-`;
    for (let i = 0; i < 4; i++) id += ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length)];
    if (!taken(id)) return id;
  }
  throw new Error(`no free id starting ${prefix}- after ${ATTEMPTS} attempts`);
}

/**
 * A session's path takes its year from the id's first four characters, and a
 * meet's file is named by an id of this shape, so an id that does not start
 * with a real date would file the record where sync never looks for one.
 */
function datePrefix(date: IsoDate): string {
  if (!ISO_DATE.test(date)) throw new Error(`not a YYYY-MM-DD date: "${date}"`);
  return date;
}

/** `2026-09-14-k3f9`: the session's date when created, then four random characters. */
export function newSessionId(
  date: IsoDate,
  taken: (id: Id) => boolean,
  random: () => number = Math.random,
): Id {
  return unused(datePrefix(date), taken, random);
}

/** `2026-05-16-8mzt`: the meet's date when created, then four random characters. */
export function newMeetId(
  date: IsoDate,
  taken: (id: Id) => boolean,
  random: () => number = Math.random,
): Id {
  return unused(datePrefix(date), taken, random);
}

/** `squat-day-a-k3f9`: a slug of the template's name when created, then four random characters. */
export function newTemplateId(
  name: string,
  taken: (id: Id) => boolean,
  random: () => number = Math.random,
): Id {
  return unused(slug(name), taken, random);
}

/** `2026-09-27-7xq2`: the date the conflict was found, then four random characters. */
export function newConflictId(
  date: IsoDate,
  taken: (id: Id) => boolean,
  random: () => number = Math.random,
): Id {
  return unused(datePrefix(date), taken, random);
}

/**
 * Lowercased; every run of characters other than ASCII letters and digits
 * becomes one hyphen; trimmed of hyphens; cut to 40 characters (and trimmed of
 * a trailing hyphen again). An empty result becomes `template`.
 */
export function slug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/, '');
  return s === '' ? 'template' : s;
}
