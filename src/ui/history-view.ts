import type { Exercise, Id, IsoDate, PerformedSet, PersonalRecord, Session } from '../model';
import { MONTH_NAMES } from '../metrics/dates';
import { compareSessions } from '../metrics/flatten';
import type { RecordEvent } from '../metrics/records';
import {
  bestSetOf,
  type BestSet,
  type CalendarDay,
  type HistoryRow,
  type HistoryWeek,
} from './history';
import { formatMinutes, sessionMinutes } from './format';
import { formatSet } from './session';

/**
 * The words and choices of the History screens that history.ts leaves out: the
 * filter's picker, the row and week lines, which session a tapped day opens,
 * and one exercise's own history.
 */

// --- the exercise filter ------------------------------------------------------------

/** Exercises that appear in at least one session, by name: what the filter can pick. */
export function exercisesInLog(
  sessions: readonly Session[],
  library: readonly Exercise[],
): Exercise[] {
  const seen = new Set(sessions.flatMap((s) => s.exercises.map((e) => e.exercise_id)));
  return library.filter((e) => seen.has(e.id)).sort((a, b) => a.name.localeCompare(b.name));
}

/** Every word of the query appears in the name, in any order and any case. */
export function matchExercises(list: readonly Exercise[], query: string): Exercise[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...list];
  return list.filter((e) => {
    const name = e.name.toLowerCase();
    return words.every((w) => name.includes(w));
  });
}

// --- the list -----------------------------------------------------------------------

/** "Squat, bench, Romanian deadlift", in session order. */
export function exerciseSummary(session: Session, names: ReadonlyMap<string, string>): string {
  const list = session.exercises.map((e) => names.get(e.exercise_id) ?? e.exercise_id);
  return list.length ? list.join(', ') : 'No exercises';
}

export const e1rmText = (kg: number): string => String(Math.round(kg));

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Done working sets of one exercise in one session. */
export function exerciseSets(session: Session, exerciseId: string): number {
  return session.exercises
    .filter((e) => e.exercise_id === exerciseId)
    .reduce((n, e) => n + e.performed.filter((s) => s.state === 'done' && !s.is_warmup).length, 0);
}

/** The row's second line when filtered: "4 sets · best". */
export function filteredLead(row: HistoryRow, exerciseId: string): string {
  const n = exerciseSets(row.session, exerciseId);
  return row.planned ? 'Planned' : `${plural(n, 'set', 'sets')} · best`;
}

/** The week header's summary: "3 sessions · 41 sets", or "best e1RM 112" when filtered. */
export function weekSummary(week: HistoryWeek, filtered: boolean): string {
  const { sessions, planned, sets } = week.counts;
  const best = filtered ? Math.max(0, ...week.rows.map((r) => r.best?.e1rm ?? 0)) : 0;
  if (best > 0) return `best e1RM ${e1rmText(best)}`;
  const done = sessions - planned;
  return [
    done > 0 ? plural(done, 'session', 'sessions') : null,
    planned > 0 ? `${planned} planned` : null,
    !filtered && sets > 0 ? plural(sets, 'set', 'sets') : null,
  ]
    .filter((p) => p !== null)
    .join(' · ');
}

