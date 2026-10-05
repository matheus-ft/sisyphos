import { restClock } from './rest';

/**
 * What the rest takeover shows at a moment, and whether the bell rings. The
 * numbers come from `rest.ts`; this turns them into the screen's words.
 */

/** "1:13", or "1:05:00" past the hour, for a count-up left running. */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const sec = String(s % 60).padStart(2, '0');
  if (s < 3600) return `${Math.floor(s / 60)}:${sec}`;
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${sec}`;
}

export interface RestFace {
  over: boolean;
  /** The caps label at the top left. */
  label: 'Rest' | 'Rest over';
  /** The big clock, without the overtime plus, which is set apart. */
  clock: string;
  /** Count-up past the target: draw the "+" before the clock. */
  plus: boolean;
  /** "of 3:00"; null with no target. */
  of: string | null;
  /** How much of the Greek key has filled, 0 to 1; null with no target (no band). */
  fraction: number | null;
  /** The clock reads in words for a screen reader. */
  spoken: string;
  /** A clock of five characters or more ("10:00") steps down a size to fit. */
  long: boolean;
}

function spokenTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const parts = [
    m > 0 ? `${m} ${m === 1 ? 'minute' : 'minutes'}` : '',
    `${s} ${s === 1 ? 'second' : 'seconds'}`,
  ];
  return parts.filter(Boolean).join(' ');
}

/** The takeover at `now`; a null target counts up from the start. */
export function restFace(startedAt: number, targetS: number | null, now: number): RestFace {
  if (targetS === null) {
    const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
    const clock = clockText(elapsed);
    return {
      over: false,
      label: 'Rest',
      clock,
      plus: false,
      of: null,
      fraction: null,
      spoken: spokenTime(elapsed),
      long: clock.length >= 5,
    };
  }
  const c = restClock(startedAt, targetS, now);
  const clock = clockText(c.over ? c.overtimeS : c.remainingS);
  return {
    over: c.over,
    label: c.over ? 'Rest over' : 'Rest',
    clock,
    plus: c.over,
    of: `of ${clockText(targetS)}`,
    fraction: c.fraction,
    spoken: c.over ? `${spokenTime(c.overtimeS)} over` : `${spokenTime(c.remainingS)} left`,
    long: clock.length >= 5,
  };
}

export interface BellState {
  /** Whether the count has already been past zero, so it rings once per crossing. */
  rung: boolean;
}

/**
 * Rings the bell once as the count crosses zero while the app is in view. A
 * rest opened, or an app returned to, after the deadline shows the overtime
 * without a bell, since the moment it marks is already gone; so does the app
 * hidden at zero. Moving the target out again (+15 s) re-arms it.
 */
export function bellStep(
  state: BellState,
  face: Pick<RestFace, 'over'>,
  overtimeMs: number,
  visible: boolean,
  chime: boolean,
): { state: BellState; ring: boolean } {
  if (!face.over) return { state: { rung: false }, ring: false };
  if (state.rung) return { state, ring: false };
  // Ticks come four times a second; a crossing seen later than this was slept through.
  const fresh = overtimeMs >= 0 && overtimeMs < BELL_WINDOW_MS;
  return { state: { rung: true }, ring: chime && visible && fresh };
}

export const BELL_WINDOW_MS = 1500;

/** "92.5 × 5 @ 8" as parts, so the × and @ can be set muted. */
export function figureParts(figures: string): { text: string; muted: boolean }[] {
  return figures
    .split(/([×@])/)
    .filter((t) => t !== '')
    .map((text) => ({ text, muted: text === '×' || text === '@' }));
}
