import type { Id, Session } from '../model';
import { sessionInProgress } from '../storage/scheduler';
import type { StatusSnapshot } from '../storage/status';

/**
 * Whether a session is being lifted right now, which is what holds the notices
 * back (syncing waits for it too, by the scheduler's own rule). An unfinished
 * session left on another device, or logged after the fact (`date_only`, never
 * truly "running"), must not hold them forever. `wroteAt` says when this device
 * last saved each session: the copy in memory keeps its old `updated_at` until a
 * reload, though the lifter is writing to it.
 */
export function liveSession(
  sessions: Session[],
  now: Date,
  wroteAt: ReadonlyMap<Id, number> = new Map(),
): boolean {
  const lifted = sessions
    .filter((session) => session.time_precision !== 'date_only')
    .map((session) => {
      const wrote = wroteAt.get(session.id);
      return wrote !== undefined && wrote > Date.parse(session.updated_at)
        ? { ...session, updated_at: new Date(wrote).toISOString() }
        : session;
    });
  return sessionInProgress(lifted, now);
}

export interface StatusLine {
  text: string;
  /** Something the lifter should act on, rather than a state to glance at. */
  alarm: boolean;
}

/**
 * The one line every screen shows: whether what is on this phone is also in the
 * log repo. During a session syncing waits for the end on purpose, so that is
 * said calmly rather than as a warning.
 */
export function statusLine(snapshot: StatusSnapshot, inSession: boolean): StatusLine {
  const line = describe(snapshot, inSession);
  const conflicts = snapshot.conflicts + snapshot.libraryConflicts;
  if (conflicts === 0) return line;
  const noun = conflicts === 1 ? 'conflict' : 'conflicts';
  return { text: `${line.text} · ${conflicts} ${noun} kept, none lost`, alarm: line.alarm };
}

function describe(s: StatusSnapshot, inSession: boolean): StatusLine {
  switch (s.status) {
    case 'not_set_up':
      return { text: 'Only on this phone · set up sync', alarm: true };
    case 'syncing':
      return { text: 'Syncing…', alarm: false };
    case 'offline':
    case 'retrying': {
      const at = s.nextRetryAt ? ` at ${clock(s.nextRetryAt)}` : '';
      return { text: `Offline · will retry${at}`, alarm: false };
    }
    case 'needs_token':
    case 'repo_problem':
    case 'needs_update':
      return { text: s.message ?? 'Sync stopped', alarm: true };
    case 'idle':
      if (inSession) return { text: 'Saved on this phone · syncs when you finish', alarm: false };
      if (s.exposure.level === 'safe') return { text: 'Synced', alarm: false };
      return { text: s.exposure.message, alarm: s.exposure.level === 'at_risk' };
  }
}

function clock(at: Date): string {
  return at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export interface BannerView {
  kind: 'conflict' | 'info' | 'offline';
  text: string;
  /** Where its action leads: the conflicts page, or the sync page. */
  action: { label: string; to: 'conflicts' | 'sync' } | null;
}

/**
 * The banner every screen shows, if any, from the most pressing down:
 * conflicts, a sync that stopped, work at risk, being offline. During a
 * session only conflicts are announced: syncing waits for the end on purpose.
 * A device never set up says so in Agora rather than on every screen, since
 * the lifter chose to go without sync.
 */
export function bannerOf(snapshot: StatusSnapshot, inSession: boolean): BannerView | null {
  const conflicts = snapshot.conflicts + snapshot.libraryConflicts;
  if (conflicts > 0) {
    const noun = conflicts === 1 ? 'conflict' : 'conflicts';
    return {
      kind: 'conflict',
      text: `${conflicts} ${noun} to settle`,
      action: { label: 'Review', to: 'conflicts' },
    };
  }
  if (inSession) return null;
  switch (snapshot.status) {
    case 'needs_token':
    case 'repo_problem':
    case 'needs_update':
      return {
        kind: 'info',
        text: snapshot.message ?? 'Sync stopped.',
        action: { label: 'Fix', to: 'sync' },
      };
    case 'offline':
    case 'retrying':
      return { kind: 'offline', text: 'Offline. Sets save here and sync later.', action: null };
    case 'idle':
      return snapshot.exposure.level === 'at_risk'
        ? { kind: 'info', text: snapshot.exposure.message, action: { label: 'Sync', to: 'sync' } }
        : null;
    default:
      return null;
  }
}
