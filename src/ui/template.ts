import type {
  CompetitionLift,
  Exercise,
  Id,
  Interval,
  IsoDate,
  LoadPrescription,
  OneRmEntry,
  PrescribedSet,
  ProgramLabel,
  Template,
  WeightPrescription,
} from '../model';
import { adjustRest, REST_STEP_S, restTargetS } from './rest';
import { measureOf, move, parseNumber, parseRpe, parseSeconds, restSeconds } from './session';
import { oneRmInForce, resolveLoad } from './suggest';

/**
 * What the template screen does to a template, as pure functions, like
 * `session.ts` for sessions. A target is one planned set: a load, reps and an
 * RPE, each exact, a range (3–5) or open-ended (5+). A load is kilograms, a
 * percentage of a reference max, left to the RPE, bodyweight plus, or a time.
 */

export type Target = Omit<PrescribedSet, 'id'>;

export function newTemplate(input: { id: Id; name: string; at: Date }): Template {
  const now = input.at.toISOString();
  return {
    id: input.id,
    name: input.name,
    intention: null,
    label: { name: null, block: null, week: null, day: null, weekday: null },
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

/** What the template is for, in a line; blank is none, since an empty string is not a value the format keeps. */
export function setIntention(template: Template, text: string): Template {
  return { ...template, intention: text.trim() || null };
}

/** Some of the program label's fields; those not given are kept. */
export function setLabel(template: Template, label: Partial<ProgramLabel>): Template {
  return { ...template, label: { ...template.label, ...label } };
}

export function addTemplateExercise(template: Template, exercise: Exercise): Template {
  const entry = {
    exercise_id: exercise.id,
    rest_s: null,
    prescribed: [emptyTarget(measureOf(exercise))],
  };
  return { ...template, exercises: [...template.exercises, entry] };
}

/** The exercise's target rest; null is its tier's default. */
export function setTemplateRest(
  template: Template,
  index: number,
  seconds: number | null,
): Template {
  return {
    ...template,
    exercises: template.exercises.map((e, i) =>
      i === index ? { ...e, rest_s: restSeconds(seconds) } : e,
    ),
  };
}

export function removeTemplateExercise(template: Template, index: number): Template {
  return { ...template, exercises: template.exercises.filter((_, i) => i !== index) };
}

export function moveTemplateExercise(template: Template, index: number, by: number): Template {
  return { ...template, exercises: move(template.exercises, index, by) };
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

/** The target moved `by` places among its exercise's. */
export function moveTarget(
  template: Template,
  index: number,
  target: number,
  by: number,
): Template {
  return updateTargets(template, index, (targets) => move(targets, target, by));
}

/** A copy right after the target, so a ramp is built by copying and nudging. */
export function duplicateTarget(template: Template, index: number, target: number): Template {
  return updateTargets(template, index, (targets) =>
    targets.flatMap((t, i) => (i === target ? [t, structuredClone(t)] : [t])),
  );
}

export type LoadMode = WeightPrescription['mode'];

/** A number, a range or null (open): the one shape every field of a target is edited in. */
export type Amount = number | Interval | null;

export interface TargetEdit {
  /**
   * The load, read by the target's mode: kilograms, added kilograms, seconds,
   * or for a percentage the percent points (80, not 0.8), which are stored as
   * the fraction the format keeps.
   */
  amount?: Amount;
  reps?: Amount;
  rpe?: Amount;
  /** Changes how the load is prescribed. A percentage also needs `lift`, or the change is refused. */
  mode?: LoadMode;
  lift?: CompetitionLift;
}

const OPEN: Interval = [null, null];

function asInterval(amount: Amount): Interval | null {
  if (amount === null) return null;
  if (typeof amount === 'number') return [amount, amount];
  return amount[0] === null && amount[1] === null ? null : [amount[0], amount[1]];
}

/** Percent points to the stored fraction, free of the float noise of 0.8 * 100. */
const toFraction = (n: number | null): number | null =>
  n === null ? null : Math.round(n * 100) / 10000;
const toPercent = (n: number | null): number | null =>
  n === null ? null : Math.round(n * 10000) / 100;

const mapInterval = (i: Interval, f: (n: number | null) => number | null): Interval => [
  f(i[0]),
  f(i[1]),
];

/** The mode's own number carries across a change of mode where it still means something. */
function switchMode(
  weight: WeightPrescription,
  mode: LoadMode,
  lift?: CompetitionLift,
): WeightPrescription {
  if (weight.mode === mode) return weight;
  const carried: Interval =
    weight.mode === 'absolute' ? weight.kg : weight.mode === 'bw_plus' ? weight.added_kg : OPEN;
  switch (mode) {
    case 'absolute':
      return { mode, kg: carried };
    case 'bw_plus':
      return { mode, added_kg: carried };
    case 'rpe_driven':
      return { mode };
    case 'pct_1rm':
      return lift ? { mode, pct: OPEN, lift } : weight;
  }
}

function withAmount(weight: WeightPrescription, amount: Amount): WeightPrescription {
  const i = asInterval(amount) ?? OPEN;
  switch (weight.mode) {
    case 'absolute':
      return { ...weight, kg: i };
    case 'bw_plus':
      return { ...weight, added_kg: i };
    case 'pct_1rm':
      return { ...weight, pct: mapInterval(i, toFraction) };
    case 'rpe_driven':
      return weight;
  }
}

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
      if (edit.reps !== undefined) next.reps = measure === 'time' ? null : asInterval(edit.reps);
      if (edit.rpe !== undefined) next.rpe = asInterval(edit.rpe);
      if (measure === 'time') {
        if (edit.amount !== undefined) {
          next.load = { kind: 'time', seconds: asInterval(edit.amount) ?? OPEN };
        }
      } else if (next.load.kind === 'weight') {
        let weight = next.load.weight;
        // A figure typed for a set planned by feel makes it a kilogram target.
        const mode =
          edit.mode ??
          (weight.mode === 'rpe_driven' && asInterval(edit.amount ?? null)
            ? 'absolute'
            : undefined);
        if (mode !== undefined) weight = switchMode(weight, mode, edit.lift);
        if (edit.amount !== undefined) weight = withAmount(weight, edit.amount);
        next.load = { kind: 'weight', weight };
      }
      return next;
    }),
  );
}

