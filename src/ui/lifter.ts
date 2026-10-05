import { bestRecentE1rm } from '../metrics/e1rm';
import { RECORD_MAX_REPS } from '../metrics/definitions';
import type {
  BodyweightEntry,
  CompetitionLift,
  Exercise,
  IsoDate,
  ManualRecord,
  OneRmEntry,
  Session,
} from '../model';
import { dayAndMonth } from './format';
import { parseNumber } from './session';
import { oneRmInForce } from './suggest';

/**
 * What is true of the lifter rather than of one session: weigh-ins, reference
 * maxes and records entered by hand. Everything the Agora pages show about
 * them, and every rule for entering them, so the components stay thin.
 */

export const LIFTS: readonly CompetitionLift[] = ['squat', 'bench', 'deadlift'];

/** A weight that is plausibly a person's or a bar's; anything else is a slip of a finger. */
export const BODYWEIGHT_RANGE = { min: 20, max: 400 } as const;
export const MAX_RANGE = { min: 20, max: 700 } as const;

/** Kilograms as written: no trailing zeros, no float tail. */
export function kgText(kg: number): string {
  return String(Math.round(kg * 100) / 100);
}

/**
 * A weight typed into a field, in kilograms, or null when it is empty, not a
 * number, or outside `range`. A comma is a decimal point.
 */
