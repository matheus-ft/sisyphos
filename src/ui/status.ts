import type { StatusSnapshot } from '../storage/status';

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