/** The number a target's load holds: kilograms, or seconds. Null for a percentage, which holds a fraction. */
export function targetAmount(target: Target): number | null {
  if (target.load.kind === 'time') return target.load.seconds[0];
  if (target.load.kind === 'weight') {
    const w = target.load.weight;
    if (w.mode === 'absolute') return w.kg[0];
    if (w.mode === 'bw_plus') return w.added_kg[0];
  }
  return null;
}

/** A target's load as the editor shows it: its mode, and the interval in the mode's own units. */
export function loadOf(target: Target): {
  mode: LoadMode | 'time' | 'distance';
  amount: Interval | null;
} {
  const load = target.load;
  if (load.kind === 'time') return { mode: 'time', amount: asInterval(load.seconds) };
  if (load.kind === 'distance') return { mode: 'distance', amount: asInterval(load.meters) };
  const w = load.weight;
  switch (w.mode) {
    case 'absolute':
      return { mode: w.mode, amount: asInterval(w.kg) };
    case 'bw_plus':
      return { mode: w.mode, amount: asInterval(w.added_kg) };
    case 'pct_1rm':
      return { mode: w.mode, amount: asInterval(mapInterval(w.pct, toPercent)) };
    case 'rpe_driven':
      return { mode: w.mode, amount: null };
  }
}

/** The lift a percentage target is of, if it is one. */
export function liftOf(target: Target): CompetitionLift | null {
  return target.load.kind === 'weight' && target.load.weight.mode === 'pct_1rm'
    ? target.load.weight.lift
    : null;
}

