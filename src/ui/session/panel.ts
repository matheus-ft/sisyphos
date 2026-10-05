import {
  formatInterval,
  type ExerciseInstance,
  type Id,
  type LoadUnit,
  type PerformedSet,
} from '../../model';
import { formatSeconds } from '../session';
import { targetRpeOf, type Suggestion } from '../suggest';

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

/**
 * How the panel saves a set. A working set is saved by the RPE it felt like and
 * a warm-up by Done; but a set of a session not started yet has not been
 * lifted, so it takes a plain Save of its numbers and its RPE waits for the gym.
 */
export function panelSave(set: PerformedSet, planning: boolean): 'save' | 'done' | 'rpe' {
  if (planning) return 'save';
  return set.is_warmup ? 'done' : 'rpe';
}

/** The nine RPE chips as the panel lays them out: two courses of ashlar, five over four. */
export const RPE_COURSES: readonly (readonly number[])[] = [
  [6, 6.5, 7, 7.5, 8],
  [8.5, 9, 9.5, 10],
];

/** Where the panel's unit switch goes: kg and lb trade places; a pin setting has no other. */
export function otherUnit(unit: LoadUnit): LoadUnit | null {
  if (unit === 'kg') return 'lb';
  return unit === 'lb' ? 'kg' : null;
}

/** "± 2.5 kg", or "± 5 s" for time: the size of one tap of − or +, said under the chips. */
export function stepText(measure: 'weight' | 'time', step: number, unit: string): string {
  return measure === 'time' ? '± 5 or 15 s' : `± ${step} ${unit}`;
}

/**
 * The panel's figure as the rows write it: a load as a number, a time past a
 * minute as "1:30" (the steppers would otherwise climb in bare seconds, 75, 90),
 * and the unit beside it to match.
 */
export function panelFigure(
  measure: 'weight' | 'time',
  n: number,
  unit: string,
): { text: string; unit: string } {
  if (measure === 'weight') return { text: String(Math.round(n * 100) / 100), unit };
  return { text: formatSeconds(n).replace(' s', ''), unit: n >= 60 ? 'min' : 's' };
}

/**
 * "92.5 kg · +2.5: last @7.5 for a target of 8": the panel's suggestion with
 * the weight said, since the steppers may hold the set's target instead.
 */
export function suggestionLine(
  s: Pick<Suggestion, 'load' | 'unit' | 'reason'> | null,
): string | null {
  return s ? `${s.load} ${s.unit} · ${s.reason}` : null;
}
