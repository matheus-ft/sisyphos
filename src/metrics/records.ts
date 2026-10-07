import type {
  Exercise,
  Id,
  IsoDate,
  ManualRecord,
  PerformedSet,
  PersonalRecord,
  Session,
  SessionRecord,
} from '../model';
import { daysBetween } from './dates';
import { countsWarmups, RECORD_MAX_REPS } from './definitions';
import { flattenSets } from './flatten';
import { weightKg } from './load';

/**
 * The record book: the best weight at each rep count from 1 to RECORD_MAX_REPS,
 * per exercise. A record is for exactly that many reps, so a heavy five does not
 * stand as the record for three.
 *
 * Only the competition lifts keep a book (`holdsRecords`): they are what a
 * record measures progress in, and a laurel on every accessory would make one
 * on a squat mean less. A meet's lifts are not in it either: they are
 * `CompetitionBest`s, kept apart.
 *
 * Records compare the weight the lifter loaded. For a bodyweight-plus lift that
 * is the added load, so a hand-entered "+30 kg" and a logged one line up
 * without anyone's bodyweight, and nothing here depends on one being on record.
 */

/** A record this recent carries the laurel on the Labours screen. */
export const RECENT_RECORD_DAYS = 30;

/**
 * Weights are compared to the centigram. A pound weight converted to kilograms
 * carries float noise, and without rounding two identical lifts in different
 * units would disagree about which was heavier.
 */
function round(kg: number): number {
  return Math.round(kg * 100) / 100;
}

/**
 * What a set offers the record book: its weight in kg, or null when it cannot
 * be one. Only done sets count, warm-ups only where `definitions.json` says so,
 * and a pin setting, a timed set or an unweighted exercise has no mass to rank.
 */
export function recordWeightKg(set: PerformedSet, exercise: Exercise): number | null {
  if (set.state !== 'done') return null;
  if (set.is_warmup && !countsWarmups('records')) return null;
  if (!holdsRecords(exercise) || exercise.load_type === 'none') return null;
  if (set.reps === null || !Number.isInteger(set.reps)) return null;
  if (set.reps < 1 || set.reps > RECORD_MAX_REPS) return null;
  const kg = weightKg(set.load);
  return kg !== null && kg > 0 ? round(kg) : null;
}

const keyOf = (exerciseId: string, reps: number) => `${exerciseId}:${reps}`;

/** Whether an exercise keeps a record book: the competition lifts, each stance its own. */
export function holdsRecords(exercise: Exercise): boolean {
  return exercise.tier === 'comp';
}

/** The hand-entered records of exercises that keep a book; the rest are kept but not shown. */
function heldManual(manual: readonly ManualRecord[], library: readonly Exercise[]): ManualRecord[] {
  const held = new Set(library.filter(holdsRecords).map((e) => e.id));
  return manual.filter((m) => held.has(m.exercise_id));
}

// --- from sessions ----------------------------------------------------------

/**
 * The records the sessions hold, derived on each call like tonnage and e1RM so
 * that a stored record can never disagree with the set that made it.
 *
 * A tie keeps the set lifted first. `exceptSetId` leaves one set out, so a set
 * being logged can be compared with the book as it stood without it.
 */
export function sessionRecords(
  sessions: readonly Session[],
  library: readonly Exercise[],
  options: { exceptSetId?: Id } = {},
): SessionRecord[] {
  const best = new Map<string, SessionRecord>();
  for (const { session, instance, set, exercise } of flattenSets(sessions, library)) {
    if (set.id === options.exceptSetId) continue;
    const kg = recordWeightKg(set, exercise);
    if (kg === null) continue;
    const key = keyOf(exercise.id, set.reps!);
    const held = best.get(key);
    // Strictly heavier: flattenSets is oldest first, so an equal later set loses.
    if (held && kg <= held.weight_kg) continue;
    best.set(key, {
      source: 'session',
      exercise_id: exercise.id,
      reps: set.reps!,
      weight_kg: kg,
      date: session.date,
      rpe: set.rpe,
      session_id: session.id,
      exercise_instance_id: instance.id,
      set_id: set.id,
    });
  }
  return sorted([...best.values()]);
}

// --- merged with what was entered by hand ------------------------------------

/**
 * Does `a` stand ahead of `b` at the same exercise and rep count?
 *
 * The heavier weight wins. On a tie the earlier date wins, because the record
 * belongs to whoever first lifted it: a later equal lift set nothing, and
 * letting it take over would move a record's date forward for no reason. On a
 * tie of date too the session's wins, since it points at a set the screen can
 * open and a hand-entered row cannot.
 */
function standsAhead(a: PersonalRecord, b: PersonalRecord): boolean {
  const wa = round(a.weight_kg);
  const wb = round(b.weight_kg);
  if (wa !== wb) return wa > wb;
  if (a.date !== b.date) return a.date < b.date;
  return a.source === 'session' && b.source === 'manual';
}

function sorted<T extends PersonalRecord>(records: T[]): T[] {
  return records.sort((a, b) => a.exercise_id.localeCompare(b.exercise_id) || a.reps - b.reps);
}

