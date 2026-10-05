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

/** How often a long-open app asks whether a new version exists: a launch does it too. */
export const CHECK_EVERY_MS = 60 * 60 * 1000;
