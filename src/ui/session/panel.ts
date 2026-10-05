import { formatInterval, type ExerciseInstance, type Id, type PerformedSet } from '../../model';
import { targetRpeOf } from '../suggest';

/**
 * What the entry panel and a set row say about a set, apart from its numbers:
 * its name, its target as a line, which row is the active one. Pure, so the
 * words are tested.
 */

/** "Set 2" among the working sets, "Warm-up 1" among the warm-ups. */
export function setLabel(instance: ExerciseInstance, set: PerformedSet): string {
  const kind = instance.performed.filter((s) => s.is_warmup === set.is_warmup);
  const n = kind.findIndex((s) => s.id === set.id) + 1;
  return set.is_warmup ? `Warm-up ${n}` : `Set ${n}`;
}

/** "5 @ 8" or "3-5 @ 7-8": what the prescription asks of this set; null where it asks nothing. */
export function targetText(instance: ExerciseInstance, set: PerformedSet): string | null {
  if (set.is_warmup) return null;
  const p = instance.prescribed.find((x) => x.id === set.prescribed_id);
  if (!p) return null;
  const reps = p.reps ? formatInterval(p.reps) : '';
  const rpe = p.rpe ? `@ ${formatInterval(p.rpe)}` : '';
  return [reps, rpe].filter(Boolean).join(' ') || null;
}

/** The RPE chip to ring: the top of the target range, which is as hard as the plan allows. */
export function ringedRpe(instance: ExerciseInstance, set: PerformedSet): number | null {
  if (set.is_warmup) return null;
  return targetRpeOf(instance.prescribed.find((x) => x.id === set.prescribed_id));
}

/**
 * The set the lifter is on: the one whose panel is open, else the first one
 * still pending. Only an unfinished session has one.
 */
export function activeSetId(
  open: boolean,
  entering: Id | null,
  firstPendingId: Id | null,
): Id | null {
  if (!open) return null;
  return entering ?? firstPendingId;
}

/** The nine RPE chips as the panel lays them out: two courses of ashlar, five over four. */
export const RPE_COURSES: readonly (readonly number[])[] = [
  [6, 6.5, 7, 7.5, 8],
  [8.5, 9, 9.5, 10],
];

/** "± 2.5 kg", or "± 5 s" for time: the size of one tap of − or +, said under the chips. */
export function stepText(measure: 'weight' | 'time', step: number, unit: string): string {
  return measure === 'time' ? '± 5 or 15 s' : `± ${step} ${unit}`;
}
