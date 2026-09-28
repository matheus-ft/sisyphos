import type { Mode } from '../../src/storage/decide';
import type { ConflictChoice } from '../../src/storage/log';
import { prng } from '../sync-harness';

/**
 * A schedule for the simulation: how many devices, the seeds of their random
 * (which draws conflict ids), and a sequence of steps.
 *
 * Every choice a step makes is a small number resolved against the device when
 * the step runs ("the `pick`th session it holds, wrapping round"), and a step
 * with nothing to act on does nothing. Any subsequence of a schedule therefore
 * still runs, which is what lets a failing one shrink.
 */

export type Kind = 'session' | 'template' | 'bodyweight' | 'oneRm' | 'manualRecords' | 'additions';

export const KINDS: readonly Kind[] = [
  'session',
  'template',
  'bodyweight',
  'oneRm',
  'manualRecords',
  'additions',
];

/**
 * A lifter's change. `create` makes a new session or template, or puts a table
 * row with a key from a small pool, so devices often log the same key; `edit`
 * and `delete` act on a record the device holds.
 */
export interface Write {
  op: 'create' | 'edit' | 'delete';
  kind: Kind;
  pick: number;
}

export type Fault =
  /** The `at`th remote request of the sync fails: no connection. */
  | { kind: 'offline'; at: number }
  /** The device dies at the `at`th remote request, before it is sent. */
  | { kind: 'kill'; at: number }
  /** The `at`th remote request is carried out, and the device dies before the answer arrives. */
  | { kind: 'lose'; at: number }
  /** The device dies at the sync's `at`th write to its store. */
  | { kind: 'crash'; at: number }
  /** The device dies after the branch moved, before settling (4.5). */
  | { kind: 'settle' }
  /** Before the `at`th remote request, these run to completion: another device syncs, a lifter writes. */
  | { kind: 'race'; at: number; steps: Step[] }
  /** Another client commits a file of its own just before the branch moves. */
  | { kind: 'busy' };

export type Step =
  | { do: 'write'; device: number; write: Write }
  /** Two devices change the same record, each without having seen the other's change. */
  | { do: 'clash'; devices: [number, number]; pick: number; deletes: [boolean, boolean] }
  /** Devices resolve the same conflict record, one after the other, before syncing. */
  | { do: 'resolve'; devices: number[]; pick: number; choices: ConflictChoice[] }
  | { do: 'sync'; device: number; mode: Mode; faults: Fault[] }
  /** Killed while idle, and relaunched. */
  | { do: 'restart'; device: number }
  /**
   * The lifter changes the log on github.com: a record's version, a deletion, or
   * the same record written in another form (`hand`: not the app's form, 1.4).
   */
  | { do: 'web'; op: 'edit' | 'reformat' | 'delete'; pick: number; hand: boolean };

export interface Schedule {
  /** Two or three. */
  devices: number;
  /** One per device. Devices with the same seed draw the same conflict ids. */
  seeds: number[];
  steps: Step[];
}

export function generate(seed: number): Schedule {
  const random = prng(seed);
  const int = (n: number) => Math.floor(random() * n);
  const chance = (p: number) => random() < p;
  const oneOf = <T>(items: readonly T[]): T => items[int(items.length)];

  const devices = chance(0.5) ? 2 : 3;
  const seeds = Array.from({ length: devices }, (_, i) => seed * 8 + i);
  // Twins draw the same conflict ids, so a conflict record can land on another's id.
  if (chance(0.1)) seeds[1] = seeds[0];

  const other = (device: number) => (device + 1 + int(devices - 1)) % devices;

  const write = (): Write => {
    const r = random();
    const op = r < 0.45 ? 'create' : r < 0.8 ? 'edit' : 'delete';
    const kind = oneOf<Kind>([
      'session',
      'session',
      'template',
      'bodyweight',
      'bodyweight',
      'oneRm',
      'manualRecords',
      'additions',
    ]);
    return { op, kind, pick: int(12) };
  };

  const web = (): Step => {
    const r = random();
    const op = r < 0.5 ? 'edit' : r < 0.75 ? 'reformat' : 'delete';
    return { do: 'web', op, pick: int(12), hand: chance(0.5) };
  };

  const fault = (device: number): Fault => {
    switch (int(8)) {
      case 0:
        return { kind: 'offline', at: 1 + int(8) };
      case 1:
        return { kind: 'kill', at: 1 + int(8) };
      case 2:
        return { kind: 'lose', at: 1 + int(8) };
      case 3:
        return { kind: 'crash', at: 1 + int(4) };
      case 4:
        return { kind: 'settle' };
      case 5:
        return { kind: 'busy' };
      default: {
        const steps: Step[] = [];
        for (let i = 0, n = 1 + int(2); i < n; i++) {
          const r = random();
          steps.push(
            r < 0.45
              ? {
                  do: 'sync',
                  device: other(device),
                  mode: chance(0.2) ? 'pull' : 'full',
                  faults: [],
                }
              : r < 0.85
                ? { do: 'write', device: chance(0.5) ? device : other(device), write: write() }
                : web(),
          );
        }
        return { kind: 'race', at: 1 + int(8), steps };
      }
    }
  };

  const step = (): Step => {
    const r = random();
    const device = int(devices);
    if (r < 0.34) return { do: 'write', device, write: write() };
    if (r < 0.48) {
      return {
        do: 'clash',
        devices: [device, other(device)],
        pick: int(12),
        deletes: [chance(0.2), chance(0.2)],
      };
    }
    if (r < 0.6) {
      const both = chance(0.3);
      const choice = (): ConflictChoice => (chance(0.5) ? 'keep_log' : 'use_saved');
      return {
        do: 'resolve',
        devices: both ? [device, other(device)] : [device],
        pick: int(12),
        choices: both ? [choice(), choice()] : [choice()],
      };
    }
    if (r < 0.95) {
      const faults: Fault[] = [];
      if (chance(0.55)) {
        faults.push(fault(device));
        if (chance(0.25)) faults.push(fault(device));
      }
      return { do: 'sync', device, mode: chance(0.2) ? 'pull' : 'full', faults };
    }
    if (r < 0.98) return web();
    return { do: 'restart', device };
  };

  return { devices, seeds, steps: Array.from({ length: 10 + int(51) }, step) };
}

