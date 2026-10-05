import { setTonnageKg, toKg } from '../metrics/load';
import type { Exercise, ExerciseInstance, PerformedSet, Session } from '../model';
import { sessionMinutes } from './format';
import { formatSet } from './session';

/**
 * The boulder's climb through a session, and what the finish screen reports.
 * Everything is derived from the session as it stands and never saved.
 */

// --- the boulder --------------------------------------------------------------------

/** How many sessions of history decide the target when nothing was planned. */
const HISTORY_SESSIONS = 4;
/** With nothing planned and no history to go on, a session's worth of sets. */
const DEFAULT_TARGET = 15;
/** The highest the boulder climbs before Finish: it reaches the top on arrival, not before. */
export const BOULDER_CAP = 0.95;

/** A set that counts toward the climb: done, and not a warm-up. */
function isWorking(set: PerformedSet): boolean {
  return set.state === 'done' && !set.is_warmup;
}

export function workingSetsDone(session: Session): number {
  return session.exercises.reduce((n, e) => n + e.performed.filter(isWorking).length, 0);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface Boulder {
  done: number;
  /** The working sets the climb is measured against. */
  target: number;
  /** 0 to 1 up the hill. */
  fraction: number;
  /** Where the target came from: the plan, the last sessions, or neither. */
  basis: 'plan' | 'history' | 'default';
}

/**
 * How far up the hill the boulder is: done working sets over those planned less
 * those skipped (a skipped set is neither done nor owed). With nothing planned,
 * the target is the median working-set count of the last four sessions that
 * had any, up to this one's date. The climb stops at `BOULDER_CAP` until the
 * session is finished, so extra sets, or an easy target, never put it at the
 * top early.
 */
export function boulderProgress(
  session: Session,
  others: Session[],
  options: { finished?: boolean } = {},
): Boulder {
  const done = workingSetsDone(session);

  const planned = session.exercises.reduce(
    (n, e) => n + e.prescribed.filter((p) => !p.is_warmup).length,
    0,
  );
  const skipped = session.exercises.reduce(
    (n, e) => n + e.performed.filter((s) => s.state === 'skipped' && !s.is_warmup).length,
    0,
  );

  let target = planned - skipped;
  let basis: Boulder['basis'] = 'plan';
  if (planned === 0 || target <= 0) {
    const counts = [...others]
      .filter((s) => s.id !== session.id && s.date <= session.date)
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) || (b.started_at ?? '').localeCompare(a.started_at ?? ''),
      )
      .map(workingSetsDone)
      .filter((n) => n > 0)
      .slice(0, HISTORY_SESSIONS);
    target = counts.length ? Math.max(1, Math.round(median(counts))) : DEFAULT_TARGET;
    basis = counts.length ? 'history' : 'default';
  }

  const fraction = options.finished ? 1 : Math.min(BOULDER_CAP, done / target);
  return { done, target, fraction, basis };
}

// --- the finish screen --------------------------------------------------------------

/** What a set lifted, as a number to rank by: kilograms where it is a mass, else its own quantity. */
function weightOf(set: PerformedSet): number {
  const load = set.load;
  if (!load) return 0;
  if (load.kind === 'weight') return toKg(load.value, load.unit) ?? load.value;
  return load.kind === 'time' ? load.seconds : load.meters;
}

/**
 * The heaviest of the sets, the more reps then the later when equal. Sets of
 * one exercise share what they measure, so comparing a pin setting with a mass
 * only arises when an exercise was logged both ways, which is not worth ranking.
 */
function heaviest(sets: PerformedSet[]): PerformedSet | null {
  let top: PerformedSet | null = null;
  for (const s of sets) {
    if (!top) top = s;
    else {
      const d = weightOf(s) - weightOf(top);
      if (d > 0 || (d === 0 && (s.reps ?? 0) >= (top.reps ?? 0))) top = s;
    }
  }
  return top;
}

export interface TopSet {
  exercise_id: string;
  name: string;
  /** As `formatSet` writes it: "140 × 5 @ 8". */
  text: string;
  set: PerformedSet;
}

export interface FinishStats {
  /** Whole minutes; null when the session has no clock time to measure (planned or logged after the fact). */
  durationMin: number | null;
  /** Working sets done. */
  sets: number;
  /** Kilograms moved, whole; pin settings never enter it. */
  tonnageKg: number;
  /** One per exercise done, in the order the session first had it. */
  topSets: TopSet[];
  /** Working sets that `isRecord` says set a record. */
  records: number;
}

/** Tells whether a done working set is a record. Computed elsewhere: this only counts. */
export type RecordPredicate = (instance: ExerciseInstance, set: PerformedSet) => boolean;

export function finishStats(
  session: Session,
  input: {
    exercise: (id: string) => Exercise | undefined;
    /** The finishing time, used when the session has no `ended_at` yet. */
    now: Date;
    isRecord: RecordPredicate;
  },
): FinishStats {
  // The one rule for a session's minutes, so the finish, History and Train agree.
  const durationMin = sessionMinutes(session, input.now.getTime());

  let sets = 0;
  let tonnage = 0;
  let records = 0;
  const byExercise = new Map<string, PerformedSet[]>();
  for (const instance of session.exercises) {
    const exercise = input.exercise(instance.exercise_id);
    for (const set of instance.performed.filter(isWorking)) {
      sets++;
      if (exercise) tonnage += setTonnageKg(set, exercise, session.bodyweight_kg) ?? 0;
      if (input.isRecord(instance, set)) records++;
      byExercise.set(instance.exercise_id, [...(byExercise.get(instance.exercise_id) ?? []), set]);
    }
  }

  const topSets: TopSet[] = [];
  for (const [id, working] of byExercise) {
    const top = heaviest(working);
    const exercise = input.exercise(id);
    if (top)
      topSets.push({
        exercise_id: id,
        name: exercise?.name ?? id,
        text: formatSet(top, exercise),
        set: top,
      });
  }

  return { durationMin, sets, tonnageKg: Math.round(tonnage), topSets, records };
}
