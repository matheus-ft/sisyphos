import { recordsSetInSession } from '../../metrics/records';
import {
  formatInterval,
  type Exercise,
  type ExerciseInstance,
  type Id,
  type ManualRecord,
  type PerformedSet,
  type Session,
} from '../../model';
import { amountOf, formatSet } from '../session';

/**
 * What an exercise card says about itself in each of its three states: done
 * (a summary with a seal), current (expanded, holding the set being entered)
 * and upcoming (one line). Pure, so the words and the rules are tested.
 */

export type CardMode = 'done' | 'current' | 'upcoming';

/** The set to be entered next: the first one still pending, in session order. */
export function firstPending(
  session: Session,
): { instance: ExerciseInstance; set: PerformedSet } | null {
  for (const instance of session.exercises) {
    const set = instance.performed.find((s) => s.state === 'pending');
    if (set) return { instance, set };
  }
  return null;
}

/**
 * Current holds the next set to enter; done has none pending, and everything
 * else waits. An exercise with no sets at all waits too: there is nothing yet
 * to have finished.
 */
export function cardMode(instance: ExerciseInstance, currentSetId: Id | null): CardMode {
  if (currentSetId !== null && instance.performed.some((s) => s.id === currentSetId)) {
    return 'current';
  }
  const finished =
    instance.performed.length > 0 && instance.performed.every((s) => s.state !== 'pending');
  return finished ? 'done' : 'upcoming';
}

const isWorkingDone = (s: PerformedSet) => s.state === 'done' && !s.is_warmup;

/** A set as a summary line writes it, close set: "130×5 @8". */
export function compactSet(set: PerformedSet, exercise?: Exercise): string {
  return formatSet(set, exercise).replace(' × ', '×').replace(' @ ', ' @');
}

/** The heaviest of the sets, the more reps then the later when equal. */
export function topSet(sets: PerformedSet[]): PerformedSet | null {
  let top: PerformedSet | null = null;
  for (const s of sets) {
    if (!top) top = s;
    else {
      const d = (amountOf(s) ?? 0) - (amountOf(top) ?? 0);
      if (d > 0 || (d === 0 && (s.reps ?? 0) >= (top.reps ?? 0))) top = s;
    }
  }
  return top;
}

/** What a last visit to the exercise is remembered by: its top working set, "90 × 5 @ 8". */
export function lastSummary(last: ExerciseInstance | null, exercise?: Exercise): string | null {
  if (!last) return null;
  const done = last.performed.filter((s) => s.state === 'done');
  const working = done.filter((s) => !s.is_warmup);
  const top = topSet(working.length ? working : done);
  return top ? formatSet(top, exercise) : null;
}

/** The RPE the first working set not yet done aims at: "@ 8", or "@ 7-8"; null without a target. */
export function targetRpeText(instance: ExerciseInstance): string | null {
  const next = instance.performed.find((s) => !s.is_warmup && s.state !== 'done');
  const p = instance.prescribed.find((x) => x.id === next?.prescribed_id);
  return p?.rpe ? `@ ${formatInterval(p.rpe)}` : null;
}

export interface DoneSummary {
  /** The working sets done, in order. */
  sets: { text: string; record: boolean }[];
  warmups: number;
  /** The rep counts at which a set here was a record. */
  recordReps: number[];
}

export function doneSummary(
  instance: ExerciseInstance,
  exercise: Exercise | undefined,
  recordSetIds: ReadonlySet<Id>,
): DoneSummary {
  const working = instance.performed.filter(isWorkingDone);
  const sets = working.map((s) => ({
    text: compactSet(s, exercise),
    record: recordSetIds.has(s.id),
  }));
  return {
    sets,
    warmups: instance.performed.filter((s) => s.is_warmup && s.state === 'done').length,
    recordReps: working
      .filter((s) => recordSetIds.has(s.id) && s.reps !== null)
      .map((s) => s.reps as number),
  };
}

/** "2 warm-ups", for the foot line of a done card; null when there were none. */
export function warmupsText(count: number): string | null {
  return count === 0 ? null : `${count} ${count === 1 ? 'warm-up' : 'warm-ups'}`;
}

/** "Record for 5 reps", or the count when more than one set was; null when none was. */
export function recordNote(reps: number[]): string | null {
  if (reps.length === 0) return null;
  if (reps.length > 1) return `${reps.length} records`;
  return `Record for ${reps[0]} ${reps[0] === 1 ? 'rep' : 'reps'}`;
}

/**
 * The line of an upcoming card: "3 × 8 · last 110 × 8 @ 7". A card some of
 * whose sets are done (the lifter went ahead and came back) says how far it got.
 */
export function upcomingLine(instance: ExerciseInstance, last: string | null): string {
  const working = instance.performed.filter((s) => !s.is_warmup && s.state !== 'skipped');
  const done = working.filter((s) => s.state === 'done').length;
  const prescribed = working
    .map((s) => instance.prescribed.find((p) => p.id === s.prescribed_id)?.reps)
    .find((r) => r);
  const reps = prescribed
    ? formatInterval(prescribed)
    : working.find((s) => s.reps !== null)?.reps?.toString();
  const n = working.length;
  let head: string;
  if (done > 0) head = `${done} of ${n} done`;
  else if (n === 0) head = 'No sets yet';
  else head = reps ? `${n} × ${reps}` : `${n} ${n === 1 ? 'set' : 'sets'}`;
  return last ? `${head} · last ${last}` : head;
}

/**
 * The sets of this session that were records when lifted: the laurel and the
 * gilded wash. Judged against the book as it stood before each one (see
 * `recordEvents`), so it holds for a past session as for today's.
 */
export function recordSetIds(
  session: Session,
  sessions: readonly Session[],
  library: readonly Exercise[],
  manual: readonly ManualRecord[],
): Set<Id> {
  return new Set(recordsSetInSession(session, sessions, library, manual).map((e) => e.set_id));
}
