import type { Exercise, Id, LoadPrescription, PrescribedSet, Template } from '../model';
import { measureOf } from './session';

/**
 * What the template screen does to a template, as pure functions, like
 * `session.ts` for sessions. A target is one planned set: a load in kilograms
 * (or a time), reps and an RPE, each exact. Ranges wait for v0.5.
 */

export type Target = Omit<PrescribedSet, 'id'>;

export function newTemplate(input: { id: Id; name: string; at: Date }): Template {
  const now = input.at.toISOString();
  return {
    id: input.id,
    name: input.name,
    intention: null,
    exercises: [],
    created_at: now,
    updated_at: now,
  };
}

function emptyTarget(measure: 'weight' | 'time'): Target {
  const load: LoadPrescription =
    measure === 'time'
      ? { kind: 'time', seconds: [null, null] }
      : { kind: 'weight', weight: { mode: 'rpe_driven' } };
  return { reps: null, rpe: null, load, is_warmup: false, notes: null };
}

export function rename(template: Template, name: string): Template {
  return { ...template, name };
}

export function addTemplateExercise(template: Template, exercise: Exercise): Template {
  const entry = { exercise_id: exercise.id, prescribed: [emptyTarget(measureOf(exercise))] };
  return { ...template, exercises: [...template.exercises, entry] };
}

export function removeTemplateExercise(template: Template, index: number): Template {
  return { ...template, exercises: template.exercises.filter((_, i) => i !== index) };
}

function updateTargets(
  template: Template,
  index: number,
  update: (targets: Target[]) => Target[],
): Template {
  return {
    ...template,
    exercises: template.exercises.map((e, i) =>
      i === index ? { ...e, prescribed: update(e.prescribed) } : e,
    ),
  };
}

/** A new target copying the last: a plan usually repeats a set. */
export function addTarget(template: Template, index: number, measure: 'weight' | 'time'): Template {
  return updateTargets(template, index, (targets) => [
    ...targets,
    targets.at(-1) ?? emptyTarget(measure),
  ]);
}

export function removeTarget(template: Template, index: number, target: number): Template {
  return updateTargets(template, index, (targets) => targets.filter((_, i) => i !== target));
}

export interface TargetEdit {
  /** Kilograms, or seconds for timed work. Null clears it. */
  amount?: number | null;
  reps?: number | null;
  rpe?: number | null;
}

const exactly = (n: number | null): [number, number] | null => (n === null ? null : [n, n]);

export function editTarget(
  template: Template,
  index: number,
  target: number,
  edit: TargetEdit,
  measure: 'weight' | 'time',
): Template {
  return updateTargets(template, index, (targets) =>
    targets.map((t, i) => {
      if (i !== target) return t;
      const next: Target = { ...t };
      if (edit.reps !== undefined) next.reps = measure === 'time' ? null : exactly(edit.reps);
      if (edit.rpe !== undefined) next.rpe = exactly(edit.rpe);
      if (edit.amount !== undefined) {
        const amount = edit.amount;
        if (measure === 'time') next.load = { kind: 'time', seconds: [amount, amount] };
        // Without a load the set is planned by feel: the RPE decides it.
        else if (amount === null) next.load = { kind: 'weight', weight: { mode: 'rpe_driven' } };
        else next.load = { kind: 'weight', weight: { mode: 'absolute', kg: [amount, amount] } };
      }
      return next;
    }),
  );
}

/** The number a target's load holds: kilograms, or seconds. */
export function targetAmount(target: Target): number | null {
  if (target.load.kind === 'time') return target.load.seconds[0];
  if (target.load.kind === 'weight' && target.load.weight.mode === 'absolute') {
    return target.load.weight.kg[0];
  }
  return null;
}