/** One record per exercise and rep count: the session-derived and manual rows together. */
export function mergeRecords(
  derived: readonly SessionRecord[],
  manual: readonly ManualRecord[],
): PersonalRecord[] {
  const best = new Map<string, PersonalRecord>();
  for (const record of [...derived, ...manual]) {
    if (record.reps < 1 || record.reps > RECORD_MAX_REPS) continue;
    const key = keyOf(record.exercise_id, record.reps);
    const held = best.get(key);
    if (!held || standsAhead(record, held)) best.set(key, record);
  }
  return sorted([...best.values()]);
}

/** The merged book for the Labours screen. */
export function recordBook(
  sessions: readonly Session[],
  library: readonly Exercise[],
  manual: readonly ManualRecord[],
  options: { exceptSetId?: Id } = {},
): PersonalRecord[] {
  return mergeRecords(sessionRecords(sessions, library, options), heldManual(manual, library));
}

export function recordAt(
  book: readonly PersonalRecord[],
  exerciseId: string,
  reps: number,
): PersonalRecord | null {
  return book.find((r) => r.exercise_id === exerciseId && r.reps === reps) ?? null;
}

/** Is a record recent enough to carry the laurel? */
export function isRecentRecord(
  record: PersonalRecord,
  today: IsoDate,
  days = RECENT_RECORD_DAYS,
): boolean {
  const age = daysBetween(record.date, today);
  return age >= 0 && age < days;
}

// --- the laurel ---------------------------------------------------------------

/**
 * Does this set beat the record at its rep count? `book` must not hold the set
 * itself (see `recordBook`'s `exceptSetId`), or a record could never be beaten
 * by the set that is it.
 *
 * A rep count with no record yet is not beaten: the first set an exercise ever
 * gets at some rep count would otherwise be a laurel, and a book that crowns
 * every debut says nothing about progress.
 */
export function beatsRecord(
  set: PerformedSet,
  exercise: Exercise,
  book: readonly PersonalRecord[],
): boolean {
  const kg = recordWeightKg(set, exercise);
  if (kg === null) return false;
  const held = recordAt(book, exercise.id, set.reps!);
  return held !== null && kg > round(held.weight_kg);
}

// --- when they were set --------------------------------------------------------

export interface RecordEvent {
  session_id: Id;
  date: IsoDate;
  exercise_id: string;
  exercise_instance_id: Id;
  set_id: Id;
  reps: number;
  weight_kg: number;
  /** The record it took over from. */
  previous_kg: number;
}

/**
 * Every set that was a record when it was lifted, found by replaying the
 * sessions oldest first against what stood before each one. A hand-entered
 * record counts from its own date, so a competition lift entered for last
 * spring is what a session in the summer has to beat.
 *
 * Judged as it was then, not against today's book, so a record later beaten
 * still marks the day it was set. The same rule as the laurel applies: with
 * nothing yet at that rep count there is nothing to beat.
 */
export function recordEvents(
  sessions: readonly Session[],
  library: readonly Exercise[],
  manual: readonly ManualRecord[],
): RecordEvent[] {
  const standing = new Map<string, number>();
  const pending = heldManual(manual, library)
    .filter((m) => m.reps >= 1 && m.reps <= RECORD_MAX_REPS)
    .sort((a, b) => a.date.localeCompare(b.date));
  const take = (key: string, kg: number) => {
    if (kg > (standing.get(key) ?? 0)) standing.set(key, kg);
  };

  const events: RecordEvent[] = [];
  for (const { session, instance, set, exercise } of flattenSets(sessions, library)) {
    while (pending.length > 0 && pending[0].date <= session.date) {
      const m = pending.shift()!;
      take(keyOf(m.exercise_id, m.reps), round(m.weight_kg));
    }
    const kg = recordWeightKg(set, exercise);
    if (kg === null) continue;
    const key = keyOf(exercise.id, set.reps!);
    const previous = standing.get(key);
    if (previous !== undefined && kg > previous) {
      events.push({
        session_id: session.id,
        date: session.date,
        exercise_id: exercise.id,
        exercise_instance_id: instance.id,
        set_id: set.id,
        reps: set.reps!,
        weight_kg: kg,
        previous_kg: previous,
      });
    }
    take(key, kg);
  }
  return events;
}

/**
 * The records set within one session, for the finish screen. `session` may be
 * the open one, which `sessions` need not hold yet or may hold an older copy of.
 */
export function recordsSetInSession(
  session: Session,
  sessions: readonly Session[],
  library: readonly Exercise[],
  manual: readonly ManualRecord[],
): RecordEvent[] {
  const all = [...sessions.filter((s) => s.id !== session.id), session];
  return recordEvents(all, library, manual).filter((e) => e.session_id === session.id);
}

/**
 * The dates a session-logged record was set, for the calendar's dot. A
 * hand-entered record has no session to mark, so it adds none.
 */
export function recordDays(
  sessions: readonly Session[],
  library: readonly Exercise[],
  manual: readonly ManualRecord[],
): Set<IsoDate> {
  return new Set(recordEvents(sessions, library, manual).map((e) => e.date));
}
