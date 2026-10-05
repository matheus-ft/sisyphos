import type {
  BodyweightEntry,
  Exercise,
  ExerciseInstance,
  Id,
  LoadUnit,
  PerformedSet,
  Session,
} from '../../model';
import { boulderProgress } from '../finish';
import {
  MAX_REST_S,
  REST_STORAGE_KEY,
  lastDoneSetId,
  nextPendingSet,
  restClock,
  restTargetS,
  type NextSet,
  type NextSetContext,
  type RestState,
  nextSetText,
} from '../rest';
import { amountOf, editSet, formatSet, type SetEdit } from '../session';
import type { Suggestion } from '../suggest';

/**
 * What happens around saving a set: the toast and its undo, the rest it starts
 * and what the takeover is told, the boulder's readout, the suggested weight
 * put into the pending sets, the weigh-in offer. Pure; SessionView wires it.
 */

// --- what came before ---------------------------------------------------------------

/**
 * The sessions "last time" and the suggested weight look back through: those on
 * or before this session's date, so a session logged for last month is not
 * compared with what the lifter did last week.
 */
export function sessionsBefore(sessions: Session[], date: Session['date']): Session[] {
  return sessions.filter((s) => s.date <= date);
}

// --- a set just saved ---------------------------------------------------------------

export interface SavedSet {
  instance: ExerciseInstance;
  set: PerformedSet;
  /** 1-based among the exercise's working sets, or among its warm-ups when `warmup`. */
  number: number;
  warmup: boolean;
}

/**
 * The first set that is done in `after` and was not in `before`: what a save
 * just finished. Null when the edit finished nothing (a number typed, a set
 * corrected or undone).
 */
export function savedSet(before: Session, after: Session): SavedSet | null {
  const was = new Set(
    before.exercises.flatMap((e) => e.performed.filter((s) => s.state === 'done').map((s) => s.id)),
  );
  for (const instance of after.exercises) {
    for (const set of instance.performed) {
      if (set.state !== 'done' || was.has(set.id)) continue;
      const kind = instance.performed.filter((s) => s.is_warmup === set.is_warmup);
      return {
        instance,
        set,
        number: kind.findIndex((s) => s.id === set.id) + 1,
        warmup: set.is_warmup,
      };
    }
  }
  return null;
}

/** "Set 2 saved" and its figures, "92.5 × 5 @ 8": the undo toast's words. */
export function savedToast(
  saved: SavedSet,
  exercise: Exercise | undefined,
): { message: string; strong: string } {
  return {
    message: `${saved.warmup ? 'Warm-up' : 'Set'} ${saved.number} saved`,
    strong: formatSet(saved.set, exercise),
  };
}

/** The session with one set put back as it was: an undo that leaves later edits alone. */
export function restoreSet(session: Session, instanceId: Id, before: PerformedSet): Session {
  return {
    ...session,
    exercises: session.exercises.map((e) =>
      e.id === instanceId
        ? { ...e, performed: e.performed.map((s) => (s.id === before.id ? before : s)) }
        : e,
    ),
  };
}

/**
 * The undo of a set saved a moment ago, put into the session as it is now. The
 * toast outlives the screen it came from, so the session is looked up by id
 * among those held now (the lifter may have gone back to Train), and the undo
 * is nothing once the session is gone.
 */
export function undoSet(
  sessions: Session[],
  sessionId: Id,
  instanceId: Id,
  before: PerformedSet,
): Session | null {
  const now = sessions.find((s) => s.id === sessionId);
  return now ? restoreSet(now, instanceId, before) : null;
}

// --- the rest it starts -------------------------------------------------------------

/** Kept for the tab, per session, so a reload between sets keeps counting. */
export const restKey = (sessionId: Id) => `${REST_STORAGE_KEY}.${sessionId}`;

/** The target rest of an exercise now: its own, else its tier's (an unknown exercise rests like a low-spec one). */
export function targetOf(instance: ExerciseInstance, exercise: Exercise | undefined): number {
  return restTargetS(exercise?.tier ?? 'low_spec', instance.rest_s);
}

/**
 * Whether saving this set starts a rest: a working set with no later working
 * set of its exercise done yet, so the latest one lifted. Giving an earlier set
 * its missing RPE while a later one's rest runs is a correction, not a lift, and
 * leaves that rest running as it was.
 */
export function startsRest(saved: SavedSet): boolean {
  if (saved.warmup) return false;
  const sets = saved.instance.performed;
  const at = sets.findIndex((s) => s.id === saved.set.id);
  return !sets.slice(at + 1).some((s) => s.state === 'done' && !s.is_warmup);
}

export function restStarted(
  saved: SavedSet,
  exercise: Exercise | undefined,
  now: number,
): RestState {
  return {
    startedAt: now,
    instanceId: saved.instance.id,
    setId: saved.set.id,
    targetS: targetOf(saved.instance, exercise),
  };
}

/**
 * A rest worth keeping on screen: one kept past the longest target there is
 * (a session left open overnight, a tab restored days later) would only show a
 * count of hours, so it is dropped.
 */
export function restFresh(state: RestState, now: number): boolean {
  return now - state.startedAt <= MAX_REST_S * 1000;
}

/**
 * The set that comes after the one the rest follows. A rest whose set has since
 * been undone or removed follows the exercise's last done working set instead,
 * so "next" never points at a set that is gone.
 */