export function parseKg(text: string, range: { min: number; max: number }): number | null {
  const n = parseNumber(text);
  if (n === null || n === undefined) return null;
  const kg = Math.round(n * 100) / 100;
  return kg >= range.min && kg <= range.max ? kg : null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** A date from a date field: valid, and not in the future (a weigh-in or a lift already happened). */
export function validDate(text: string, today: IsoDate): IsoDate | null {
  if (!ISO.test(text)) return null;
  const parsed = new Date(`${text}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) return null;
  return text <= today ? text : null;
}

/** "12 March", with the year once it is not this one: a max set long ago says when. */
export function whenText(date: IsoDate, today: IsoDate): string {
  const year = date.slice(0, 4);
  return year === today.slice(0, 4) ? dayAndMonth(date) : `${dayAndMonth(date)} ${year}`;
}

// --- bodyweight ---------------------------------------------------------------------

export interface WeighIn {
  entry: BodyweightEntry;
  /** Kilograms since the weigh-in before it; null for the first ever. */
  change: number | null;
}

/** Weigh-ins newest first, each with its change from the one before. */
export function weighIns(entries: readonly BodyweightEntry[]): WeighIn[] {
  const oldestFirst = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  return oldestFirst
    .map((entry, i) => ({
      entry,
      change:
        i === 0 ? null : Math.round((entry.weight_kg - oldestFirst[i - 1].weight_kg) * 100) / 100,
    }))
    .reverse();
}

/** "+0.4", "−0.2" (a real minus sign) or "no change". */
export function changeText(change: number): string {
  if (change === 0) return 'no change';
  return `${change > 0 ? '+' : '−'}${kgText(Math.abs(change))}`;
}

/** The bodyweight on `date`: the latest weigh-in on or before it, for bodyweight-plus lifts. */
export function bodyweightAt(
  entries: readonly BodyweightEntry[],
): (date: IsoDate) => number | null {
  return (date) => {
    let found: BodyweightEntry | null = null;
    for (const e of entries) if (e.date <= date && (!found || e.date >= found.date)) found = e;
    return found?.weight_kg ?? null;
  };
}

export function bodyweightSummary(entries: readonly BodyweightEntry[]): string {
  const latest = weighIns(entries)[0];
  if (!latest) return 'No weigh-ins yet';
  return `${kgText(latest.entry.weight_kg)} kg on ${dayAndMonth(latest.entry.date)}`;
}

/** Why a weigh-in cannot be added, or null. */
export function weighInProblem(date: string, kg: string, today: IsoDate): string | null {
  if (!validDate(date, today)) return 'Pick a date that is not in the future.';
  if (parseKg(kg, BODYWEIGHT_RANGE) === null)
    return `Enter the weight in kilograms, between ${BODYWEIGHT_RANGE.min} and ${BODYWEIGHT_RANGE.max}.`;
  return null;
}

// --- reference maxes ----------------------------------------------------------------

export interface MaxView {
  lift: CompetitionLift;
  /** The entry in force today, or null before the first. */
  inForce: OneRmEntry | null;
  /** Every entry for the lift, newest first, the one in force included. */
  history: OneRmEntry[];
  /** The best recent e1RM, offered to pre-fill a new entry; never saved by itself. */
  suggestion: { kg: number; date: IsoDate } | null;
}

/**
 * Each competition lift's reference max in force `today`, its history, and the
 * best recent e1RM beside it. The suggestion is whole kilograms, as a max is
 * quoted, and is withheld when it is the max already in force.
 */
export function maxViews(
  oneRms: readonly OneRmEntry[],
  sessions: readonly Session[],
  library: readonly Exercise[],
  bodyweights: readonly BodyweightEntry[],
  today: IsoDate,
): MaxView[] {
  const entries = [...oneRms];
  const weightAt = bodyweightAt(bodyweights);
  return LIFTS.map((lift) => {
    const inForce = oneRmInForce(entries, lift, today);
    const best = bestRecentE1rm(sessions, library, lift, today, { bodyweightAt: weightAt });
    const kg = best ? Math.round(best.e1rm) : null;
    return {
      lift,
      inForce,
      history: entries.filter((e) => e.lift === lift).sort((a, b) => b.date.localeCompare(a.date)),
      suggestion: best && kg !== null && kg !== inForce?.weight_kg ? { kg, date: best.date } : null,
    };
  });
}

/** "squat 150 · bench 100 · deadlift 180", the lifts that have a max. */
export function maxesSummary(oneRms: readonly OneRmEntry[], today: IsoDate): string {
  const parts = LIFTS.flatMap((lift) => {
    const e = oneRmInForce([...oneRms], lift, today);
    return e ? [`${lift} ${kgText(e.weight_kg)}`] : [];
  });
  return parts.length ? parts.join(' · ') : 'None set yet';
}

/** Why a reference max cannot be added, or null. */
export function maxProblem(date: string, kg: string, today: IsoDate): string | null {
  if (!validDate(date, today)) return 'Pick a date that is not in the future.';
  if (parseKg(kg, MAX_RANGE) === null)
    return `Enter the max in kilograms, between ${MAX_RANGE.min} and ${MAX_RANGE.max}.`;
  return null;
}

// --- records by hand ----------------------------------------------------------------

/** Hand-entered records, newest first, then the heavier. */
export function recordsNewestFirst(records: readonly ManualRecord[]): ManualRecord[] {
  return [...records].sort(
    (a, b) => b.date.localeCompare(a.date) || b.weight_kg - a.weight_kg || a.reps - b.reps,
  );
}

export function recordsSummary(records: readonly ManualRecord[]): string {
  return records.length === 0 ? 'None by hand' : `${records.length} by hand`;
}

/** The RPEs a record can carry: 6 to 10 by halves, as the entry panel's chips. */
export const RECORD_RPES: readonly number[] = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];

export interface RecordForm {
  exerciseId: string | null;
  reps: string;
  kg: string;
  date: string;
  /** Empty for none. */
  rpe: string;
  context: string;
}

/** Why a record cannot be added, or null. */
export function recordProblem(form: RecordForm, today: IsoDate): string | null {
  if (!form.exerciseId) return 'Pick the exercise.';
  const reps = Number(form.reps);
  if (!Number.isInteger(reps) || reps < 1 || reps > RECORD_MAX_REPS)
    return `Reps are 1 to ${RECORD_MAX_REPS}.`;
  if (parseKg(form.kg, MAX_RANGE) === null)
    return `Enter the weight in kilograms, between ${MAX_RANGE.min} and ${MAX_RANGE.max}.`;
  if (!validDate(form.date, today)) return 'Pick a date that is not in the future.';
  return null;
}

/** The record the form describes. Call only once `recordProblem` is null. */
export function recordFrom(form: RecordForm): ManualRecord {
  const kg = parseKg(form.kg, MAX_RANGE);
  if (!form.exerciseId || kg === null) throw new Error('recordFrom needs a valid form');
  return {
    source: 'manual',
    exercise_id: form.exerciseId,
    reps: Number(form.reps),
    weight_kg: kg,
    date: form.date,
    rpe: form.rpe === '' ? null : Number(form.rpe),
    context: form.context.trim() === '' ? null : form.context.trim(),
  };
}

/** "1 × 155 kg @ 9.5", the way a set reads, with the × and @ the screen mutes. */
export function recordFigures(record: ManualRecord): { text: string; rpe: string | null } {
  return {
    text: `${record.reps} × ${kgText(record.weight_kg)} kg`,
    rpe: record.rpe === null ? null : `@ ${record.rpe}`,
  };
}