/** "18:30", when the session was started; null for a plan or one logged after the fact. */
export function startClock(session: Session): string | null {
  if (session.started_at === null || session.time_precision === 'date_only') return null;
  return new Date(session.started_at).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "18:30 · 54 min": what tells two sessions of one day apart. */
export function sessionWhen(session: Session, now: number = Date.now()): string {
  const state =
    session.started_at === null
      ? 'planned'
      : session.ended_at === null
        ? 'in progress'
        : (() => {
            const minutes = sessionMinutes(session, now);
            return minutes === null ? null : formatMinutes(minutes);
          })();
  return [startClock(session), state].filter((p) => p !== null).join(' · ');
}

/**
 * Where to put the laurel and the calendar's dot. With a filter on, only
 * records of that exercise count: a bench record must not mark a day on the
 * squat's history.
 */
export function recordMarks(
  events: readonly RecordEvent[],
  exerciseId?: string,
): { sessions: Set<Id>; days: Set<IsoDate> } {
  const kept = exerciseId ? events.filter((e) => e.exercise_id === exerciseId) : events;
  return {
    sessions: new Set(kept.map((e) => e.session_id)),
    days: new Set(kept.map((e) => e.date)),
  };
}

// --- the calendar -------------------------------------------------------------------

export type DayTap = { kind: 'none' } | { kind: 'open'; id: Id } | { kind: 'choose'; ids: Id[] };

/** One session opens at once; several are chosen from; an empty day does nothing. */
export function dayTap(day: CalendarDay): DayTap {
  const ids = [...day.sessions, ...day.planned];
  if (ids.length === 0) return { kind: 'none' };
  return ids.length === 1 ? { kind: 'open', id: ids[0] } : { kind: 'choose', ids };
}

/** What a screen reader hears for a day: "4 October, 2 sessions, record set". */
export function dayAria(day: CalendarDay, longDate: string): string {
  const parts = [longDate];
  if (day.sessions.length > 0) parts.push(plural(day.sessions.length, 'session', 'sessions'));
  if (day.planned.length > 0) parts.push(`${day.planned.length} planned`);
  if (day.record) parts.push('record set');
  if (day.today) parts.push('today');
  return parts.join(', ');
}

// --- one exercise's history ---------------------------------------------------------

export interface ExerciseVisit {
  session: Session;
  /** Done working sets, consecutive identical ones folded: "140 × 5 @ 8 ×3". */
  sets: string[];
  warmups: number;
  best: BestSet | null;
}

export interface ExerciseHistoryView {
  /** Months, newest first, each with its sessions newest first. */
  months: { key: string; label: string; visits: ExerciseVisit[] }[];
  sessions: number;
  /** The best e1RM of any visit, with when it was set; null when no set can be priced. */
  bestE1rm: { kg: number; date: IsoDate } | null;
  /** Rep counts that hold a record for this exercise: the Labours rows with a weight. */
  records: number;
}

function fold(sets: PerformedSet[], exercise: Exercise): string[] {
  const out: { text: string; n: number }[] = [];
  for (const set of sets) {
    const text = formatSet(set, exercise);
    const last = out.at(-1);
    if (last?.text === text) last.n += 1;
    else out.push({ text, n: 1 });
  }
  return out.map(({ text, n }) => (n > 1 ? `${text} ×${n}` : text));
}

export function exerciseHistory(
  exercise: Exercise,
  sessions: readonly Session[],
  book: readonly PersonalRecord[],
  bodyweightAt?: (date: IsoDate) => number | null,
): ExerciseHistoryView {
  const visits: ExerciseVisit[] = [];
  for (const session of [...sessions].sort(compareSessions).reverse()) {
    const performed = session.exercises
      .filter((e) => e.exercise_id === exercise.id)
      .flatMap((e) => e.performed.filter((s) => s.state === 'done'));
    const working = performed.filter((s) => !s.is_warmup);
    if (working.length === 0) continue;
    visits.push({
      session,
      sets: fold(working, exercise),
      warmups: performed.length - working.length,
      best: bestSetOf(session, exercise, bodyweightAt),
    });
  }

  const months: ExerciseHistoryView['months'] = [];
  for (const visit of visits) {
    const key = visit.session.date.slice(0, 7);
    const last = months.at(-1);
    if (last?.key === key) last.visits.push(visit);
    else {
      const month = Number(key.slice(5)) - 1;
      months.push({ key, label: `${MONTH_NAMES[month]} ${key.slice(0, 4)}`, visits: [visit] });
    }
  }

  let bestE1rm: ExerciseHistoryView['bestE1rm'] = null;
  for (const { session, best } of visits) {
    if (best?.e1rm != null && (bestE1rm === null || best.e1rm > bestE1rm.kg)) {
      bestE1rm = { kg: best.e1rm, date: session.date };
    }
  }

  return {
    months,
    sessions: visits.length,
    bestE1rm,
    records: book.filter((r) => r.exercise_id === exercise.id).length,
  };
}
