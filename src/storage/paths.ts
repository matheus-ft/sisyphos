import type { Session } from '../model';

/**
 * Where each document lives in the log repo.
 *
 * One place, because the local dirty queue and the remote pusher must agree
 * exactly — a path computed twice is a path that can differ once.
 */
export const PATHS = {
  session: (s: Pick<Session, 'id' | 'date'>) =>
    `sessions/${s.date.slice(0, 4)}/${s.date}_${s.id}.json`,
  templates: 'templates/templates.json',
  localExercises: 'library/additions.csv',
  oneRm: 'lifter/one-rm-history.csv',
  manualRecords: 'lifter/manual-records.csv',
  bodyweight: 'lifter/bodyweight.csv',
} as const;

/** True for paths holding one session, which are the only ones that can conflict per-document. */
export function isSessionPath(path: string): boolean {
  return path.startsWith('sessions/');
}
