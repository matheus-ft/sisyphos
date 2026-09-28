import type { Schedule, Step } from './schedule';
import { play, type World } from './world';
import type { SimFailure } from './oracle';

/** What a shrunk schedule must still do, judged from how it played. */
export type Keeps = (played: { world: World; failure: SimFailure | null }) => boolean;

/** Still breaks this invariant. */
export const breaks =
  (invariant: string): Keeps =>
  ({ failure }) =>
    failure?.invariant === invariant;

/**
 * Shrinks a schedule to a short one that still does what `keeps` asks (breaks
 * the same invariant, usually): removes runs of steps, longest first, then
 * simplifies what is left (drops faults, drops steps from races, turns pulls
 * into syncs, has one device resolve instead of two, untwins the seeds), until
 * nothing more can go.
 */
export async function shrink(schedule: Schedule, keeps: Keeps): Promise<Schedule> {
  const still = async (candidate: Schedule) => keeps(await play(candidate));

  let current = schedule;
  for (let changed = true; changed;) {
    changed = false;
    for (let size = Math.max(1, current.steps.length >> 1); size >= 1; size >>= 1) {
      for (let i = 0; i + size <= current.steps.length;) {
        const steps = [...current.steps.slice(0, i), ...current.steps.slice(i + size)];
        if (await still({ ...current, steps })) {
          current = { ...current, steps };
          changed = true;
        } else {
          i += size;
        }
      }
    }
    for (let i = 0; i < current.steps.length; i++) {
      for (const simpler of simplifications(current.steps[i])) {
        const steps = current.steps.with(i, simpler);
        if (await still({ ...current, steps })) {
          current = { ...current, steps };
          changed = true;
          break;
        }
      }
    }
    const untwinned = current.seeds.map((_, i) => current.seeds[0] + i);
    if (untwinned.some((seed, i) => seed !== current.seeds[i])) {
      if (await still({ ...current, seeds: untwinned })) {
        current = { ...current, seeds: untwinned };
        changed = true;
      }
    }
  }
  return current;
}

function simplifications(step: Step): Step[] {
  switch (step.do) {
    case 'sync': {
      const simpler: Step[] = [];
      step.faults.forEach((fault, i) => {
        simpler.push({ ...step, faults: step.faults.filter((_, j) => j !== i) });
        if (fault.kind === 'race') {
          fault.steps.forEach((_, k) => {
            const steps = fault.steps.filter((_, j) => j !== k);
            simpler.push({ ...step, faults: step.faults.with(i, { ...fault, steps }) });
          });
        }
      });
      if (step.mode === 'pull') simpler.push({ ...step, mode: 'full' });
      return simpler;
    }
    case 'resolve':
      return step.devices.length < 2
        ? []
        : step.devices.map((device, i) => ({
            ...step,
            devices: [device],
            choices: [step.choices[i]],
          }));
    case 'clash':
      return step.deletes.some((d) => d) ? [{ ...step, deletes: [false, false] }] : [];
    default:
      return [];
  }
}
