import type { Id } from '../model';

/**
 * Where everything lives in the log repo (docs/STORAGE.md 1.1).
 *
 * One place, because the device, the sync and the remote must agree exactly on
 * every path: a path computed twice is a path that can differ once. A path
 * depends only on things that never change, so no edit ever moves a file.
 */

export const FORMAT_PATH = 'sisyphos.json';

/** The highest log-repo format this build reads and writes (1.3). */
export const FORMAT_VERSION = 1;

export const TABLE_PATHS = {
  bodyweight: 'lifter/bodyweight.csv',
  oneRm: 'lifter/one-rm-history.csv',
  manualRecords: 'lifter/manual-records.csv',
  additions: 'library/additions.csv',
} as const;

export type TableKind = keyof typeof TABLE_PATHS;

export const TABLE_KINDS = Object.keys(TABLE_PATHS) as TableKind[];

/** `sessions/<YYYY>/<id>.json`, the year being the first four characters of the id (1.2). */
export function sessionPath(id: Id): string {
  return `sessions/${id.slice(0, 4)}/${id}.json`;
}

export function templatePath(id: Id): string {
  return `templates/${id}.json`;
}

export function conflictPath(id: Id): string {
  return `conflicts/${id}.json`;
}

export type PathKind =
  | { kind: 'format' }
  | { kind: 'session'; id: Id }
  | { kind: 'template'; id: Id }
  | { kind: 'conflict'; id: Id }
  | { kind: 'table'; table: TableKind }
  /** Not the app's: a README, the lifter's notes. Never read, written or deleted. */
  | { kind: 'foreign' };

/*
 * The exact id grammar of 1.2, so only names the app itself could have
 * generated are the app's. A looser match would claim the lifter's own files
 * (`templates/notes.json`, `sessions/2026/2026 plan.json`): one that does not
 * parse would then be reported unreadable forever, and one that does would
 * appear as a second record.
 */
const SUFFIX = '[0-9a-hjkmnp-tv-z]{4}';
const SESSION = new RegExp(`^sessions/(\\d{4})/(\\1-\\d{2}-\\d{2}-${SUFFIX})\\.json$`);
const TEMPLATE = new RegExp(`^templates/([a-z0-9]+(?:-[a-z0-9]+)*-${SUFFIX})\\.json$`);
const CONFLICT = new RegExp(`^conflicts/(\\d{4}-\\d{2}-\\d{2}-${SUFFIX})\\.json$`);

/** What a log-repo path holds. Anything the app did not name is foreign. */
export function classify(path: string): PathKind {
  if (path === FORMAT_PATH) return { kind: 'format' };

  // The year folder must be the id's own year: `\1` in the pattern.
  const session = SESSION.exec(path);
  if (session) return { kind: 'session', id: session[2] };

  const template = TEMPLATE.exec(path);
  if (template) return { kind: 'template', id: template[1] };

  const conflict = CONFLICT.exec(path);
  if (conflict) return { kind: 'conflict', id: conflict[1] };

  for (const table of TABLE_KINDS) {
    if (TABLE_PATHS[table] === path) return { kind: 'table', table };
  }
  return { kind: 'foreign' };
}

/** True for every path the app reads and writes. */
export function isOurs(path: string): boolean {
  return classify(path).kind !== 'foreign';
}