export const MODE_LABELS: Record<LoadMode, string> = {
  absolute: 'kg',
  pct_1rm: '% of max',
  rpe_driven: 'RPE',
  bw_plus: 'BW +',
};

/**
 * The ways to prescribe a load for this exercise, in the order of the chips.
 * A percentage needs a lift to be a percentage of; bodyweight work is loaded
 * as bodyweight plus, never as the bar. The mode a target already has is
 * always offered, so a template saved from a session never loses its chip.
 */
export function loadModes(exercise: Exercise | undefined, current?: LoadMode): LoadMode[] {
  const modes: LoadMode[] = !exercise
    ? ['absolute', 'rpe_driven']
    : exercise.load_type === 'bw_plus'
      ? ['bw_plus', 'rpe_driven']
      : exercise.base_lift
        ? ['absolute', 'pct_1rm', 'rpe_driven']
        : ['absolute', 'rpe_driven'];
  return current && !modes.includes(current) ? [current, ...modes] : modes;
}

// --- typing and showing ranges ------------------------------------------------------

const trimZeros = (n: number): string => String(Math.round(n * 100) / 100);

/** "5", "3–5", "5+"; empty for an interval open on both sides. */
export function formatRange(
  interval: Interval | null,
  show: (n: number) => string = trimZeros,
): string {
  if (!interval) return '';
  const [lo, hi] = interval;
  if (lo === null && hi === null) return '';
  if (hi === null) return `${show(lo as number)}+`;
  if (lo === null) return `≤${show(hi)}`;
  return lo === hi ? show(lo) : `${show(lo)}–${show(hi)}`;
}

