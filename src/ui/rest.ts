import {
  formatInterval,
  type Exercise,
  type ExerciseInstance,
  type Id,
  type IsoDate,
  type LoadUnit,
  type OneRmEntry,
  type PerformedSet,
  type Session,
  type Tier,
} from '../model';
import { formatSet } from './session';
import { resolveLoad, type Suggestion } from './suggest';

/**
 * The rest between sets. The app may be locked or suspended mid-rest, so
 * nothing counts ticks: every number is a function of when the rest started and
 * what time it is now, and a screen that wakes up late shows the right time.
 */

/** Seconds to rest by tier when the exercise sets none. */
export const REST_BY_TIER: Record<Tier, number> = {
  comp: 180,
  high_spec: 150,
  low_spec: 120,
  acc: 90,
};

export const REST_STEP_S = 15;
/** Below this a rest is not one; above this a stored one is junk (a stale or hand-edited value). */
export const MIN_REST_S = 15;
export const MAX_REST_S = 3600;

/** The exercise's own target rest if it has one, else its tier's. */
export function restTargetS(tier: Tier, restS?: number | null): number {
  return typeof restS === 'number' && Number.isFinite(restS) && restS >= MIN_REST_S
    ? Math.min(restS, MAX_REST_S)
    : REST_BY_TIER[tier];
}

export interface RestClock {
  /** Whole seconds left, rounded up so the screen reads 0:01 until it really is over. */
  remainingS: number;
  /** Whole seconds past the target, once over. */
  overtimeS: number;
  over: boolean;
  /** How much of the target has passed, 0 to 1. */
  fraction: number;
}

/** The rest as it stands at `now`; both are epoch milliseconds. */
export function restClock(startedAt: number, targetS: number, now: number): RestClock {
  // A clock set back since the start reads as a rest not yet begun, not a negative one.
  const elapsedMs = Math.max(0, now - startedAt);
  const targetMs = targetS * 1000;
  const over = elapsedMs >= targetMs;
  return {
    remainingS: over ? 0 : Math.ceil((targetMs - elapsedMs) / 1000),
    overtimeS: over ? Math.floor((elapsedMs - targetMs) / 1000) : 0,
    over,
    fraction: targetMs > 0 ? Math.min(1, elapsedMs / targetMs) : 1,
  };
}

/** The target moved by `deltaS`, never below the floor or above the ceiling. */
export function adjustRest(targetS: number, deltaS: number): number {
  return Math.min(MAX_REST_S, Math.max(MIN_REST_S, targetS + deltaS));
}

// --- surviving a reload -----------------------------------------------------------

/** The rest in progress. It is not saved to the log, only to the tab's sessionStorage. */
export interface RestState {
  /** Epoch milliseconds. */
  startedAt: number;
  /** The exercise instance the rest follows, so the next-set text can find its place. */
  instanceId: Id;
  /**
   * The set just saved, so the next set is the one after it. Optional: without
   * it (a reload from a version that did not keep it) `lastDoneSetId` finds it.
   */
  setId?: Id;
  targetS: number;
}

export const REST_STORAGE_KEY = 'sisyphos.rest';

export function serializeRest(state: RestState): string {
  return JSON.stringify({
    startedAt: state.startedAt,
    instanceId: state.instanceId,
    targetS: state.targetS,
    ...(state.setId ? { setId: state.setId } : {}),
  });
}

/**
 * A stored rest, or null for anything else: sessionStorage can hold what an
 * older version wrote, or nothing sensible at all, and the app starts without a
 * rest rather than failing on one.
 */
export function parseRest(text: string | null | undefined): RestState | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const { startedAt, instanceId, setId, targetS } = r;
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt) || startedAt <= 0) return null;
  if (typeof instanceId !== 'string' || instanceId === '') return null;
  if (setId !== undefined && (typeof setId !== 'string' || setId === '')) return null;
  if (typeof targetS !== 'number' || !Number.isFinite(targetS)) return null;
  if (targetS < MIN_REST_S || targetS > MAX_REST_S) return null;
  return { startedAt, instanceId, targetS, ...(setId === undefined ? {} : { setId }) };
}

// --- what comes next --------------------------------------------------------------

export interface NextSet {
  instance: ExerciseInstance;
  set: PerformedSet;
  /** 1-based among the instance's working sets, or among its warm-ups when `warmup`. */
  number: number;
  warmup: boolean;
}

/** The last done working set of an exercise: the one a rest with no recorded set follows. */
export function lastDoneSetId(session: Session, instanceId: Id): Id | null {
  const instance = session.exercises.find((e) => e.id === instanceId);
  const done = instance?.performed.filter((s) => s.state === 'done' && !s.is_warmup);
  return done?.at(-1)?.id ?? null;
}

/**
 * The next set waiting to be lifted after `afterSetId`: the first pending set
 * later in the session, in exercise order and then set order, so the rest after
 * an exercise's last set shows the next exercise's first. Skipped and done sets
 * are passed over. Null when nothing is left, which is when Finish is next.
 */
export function nextPendingSet(session: Session, afterSetId: Id): NextSet | null {
  const flat = session.exercises.flatMap((instance) =>
    instance.performed.map((set) => ({ instance, set })),
  );
  const from = flat.findIndex((x) => x.set.id === afterSetId);
  if (from < 0) return null;
  const found = flat.slice(from + 1).find((x) => x.set.state === 'pending');
  if (!found) return null;
  const { instance, set } = found;
  const same = instance.performed.filter((s) => s.is_warmup === set.is_warmup);
  return {
    instance,
    set,
    number: same.findIndex((s) => s.id === set.id) + 1,
    warmup: set.is_warmup,
  };
}

export interface NextSetContext {
  date: IsoDate;
  oneRms: OneRmEntry[];
  unit: LoadUnit;
  step: number;
  /** Shown for the load when the set and its prescription name none. */
  suggestion?: Suggestion | null;
}

/**
 * "Bench Press · set 4 · 92.5 × 5 @ 8": what the set holds, else what its
 * prescription asks, else the suggested weight. RPE is only ever a target
 * here, since a pending set has none of its own.
 */
export function nextSetText(next: NextSet, exercise: Exercise, ctx: NextSetContext): string {
  const { instance, set } = next;
  const p = instance.prescribed.find((x) => x.id === set.prescribed_id);

  let load = set.load;
  if (!load) {
    const resolved = resolveLoad(p?.load, ctx);
    if (resolved.kind === 'weight')
      load = { kind: 'weight', value: resolved.value, unit: resolved.unit };
    else if (resolved.kind === 'time') load = { kind: 'time', seconds: resolved.seconds };
    else if (ctx.suggestion) {
      load = { kind: 'weight', value: ctx.suggestion.load, unit: ctx.suggestion.unit };
    }
  }
  const loadText = load ? formatSet({ ...set, load, reps: null, rpe: null }, exercise) : '';
  const reps = set.reps !== null ? String(set.reps) : p?.reps ? formatInterval(p.reps) : '';
  const rpe = !next.warmup && p?.rpe ? formatInterval(p.rpe) : '';

  let numbers = loadText;
  if (reps) numbers += `${numbers ? ' × ' : ''}${reps}`;
  if (rpe) numbers += ` @ ${rpe}`;

  const label = `${next.warmup ? 'warm-up' : 'set'} ${next.number}`;
  return [exercise.name, label, numbers].filter((part) => part !== '').join(' · ');
}
