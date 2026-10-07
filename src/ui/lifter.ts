import { bestRecentE1rm } from '../metrics/e1rm';
import { RECORD_MAX_REPS } from '../metrics/definitions';
import { holdsRecords } from '../metrics/records';
import type {
  BodyweightEntry,
  CompetitionBest,
  CompetitionLift,
  Exercise,
  IsoDate,
  ManualRecord,
  OneRmEntry,
  PersonalRecord,
  Session,
} from '../model';
import { dayAndMonth } from './format';
import { parseNumber } from './session';
import { oneRmInForce } from './suggest';

/**
 * What is true of the lifter rather than of one session: weigh-ins, reference
 * maxes, records entered by hand and the bests from meets. Everything the Agora pages show about
 * them, and every rule for entering them, so the components stay thin.
 */

export const LIFTS: readonly CompetitionLift[] = ['squat', 'bench', 'deadlift'];

/** A weight that is plausibly a person's or a bar's; anything else is a slip of a finger. */
export const BODYWEIGHT_RANGE = { min: 20, max: 400 } as const;
/** A competition lift's weight, from an empty bar up: a max, a record, a meet's best. */
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

/** What the lift's card shows beside its reference max: a best, how much, when, on what. */
export interface BestLine {
  kg: number;
  date: IsoDate;
  /** Which stance, by name; null for a lift with one, where naming it adds nothing. */
  exercise: string | null;
  /** For a meet's best, the meet, if named. */
  meet: string | null;
}

/**
 * The two numbers a reference max is not: the heaviest single lifted in
 * training (from the record book, by hand or logged) and the heaviest made at
 * a meet. Across every competition exercise of the lift, so sumo and
 * conventional both stand for the deadlift. A tie keeps the earlier.
 */
export function liftBests(
  lift: CompetitionLift,
  book: readonly PersonalRecord[],
  bests: readonly CompetitionBest[],
  library: readonly Exercise[],
): { single: BestLine | null; competition: BestLine | null } {
  const names = new Map(
    library.filter((e) => holdsRecords(e) && e.base_lift === lift).map((e) => [e.id, e.name]),
  );
  const heaviest = <T extends { exercise_id: string; weight_kg: number; date: IsoDate }>(
    rows: readonly T[],
  ): T | null =>
    rows
      .filter((r) => names.has(r.exercise_id))
      .reduce<T | null>(
        (best, r) =>
          !best ||
          r.weight_kg > best.weight_kg ||
          (r.weight_kg === best.weight_kg && r.date < best.date)
            ? r
            : best,
        null,
      );
  const single = heaviest(book.filter((r) => r.reps === 1));
  const meet = heaviest(bests);
  const name = (id: string) => (names.size > 1 ? names.get(id)! : null);
  return {
    single: single && {
      kg: single.weight_kg,
      date: single.date,
      exercise: name(single.exercise_id),
      meet: null,
    },
    competition: meet && {
      kg: meet.weight_kg,
      date: meet.date,
      exercise: name(meet.exercise_id),
      meet: meet.meet,
    },
  };
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

/** "1 × 155 kg": what the record lifted. */
export function recordFigures(record: ManualRecord): string {
  return `${record.reps} × ${kgText(record.weight_kg)} kg`;
}

/** "14 March · @ 9.5 · Gym mock meet": when, how hard, and where, whichever are known. */
export function recordLine(record: ManualRecord, today: IsoDate): string {
  return [
    whenText(record.date, today),
    record.rpe === null ? null : `@ ${record.rpe}`,
    record.context,
  ]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ');
}

// --- bests at meets -----------------------------------------------------------------

/** The exercises a meet's best can be of: the competition lifts, each stance its own. */
export function competitionExercises(library: readonly Exercise[]): Exercise[] {
  return library.filter(holdsRecords);
}

/** Meet bests, newest first, then the heavier. */
export function bestsNewestFirst(bests: readonly CompetitionBest[]): CompetitionBest[] {
  return [...bests].sort((a, b) => b.date.localeCompare(a.date) || b.weight_kg - a.weight_kg);
}

/** "2 meets": a meet is a day with bests on it. */
export function bestsSummary(bests: readonly CompetitionBest[]): string {
  const meets = new Set(bests.map((b) => b.date)).size;
  return meets === 0 ? 'None yet' : `${meets} ${meets === 1 ? 'meet' : 'meets'}`;
}

export interface CompetitionForm {
  exerciseId: string;
  kg: string;
  date: string;
  meet: string;
}

/** Why a meet's best cannot be added, or null. */
export function competitionProblem(
  form: CompetitionForm,
  library: readonly Exercise[],
  today: IsoDate,
): string | null {
  if (!competitionExercises(library).some((e) => e.id === form.exerciseId)) {
    return 'Pick the lift.';
  }
  if (parseKg(form.kg, MAX_RANGE) === null)
    return `Enter the weight in kilograms, between ${MAX_RANGE.min} and ${MAX_RANGE.max}.`;
  if (!validDate(form.date, today)) return 'Pick a date that is not in the future.';
  return null;
}

/** The best the form describes. Call only once `competitionProblem` is null. */
export function competitionFrom(form: CompetitionForm): CompetitionBest {
  const kg = parseKg(form.kg, MAX_RANGE);
  if (kg === null) throw new Error('competitionFrom needs a valid form');
  return {
    date: form.date,
    exercise_id: form.exerciseId,
    weight_kg: kg,
    meet: form.meet.trim() === '' ? null : form.meet.trim(),
  };
}

/** "16 May · Nationals 2026": when, and the meet when named. */
export function competitionLine(best: CompetitionBest, today: IsoDate): string {
  return best.meet ? `${whenText(best.date, today)} · ${best.meet}` : whenText(best.date, today);
}
