import type { Exercise, ExerciseInstance, Id, Session } from '../../model';
import { targetAmount, type EntryContext } from '../entry';
import { amountOf, unitOf, type NewId } from '../session';
import { insertWarmups, warmupLadder, warmupSets, type WarmupRung } from '../warmup';

/**
 * The warm-up suggestion an exercise card offers above its set rows: the rungs
 * toward the first working weight that are not already there. Nothing is saved
 * until the lifter adds a rung, and a rung hidden stays hidden for the session.
 */

export interface WarmupPlan {
  /** The first working weight the ladder climbs toward. */
  working: number;
  unit: 'kg' | 'lb';
  step: number;
  /** The rungs still to add, lightest first. */
  rungs: WarmupRung[];
}

/**
 * The plan for an exercise, or null when it should offer none: it is not
 * loaded with plates (bodyweight and timed work warm up their own way), no
 * working weight is known, a working set is already done (the warm-up is behind
 * the lifter), or every rung is already in the list.
 *
 * The working weight is the first working set's own load, else what its
 * prescription resolves to, else the suggested weight: the same order the
 * entry panel starts from.
 */
export function warmupPlan(input: {
  instance: ExerciseInstance;
  exercise: Exercise | undefined;
  ctx: EntryContext;
}): WarmupPlan | null {
  const { instance, exercise, ctx } = input;
  if (!exercise || exercise.load_type !== 'external') return null;
  if (instance.performed.some((s) => s.state === 'done' && !s.is_warmup)) return null;
  const first = instance.performed.find((s) => !s.is_warmup && s.state === 'pending');
  if (!first) return null;
  const unit = unitOf(first) ?? ctx.unit;
  if (unit === 'pins') return null;
  const working = amountOf(first) ?? targetAmount(instance, first, ctx) ?? ctx.suggestion?.load;
  if (working === undefined || working === null || !(working > 0)) return null;

  const have = new Set(
    instance.performed
      .filter((s) => s.is_warmup && unitOf(s) === unit)
      .map((s) => amountOf(s))
      .filter((n): n is number => n !== null),
  );
  const rungs = warmupLadder(working, unit, ctx.step).filter((r) => !have.has(r.load));
  return rungs.length ? { working, unit, step: ctx.step, rungs } : null;
}

/** Adds the given rungs of a plan as pending warm-ups just ahead of the first working set. */
export function addWarmups(
  session: Session,
  instanceId: Id,
  plan: WarmupPlan,
  rungs: WarmupRung[],
  newId: NewId,
): Session {
  const wanted = new Set(rungs.map((r) => r.load));
  const sets = warmupSets(plan.working, plan.unit, plan.step, newId).filter(
    (s) => s.load?.kind === 'weight' && wanted.has(s.load.value),
  );
  return insertWarmups(session, instanceId, sets);
}

// --- hidden for the session ---------------------------------------------------------

/** Where a session's hidden suggestions are kept: the tab's sessionStorage, never the log. */
export const hiddenKey = (sessionId: Id) => `sisyphos.warmups.${sessionId}`;

/** The exercises whose suggestion the lifter hid; junk reads as none. */
export function parseHidden(text: string | null | undefined): Set<Id> {
  if (!text) return new Set();
  try {
    const raw: unknown = JSON.parse(text);
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function serializeHidden(hidden: ReadonlySet<Id>): string {
  return JSON.stringify([...hidden]);
}