/** Seconds as a clock reads them: 90 is "1:30", 45 is "0:45". */
export function formatClock(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Percent points, a trailing % allowed; above 0 and up to 200. */
export function parsePercent(text: string): number | null | undefined {
  const n = parseNumber(text.replace('%', ''));
  return n === null || n === undefined ? n : n > 0 && n <= 200 ? n : undefined;
}

/** Kilograms, assistance written with a minus sign. */
export function parseSigned(text: string): number | null | undefined {
  const t = text.trim().replace('−', '-');
  if (/^-\s*\d/.test(t)) {
    const n = parseNumber(t.slice(1));
    return typeof n === 'number' ? -n : undefined;
  }
  return parseNumber(t);
}

/**
 * What was typed into a field that takes a number, a range ("3-5", "3–5") or
 * a floor ("5+", "≥5"): the interval, null for an empty field, undefined for
 * text that is not one, which the field then puts back. `one` reads each end.
 */
export function parseRange(
  text: string,
  one: (end: string) => number | null | undefined = parseNumber,
): Interval | null | undefined {
  const t = text.trim();
  if (t === '') return null;
  const end = (s: string): number | undefined => {
    const n = one(s);
    return typeof n === 'number' ? n : undefined;
  };
  const floor = /^(?:≥|>=)\s*(.+)$/.exec(t) ?? /^(.+?)\s*\+$/.exec(t);
  if (floor) {
    const lo = end(floor[1]);
    return lo === undefined ? undefined : [lo, null];
  }
  // A leading minus is a sign (assisted work), so only a dash between two numbers is a range.
  const parts = t.split(/\s*[-–—]\s*/);
  if (parts.length === 2 && parts[0] !== '' && parts[1] !== '') {
    const [a, b] = [end(parts[0]), end(parts[1])];
    return a === undefined || b === undefined ? undefined : [Math.min(a, b), Math.max(a, b)];
  }
  const n = end(t);
  return n === undefined ? undefined : [n, n];
}

/** How each field of a target reads the ends of what is typed. */
export const READERS = {
  reps: parseNumber,
  rpe: parseRpe,
  kg: parseSigned,
  percent: parsePercent,
  time: parseSeconds,
} as const;

// --- the label and the rest ---------------------------------------------------------

export const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

/** "Sun", "sunday" and "SUNDAY" are one day; null for anything else. */
export function weekdayKey(text: string | null): (typeof WEEKDAYS)[number] | null {
  const t = text?.trim().toLowerCase();
  if (!t || t.length < 3) return null;
  return WEEKDAYS.find((d) => d.startsWith(t)) ?? null;
}

/** A whole number from 1 to 99, as block, week and day are; null for empty, undefined for junk. */
export function parseOrdinal(text: string): number | null | undefined {
  const n = parseNumber(text);
  if (n === null || n === undefined) return n;
  return Number.isInteger(n) && n >= 1 && n <= 99 ? n : undefined;
}

/**
 * The rest after one step of the stepper. An exercise with no rest of its own
 * steps from its tier's default, so the first tap reads 3:15 or 2:45, not a
 * jump to some unrelated number.
 */
export function stepTemplateRest(
  exercise: Exercise | undefined,
  current: number | null,
  direction: 1 | -1,
): number {
  return adjustRest(restTargetS(exercise?.tier ?? 'acc', current), direction * REST_STEP_S);
}

/** The rest the exercise will use, as a clock: its own, else its tier's. */
export function restShown(exercise: Exercise | undefined, current: number | null): string {
  return formatClock(restTargetS(exercise?.tier ?? 'acc', current));
}

// --- the live preview of a percentage -----------------------------------------------

export type LoadPreview =
  | { kind: 'resolved'; lead: string; result: string; note: string }
  | { kind: 'missing'; lift: CompetitionLift };

/**
 * What "80% of max" comes to: "80% of 180 → 145 kg, rounded to 2.5". The max
 * is the one in force on `date`, as a session of that date resolves it, and
 * the step is the plate increment, since a percentage is rounded to plates.
 */
export function loadPreview(
  target: Target,
  ctx: { date: IsoDate; oneRms: OneRmEntry[]; step: number },
): LoadPreview | null {
  const lift = liftOf(target);
  if (!lift || target.load.kind !== 'weight') return null;
  const { amount } = loadOf(target);
  if (!amount) return null;
  const max = oneRmInForce(ctx.oneRms, lift, ctx.date);
  if (!max) return { kind: 'missing', lift };
  const resolved = resolveLoad(target.load, { ...ctx, unit: 'kg' });
  if (resolved.kind !== 'weight') return null;
  return {
    kind: 'resolved',
    lead: `${formatRange(amount)}% of ${trimZeros(max.weight_kg)}`,
    result: `${formatRange([resolved.value, amount[1] === null ? null : (resolved.high ?? resolved.value)])} kg`,
    note: `rounded to ${trimZeros(ctx.step)}`,
  };
}

// --- a line for a list --------------------------------------------------------------

type Prescribed = Pick<Omit<PrescribedSet, 'id'>, 'reps' | 'load' | 'is_warmup'>;

/**
 * "3 × 5", "4 × 3–5", "3 × 0:45", or "3 sets" where the targets differ: one
 * exercise's working sets, for a card with room for a few words. Empty when
 * there are none.
 */
export function setsSummary(prescribed: Prescribed[]): string {
  const work = prescribed.filter((p) => !p.is_warmup);
  if (work.length === 0) return '';
  const n = work.length;
  const each = new Set(
    work.map((p) =>
      p.load.kind === 'time'
        ? formatRange(p.load.seconds, formatClock)
        : p.reps
          ? formatRange(p.reps)
          : '',
    ),
  );
  const [only] = each;
  return each.size === 1 && only ? `${n} × ${only}` : `${n} ${n === 1 ? 'set' : 'sets'}`;
}

/** "Low-bar squat 3 × 5", "Bench press 4 × 3–5": a plan's exercises with their targets. */
export function exerciseLines(
  exercises: { exercise_id: string; prescribed: Prescribed[] }[],
  names: ReadonlyMap<string, string>,
): string[] {
  return exercises.map((e) => {
    const name = names.get(e.exercise_id) ?? e.exercise_id;
    const sets = setsSummary(e.prescribed);
    return sets ? `${name} ${sets}` : name;
  });
}
