import type { Id, Instant, Interval, IsoDate, LoadUnit } from './primitives';
import type { CompetitionLift } from './taxonomy';

/**
 * Everything recorded about your training: sessions and the sets inside them,
 * the templates they start from, and the facts that outlive any one session —
 * reference maxes, records, bodyweight.
 *
 * Two rules hold throughout. Prescribed values are intervals and realized values
 * are scalars. Nothing is stored twice — order comes from array position, units
 * travel with the value they measure, and absent means absent.
 */

/**
 * Set lifecycle, and the single source of truth for whether a set counts.
 *
 *   pending   prescribed, not performed yet. Counts toward nothing. The session
 *             shows as needing input while any set is here
 *   done      performed and complete. Counts, subject to each metric's warm-up
 *             rule. `isComplete` below defines what "complete" requires
 *   skipped   deliberately not performed. Counts toward nothing, and is visible
 *             as a deviation from the prescription
 *
 * There is no separate null policy anywhere in the config, on purpose. A metric
 * asks the state; a set with no RPE simply is not `done`, so the two can never
 * disagree about the same set.
 */
export type SetState = 'pending' | 'done' | 'skipped';

// --- prescription -----------------------------------------------------------

/**
 * Stored exactly as prescribed. A 80%-of-1RM prescription stores 0.80, not the
 * resolved kilograms — the 1RM in force on the session date resolves it for
 * display, so raising your 1RM never rewrites what a past session asked for.
 */
export type WeightPrescription =
  | { mode: 'absolute'; kg: Interval }
  | { mode: 'pct_1rm'; pct: Interval; lift: CompetitionLift }
  | { mode: 'rpe_driven' }
  | { mode: 'bw_plus'; added_kg: Interval };

/**
 * What the set prescribes. Exactly one shape applies, so a timed plank carries
 * no weight prescription and a squat carries no distance.
 */
export type LoadPrescription =
  | { kind: 'weight'; weight: WeightPrescription }
  | { kind: 'time'; seconds: Interval }
  | { kind: 'distance'; meters: Interval };

export interface PrescribedSet {
  id: Id;
  /** Null for time and distance work, which has no rep count. */
  reps: Interval | null;
  rpe: Interval | null;
  load: LoadPrescription;
  is_warmup: boolean;
  notes: string | null;
}

// --- what actually happened -------------------------------------------------

/**
 * What was loaded onto the set. A discriminated union rather than a row of
 * mostly null columns: the unit exists only where a weight does, so there is no
 * such thing as a timed set measured in kilos.
 */
export type Load =
  | { kind: 'weight'; value: number; unit: LoadUnit }
  | { kind: 'time'; seconds: number }
  | { kind: 'distance'; meters: number };

export interface PerformedSet {
  id: Id;
  /** The prescribed set this fulfils. Null for unplanned work. */
  prescribed_id: Id | null;
  state: SetState;
  /** Null for time and distance work, and while `state` is `pending`. */
  reps: number | null;
  /** Null only for warm-ups and `pending` sets. Every working set carries an RPE. */
  rpe: number | null;
  /** Null while `pending` or when `skipped`. */
  load: Load | null;
  is_warmup: boolean;
  notes: string | null;
}

/**
 * What `state: 'done'` requires, so the state cannot lie.
 *
 * A rep-based set needs reps and a load. It also needs an RPE unless it was a
 * warm-up — that rule is why nothing else in the codebase has to ask what a
 * missing RPE means. Time and distance sets carry their measurement instead of
 * reps.
 *
 * Call this before promoting a set to `done`; anything failing it stays
 * `pending`, which is the honest description of a half-entered row.
 */
export function isComplete(set: PerformedSet): boolean {
  if (set.load === null) return false;

  if (set.load.kind === 'weight') {
    if (set.reps === null || set.reps <= 0) return false;
    return set.is_warmup || set.rpe !== null;
  }

  // Time and distance work is measured by its own quantity; reps do not apply.
  const measured = set.load.kind === 'time' ? set.load.seconds : set.load.meters;
  return measured > 0;
}

/**
 * One exercise within a session, with its prescribed and performed sets.
 * Position comes from this object's index in `Session.exercises` — there is
 * deliberately no `order` field, because a stored index can drift out of
 * agreement with the array that holds it.
 */
