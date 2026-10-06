/**
 * When the app may tell the lifter a new version is waiting. A session is never
 * interrupted: the notice waits for it to end, and a fresh launch picks the
 * new version up without asking.
 */
export interface UpdateGate {
  /** The service worker has a newer version installed and waiting. */
  waiting: boolean;
  /** A session is started and not finished. */
  inSession: boolean;
  /** Something fuller is on screen (setup, the new-exercise form). */
  takeover?: boolean;
}

export function showUpdateNotice({ waiting, inSession, takeover = false }: UpdateGate): boolean {
  return waiting && !inSession && !takeover;
}

/**
 * What this tab does when a new service worker takes over. The library reloads
 * every open tab at that moment, whichever one the lifter tapped Reload in, so
 * a tab left running a session must decide for itself: only the tab that asked,
 * or one with nothing live, reloads now.
 */
export function onTakeover({
  tapped,
  inSession,
}: {
  tapped: boolean;
  inSession: boolean;
}): 'reload' | 'wait' {
  return tapped || !inSession ? 'reload' : 'wait';
}

/** How often a long-open app asks whether a new version exists: a launch does it too. */
export const CHECK_EVERY_MS = 60 * 60 * 1000;
