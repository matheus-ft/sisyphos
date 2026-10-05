import type { Exercise, IsoDate, ProgramLabel, Session, Template } from '../model';
import {
  dayAndMonth,
  formatMinutes,
  programLabel,
  sessionMinutes,
  weekday,
  weekOf,
  workingSets,
} from './format';

/**
 * What the Train tab shows when asked what to do today: the plans, sorted by
 * how soon they are due, the line about the last session, and the names it
 * gives a plan. Pure, so the screen has nothing to decide.
 */

export const isPlanned = (s: Session): boolean => s.started_at === null && s.ended_at === null;

export interface Plans {
  /** Planned for today. */
  today: Session[];
  /** Planned for an earlier date and never started, oldest first. */
  overdue: Session[];
  /** Later in the same Monday-to-Sunday week as today. */
  thisWeek: Session[];
  /** Beyond this week. */
  ahead: Session[];
}

const byDate = (a: Session, b: Session): number =>
  a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at);

export function plansOf(sessions: readonly Session[], today: IsoDate): Plans {
  const plans = sessions.filter(isPlanned).sort(byDate);
  const week = weekOf(today);
  return {
    today: plans.filter((s) => s.date === today),
    overdue: plans.filter((s) => s.date < today),
    thisWeek: plans.filter((s) => s.date > today && weekOf(s.date) === week),
    ahead: plans.filter((s) => s.date > today && weekOf(s.date) !== week),
  };
}

/** The last session finished, newest by date, then by when it started. */
export function lastFinished(sessions: readonly Session[]): Session | null {
  const done = sessions.filter((s) => s.ended_at !== null);
  return (
    done.sort(
      (a, b) =>
        b.date.localeCompare(a.date) || (b.started_at ?? '').localeCompare(a.started_at ?? ''),
    )[0] ?? null
  );
}

const DAY_MS = 86_400_000;

/** Whole days from `from` to `to`; both are calendar dates, so no clock change can skew it. */
function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** "Last session Friday · 54 min · 7 sets": a weekday only while it is unambiguous. */
export function lastSessionLine(session: Session, today: IsoDate): string {
  const ago = daysBetween(session.date, today);
  const when =
    ago <= 0
      ? 'today'
      : ago === 1
        ? 'yesterday'
        : ago <= 6
          ? weekday(session.date)
          : dayAndMonth(session.date);
  const minutes = sessionMinutes(session);
  const sets = workingSets(session);
  return [
    `Last session ${when}`,
    minutes !== null ? formatMinutes(minutes) : null,
    `${sets} ${sets === 1 ? 'set' : 'sets'}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The myth's line under the frieze is for the first session of a week: none has begun yet this week. */
export function firstSessionOfWeek(sessions: readonly Session[], today: IsoDate): boolean {
  const week = weekOf(today);
  return !sessions.some((s) => s.started_at !== null && weekOf(s.date) === week);
}

/**
 * A plan has no name of its own, so it is named by the lifts it trains, the
 * way a lifter would say it: "Squat and bench", "Squat, bench and deadlift".
 * With no competition lift in it, by its first exercises.
 */
export function sessionName(
  session: Pick<Session, 'exercises'>,
  library: readonly Exercise[],
): string {
  const byId = new Map(library.map((e) => [e.id, e]));
  const lifts = new Set<string>();
  for (const e of session.exercises) {
    const lift = byId.get(e.exercise_id)?.base_lift;
    if (lift) lifts.add(lift);
  }
  const words =
    lifts.size > 0
      ? [...lifts]
      : session.exercises.slice(0, 2).map((e) => byId.get(e.exercise_id)?.name ?? e.exercise_id);
  if (words.length === 0) return 'Empty session';
  const sentence =
    words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** A template's second line: its program label, else how many exercises it holds. */
export function templateLine(template: Pick<Template, 'label' | 'exercises'>): string {
  const label: ProgramLabel = template.label;
  const text = programLabel(label);
  if (text) return text;
  const n = template.exercises.length;
  return n === 0 ? 'Nothing in it yet' : `${n} ${n === 1 ? 'exercise' : 'exercises'}`;
}