export interface ExerciseInstance {
  id: Id;
  exercise_id: string;
  prescribed: PrescribedSet[];
  performed: PerformedSet[];
  notes: string | null;
}

// --- sessions ---------------------------------------------------------------

/**
 * Copied from whatever prescription source started the session. Purely
 * descriptive: analysis NEVER groups by these. They exist so the UI can offer a
 * fast way to select a date range. A block is the date bounds of the sessions
 * carrying a label, and everything inside those bounds belongs to it.
 */
export interface ProgramLabel {
  /** The program's own name, e.g. "Off-season 2026". */
  name: string | null;
  block: number | null;
  week: number | null;
  /** Ordinal day within the week as programmed. */
  day: number | null;
  /** Calendar weekday as programmed, e.g. "wednesday". */
  weekday: string | null;
}

export interface Session {
  id: Id;
  /**
   * The aggregation key for everything. Derived from `started_at` in `tz` but
   * stored explicitly, so moving a session to another date is one edit.
   */
  date: IsoDate;
  started_at: Instant;
  /** IANA zone, e.g. "Europe/Lisbon". Never a fixed offset — offsets break across DST. */
  tz: string;
  /**
   * `date_only` means entered after the fact with no clock time. Such sessions
   * are excluded from time-of-day and elapsed-hours analysis by construction,
   * rather than polluting it with a fake midnight.
   */
  time_precision: 'instant' | 'date_only';
  /** Null while the session is still open. Duration derives from this. */
  ended_at: Instant | null;
  label: ProgramLabel;
  /** Entered when a bw_plus exercise needs it. Never pre-filled. */
  bodyweight_kg: number | null;
  notes: string | null;
  exercises: ExerciseInstance[];
  created_at: Instant;
  updated_at: Instant;
  /** Last device to write. Used for conflict reporting, never for resolution. */
  device_id: string;
}

/** A reusable, undated skeleton. Set order is array order here too. */
export interface Template {
  id: Id;
  name: string;
  intention: string | null;
  exercises: Array<{
    exercise_id: string;
    prescribed: Omit<PrescribedSet, 'id'>[];
  }>;
  created_at: Instant;
  updated_at: Instant;
}

// --- what is true of the lifter rather than of any one session ---

/**
 * The reference max that resolves percentage prescriptions. Effective-dated: a
 * percentage on a past session resolves against the entry in force on that date.
 * Always set by hand — the app suggests from e1RM and records but never writes
 * this itself, because one fluke grindy single should not rewrite your
 * programming.
 */
export interface OneRmEntry {
  date: IsoDate;
  lift: CompetitionLift;
  weight_kg: number;
  note: string | null;
}

/**
 * Your best weight at a rep count, from either of the two places a record can
 * come from. The record book shows both together and picks whichever is heavier
 * at each rep count.
 *
 * `session` records are DERIVED — recomputed by scanning sessions, exactly like
 * tonnage and e1RM, because a stored record is a derived value that can fall out
 * of agreement with the set that produced it. They point at that set rather than
 * copying it, so the UI can open the session and show the sets around it.
 *
 * `manual` records are STORED, because nothing can derive them: a competition
 * lift, or anything you did before this app existed. Entering your current
 * records on day one is exactly what these are for, and no recompute will ever
 * touch them.
 */
export type PersonalRecord = SessionRecord | ManualRecord;

export interface SessionRecord {
  source: 'session';
  exercise_id: string;
  /** 1 through RECORD_MAX_REPS. */
  reps: number;
  weight_kg: number;
  date: IsoDate;
  rpe: number;
  session_id: Id;
  exercise_instance_id: Id;
  set_id: Id;
}

export interface ManualRecord {
  source: 'manual';
  id: Id;
  exercise_id: string;
  reps: number;
  weight_kg: number;
  date: IsoDate;
  /** Optional: a lift from 2019 may have no RPE attached to it. */
  rpe: number | null;
  /** Where it happened, e.g. "Nationals 2026" — the reason it has no session. */
  context: string | null;
}

export interface BodyweightEntry {
  date: IsoDate;
  weight_kg: number;
  source: 'manual' | 'import';
}