// --- describing ----------------------------------------------------------------------

const NAMES = ['A', 'B', 'C'];

const NOUNS: Record<Kind, string> = {
  session: 'a session',
  template: 'a template',
  bodyweight: 'a weigh-in',
  oneRm: 'a 1RM',
  manualRecords: 'a manual record',
  additions: 'an exercise',
};

const CHOICES: Record<ConflictChoice, string> = {
  keep_log: 'keeps the log’s version',
  use_saved: 'uses the saved one',
};

function ordinal(n: number): string {
  return `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
}

function describeFault(fault: Fault): string {
  switch (fault.kind) {
    case 'offline':
      return `offline at its ${ordinal(fault.at)} request`;
    case 'kill':
      return `killed at its ${ordinal(fault.at)} request`;
    case 'lose':
      return `killed after its ${ordinal(fault.at)} request is carried out, before the answer`;
    case 'crash':
      return `killed at its ${ordinal(fault.at)} store write`;
    case 'settle':
      return 'killed after the branch moves, before settling';
    case 'busy':
      return 'another client commits just before the branch moves';
    case 'race':
      return `before its ${ordinal(fault.at)} request: ${fault.steps.map(describeStep).join('; ')}`;
  }
}

export function describeStep(step: Step): string {
  switch (step.do) {
    case 'write': {
      const { op, kind, pick } = step.write;
      const verb = op === 'create' ? 'creates' : op === 'edit' ? 'edits' : 'deletes';
      return `${NAMES[step.device]} ${verb} ${NOUNS[kind]} (${pick})`;
    }
    case 'clash': {
      const [a, b] = step.devices;
      const how = (d: boolean) => (d ? 'deletes' : 'edits');
      return (
        `${NAMES[a]} ${how(step.deletes[0])} and ${NAMES[b]} ${how(step.deletes[1])} ` +
        `the same record (${step.pick})`
      );
    }
    case 'resolve':
      return (
        step.devices.map((d, i) => `${NAMES[d]} ${CHOICES[step.choices[i]]}`).join(' and ') +
        ` for the same conflict (${step.pick})`
      );
    case 'sync': {
      const verb = step.mode === 'full' ? 'syncs' : 'pulls';
      const faults = step.faults.map(describeFault);
      return `${NAMES[step.device]} ${verb}${faults.length ? `, ${faults.join(', ')}` : ''}`;
    }
    case 'restart':
      return `${NAMES[step.device]} is killed while idle and relaunched`;
    case 'web': {
      const verb = { edit: 'edits', reformat: 'rewrites', delete: 'deletes' }[step.op];
      return `the lifter ${verb} a record on github.com${step.hand ? ', by hand' : ''} (${step.pick})`;
    }
  }
}

export function describeSchedule(schedule: Schedule): string {
  const twins = new Set(schedule.seeds).size < schedule.seeds.length ? ' (twins)' : '';
  return [
    `${schedule.devices} devices${twins}:`,
    ...schedule.steps.map((step, i) => `  ${i + 1}. ${describeStep(step)}`),
  ].join('\n');
}