export function restNextSet(session: Session, state: RestState): NextSet | null {
  const exists = (id: Id) => session.exercises.some((e) => e.performed.some((s) => s.id === id));
  const after =
    state.setId && exists(state.setId) ? state.setId : lastDoneSetId(session, state.instanceId);
  return after ? nextPendingSet(session, after) : null;
}

/** "Bench press · set 2 of 4 done": what the takeover says the rest follows. */
export function restContext(instance: ExerciseInstance, name: string): string {
  const working = instance.performed.filter((s) => !s.is_warmup && s.state !== 'skipped');
  const done = working.filter((s) => s.state === 'done').length;
  return `${name} · set ${done} of ${working.length} done`;
}

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export interface RestReadout {
  /** "1:13", or "+0:12" once over. */
  text: string;
  /** "3:00". */
  of: string;
  over: boolean;
  /** How much of the target has passed, 0 to 1. */
  fraction: number;
}

export function restReadout(startedAt: number, targetS: number, now: number): RestReadout {
  const c = restClock(startedAt, targetS, now);
  return {
    text: c.over ? `+${clock(c.overtimeS)}` : clock(c.remainingS),
    of: clock(targetS),
    over: c.over,
    fraction: c.fraction,
  };
}

/** The takeover's "next set" card, from `nextSetText`'s one line: "Bench press · set 4 · 92.5 × 5 @ 8". */
export function restNext(
  next: NextSet | null,
  exercise: Exercise | undefined,
  ctx: NextSetContext,
): { label: string; figures: string; exercise: string } | null {
  if (!next) return null;
  const name = exercise?.name ?? next.instance.exercise_id;
  const text = nextSetText(
    next,
    exercise ?? { ...UNKNOWN, id: next.instance.exercise_id, name },
    ctx,
  );
  const [label, ...figures] = text.slice(name.length + 3).split(' · ');
  return {
    label: label.charAt(0).toUpperCase() + label.slice(1),
    figures: figures.join(' · ') || '—',
    exercise: name,
  };
}

const UNKNOWN: Omit<Exercise, 'id' | 'name'> = {
  base_lift: null,
  tier: 'low_spec',
  unilateral: false,
  load_type: 'external',
  default_unit: 'kg',
  muscles: { primary: [], aux: [] },
};

// --- the boulder --------------------------------------------------------------------

export interface Climb {
  fraction: number;
  done: number;
  /** The sets the readout counts against: never fewer than are done. */
  of: number;
}

/**
 * The boulder's place and the header's "9 of 15". A finished session is at the
 * top, and a target never reads below what is done ("16 of 15" would be wrong
 * the moment the lifter adds a set).
 */
export function climb(session: Session, others: Session[]): Climb {
  const b = boulderProgress(session, others, { finished: session.ended_at !== null });
  return { fraction: b.fraction, done: b.done, of: Math.max(b.target, b.done) };
}

// --- the suggested weight -----------------------------------------------------------

/** Whether the chip has something to say: a pending working set that does not hold that load yet. */
export function suggestionShows(instance: ExerciseInstance, s: Suggestion | null): boolean {
  if (!s) return false;
  return instance.performed.some(
    (x) => x.state === 'pending' && !x.is_warmup && amountOf(x) !== s.load,
  );
}

/** The suggested weight written into every pending working set of an exercise; reps and RPE stay as they were. */
export function applySuggestion(session: Session, instanceId: Id, s: Suggestion): Session {
  const instance = session.exercises.find((e) => e.id === instanceId);
  if (!instance) return session;
  const edit: SetEdit = { amount: s.load, unit: s.unit };
  return instance.performed
    .filter((x) => x.state === 'pending' && !x.is_warmup)
    .reduce((next, x) => editSet(next, instanceId, x.id, edit, 'weight', s.unit), session);
}

// --- units picked for the session ---------------------------------------------------

/**
 * The unit the lifter last picked for each exercise in a session, by exercise
 * id. An empty set holds no load to carry a unit, so the pick is kept here, in
 * the tab's sessionStorage beside the rest, until a number typed in that unit
 * puts it into the log.
 */
export const unitsKey = (sessionId: Id) => `sisyphos.units.${sessionId}`;

const UNITS: readonly LoadUnit[] = ['kg', 'lb', 'pins'];

/** The picks kept for a session; junk, and anything that is not a unit, reads as none. */
export function parseUnits(text: string | null | undefined): Map<string, LoadUnit> {
  if (!text) return new Map();
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return new Map();
    return new Map(
      Object.entries(raw).filter((e): e is [string, LoadUnit] => UNITS.includes(e[1])),
    );
  } catch {
    return new Map();
  }
}

export function serializeUnits(units: ReadonlyMap<string, LoadUnit>): string {
  return JSON.stringify(Object.fromEntries(units));
}

// --- the weigh-in -------------------------------------------------------------------

/**
 * The weigh-in to offer saving: the bodyweight typed into the session when no
 * weigh-in is on record for that date, so the lifter's trend gets it with one
 * tap instead of typing it twice.
 */
export function weighInOffer(
  session: Session,
  bodyweights: BodyweightEntry[],
): BodyweightEntry | null {
  if (session.bodyweight_kg === null) return null;
  if (bodyweights.some((b) => b.date === session.date)) return null;
  return { date: session.date, weight_kg: session.bodyweight_kg, source: 'manual' };
}
