import type {
  BodyweightEntry,
  Exercise,
  Id,
  IsoDate,
  PersonalRecord,
  Session,
  Tier,
} from '../model';
import { MONTH_NAMES } from '../metrics/dates';
import { e1rmSeries, type E1rmPoint, type StrengthRange } from '../metrics/e1rm';
import { flattenSets } from '../metrics/flatten';
import { isRecentRecord, recordAt } from '../metrics/records';
import { RECORD_MAX_REPS } from '../metrics/definitions';
import type { MuscleSet, MuscleVolume, VolumeWindow } from '../metrics/weekly';
import { weekdayShort } from './format';
import { formatSet } from './session';

/**
 * What the Progress tab (Athloi) works out before it draws: the body's levels
 * and list, the lifts that have a hill, the strength headline, and the rows of
 * the record book. The screens only paint these.
 */

/** "16", "11.5": half sets are real (an auxiliary muscle counts half), nothing finer is. */
export function formatCount(n: number): string {
  const rounded = Math.round(n * 2) / 2;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Whole kilograms for a headline, "163"; an estimate has no use for decimals. */
export function formatE1rm(kg: number): string {
  return String(Math.round(kg));
}

/** A weight as a lifter writes it on a plate: "142.5", "180". */
export function formatKg(kg: number): string {
  return String(Math.round(kg * 100) / 100);
}

/**
 * "12 Mar", from the month names here and not `format.ts`'s `shortDate`, which
 * the browser spells "Sept" in en-GB while every plate of the design says "Sep".
 */
export function shortDay(date: IsoDate): string {
  const [, m, d] = date.split('-').map(Number);
  return `${d} ${MONTH_NAMES[m - 1].slice(0, 3)}`;
}

/** "12 Mar", or "12 Mar 2025" when it is not this year, so an old record does not pass for a recent one. */
export function dateInYear(date: IsoDate, today: IsoDate): string {
  return date.slice(0, 4) === today.slice(0, 4)
    ? shortDay(date)
    : `${shortDay(date)} ${date.slice(0, 4)}`;
}

// --- Body ---------------------------------------------------------------------------

export const VOLUME_WINDOWS: { value: VolumeWindow; label: string }[] = [
  { value: 'this_week', label: 'This week' },
  { value: 'last_4_weeks', label: 'Last 4 weeks' },
];

/**
 * The window the body view opens on: this week, unless nothing has been
 * trained yet this week (a Monday morning), when a bare statue would say less
 * than the last four weeks do.
 */
export function openingWindow(thisWeek: readonly MuscleVolume[]): VolumeWindow {
  return thisWeek.some((v) => v.sets > 0) ? 'this_week' : 'last_4_weeks';
}

/** The statue's shades: one muscle id to its level. */
export function levelsOf(volume: readonly MuscleVolume[]): Map<string, number> {
  return new Map(volume.map((v) => [v.muscle.id, v.level]));
}

/** What each shade stands for, in weekly sets: the thresholds in `metrics/weekly.ts`. */
export const LEGEND_LABELS = ['0', '1–4', '5–9', '10–14', '15+'] as const;

/**
 * Under the figures. Over four weeks the shade is the weekly average, which
 * the caption says, because the list's numbers are the window's whole total.
 */
export function legendCaption(window: VolumeWindow): string {
  return window === 'this_week'
    ? 'working sets this week, auxiliary muscles count half'
    : // The no-break space keeps "4 weeks" whole when the caption wraps.
      'working sets a week, averaged over 4 weeks, auxiliary muscles count half';
}

export function volumeHeading(window: VolumeWindow): string {
  return window === 'this_week' ? 'Most worked this week' : 'Most worked in 4 weeks';
}

export interface MuscleBar {
  id: string;
  name: string;
  sets: number;
  text: string;
  /** 0..1 of the most worked muscle: the bar's length. */
  share: number;
}

/** The muscles that did any work, most first, as many as `limit`. */
export function topMuscles(volume: readonly MuscleVolume[], limit = 5): MuscleBar[] {
  const worked = volume.filter((v) => v.sets > 0).slice(0, limit);
  const most = worked[0]?.sets ?? 0;
  return worked.map((v) => ({
    id: v.muscle.id,
    name: v.muscle.name,
    sets: v.sets,
    text: formatCount(v.sets),
    share: most > 0 ? v.sets / most : 0,
  }));
}

export interface MuscleSessionRow {
  key: string;
  sessionId: Id;
  /** "Mon 28 Sep". */
  when: string;
  exercise: string;
  /** Sets that session, whatever they counted for. */
  sets: number;
  /** Counted as a fraction of a set: auxiliary work. */
  half: boolean;
  /** The sets' share of the muscle's total, "1.5 of 3 sets" for aux work. */
  counted: number;
}

/** "Mon 28 Sep": the weekday in sentence case, then the day. */
export function dayLabel(date: IsoDate): string {
  const wd = weekdayShort(date);
  return `${wd.charAt(0)}${wd.slice(1).toLowerCase()} ${shortDay(date)}`;
}

/**
 * The sets behind a muscle's number, one row per exercise in a session, newest
 * session first. A row's `counted` adds up, across the list, to the number on
 * the body.
 */
export function groupMuscleSets(
  sets: readonly MuscleSet[],
  library: readonly Exercise[],
): MuscleSessionRow[] {
  const names = new Map(library.map((e) => [e.id, e.name]));
  const rows = new Map<string, MuscleSessionRow>();
  for (const s of sets) {
    const key = `${s.session_id}:${s.exercise_instance_id}`;
    const row = rows.get(key) ?? {
      key,
      sessionId: s.session_id,
      when: dayLabel(s.date),
      exercise: names.get(s.exercise_id) ?? s.exercise_id,
      sets: 0,
      half: s.counted < 1,
      counted: 0,
    };
    row.sets += 1;
    row.counted += s.counted;
    rows.set(key, row);
  }
  return [...rows.values()];
}

/** "3 sets", "3 sets, counting half". */
export function muscleRowText(row: MuscleSessionRow): string {
  const n = `${row.sets} ${row.sets === 1 ? 'set' : 'sets'}`;
  return row.half ? `${n}, counting half` : n;
}

// --- Strength ------------------------------------------------------------------------

export const STRENGTH_RANGES: { value: StrengthRange; label: string }[] = [
  { value: '3M', label: '3M' },
  { value: '6M', label: '6M' },
  { value: '1Y', label: '1Y' },
  { value: 'all', label: 'All' },
];

/** The weigh-in in force on a date: the latest on or before it, else the earliest on record. */
export function bodyweightAtFrom(
  entries: readonly BodyweightEntry[],
): (date: IsoDate) => number | null {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  return (date) => {
    if (sorted.length === 0) return null;
    let held = sorted[0];
    for (const e of sorted) {
      if (e.date > date) break;
      held = e;
    }
    return held.weight_kg;
  };
}

export interface LiftChoice {
  exercise: Exercise;
  /** Days it has an e1RM, over the whole history. */
  days: number;
  last: IsoDate;
}

const TIER_ORDER: Record<Tier, number> = { comp: 0, high_spec: 1, low_spec: 2, acc: 3 };

/**
 * The exercises with an e1RM history, the ones the hill can draw: the
 * competition lifts first, then by tier, the most recently trained first within
 * a tier. Only exercises actually logged are measured.
 */
export function liftChoices(
  sessions: readonly Session[],
  library: readonly Exercise[],
  bodyweightAt: (date: IsoDate) => number | null,
): LiftChoice[] {
  const logged = new Set(flattenSets(sessions, library).map((s) => s.exercise.id));
  const choices: LiftChoice[] = [];
  for (const exercise of library) {
    if (!logged.has(exercise.id)) continue;
    const series = e1rmSeries(sessions, exercise, { bodyweightAt });
    if (series.length === 0) continue;
    choices.push({ exercise, days: series.length, last: series[series.length - 1].date });
  }
  return choices.sort(
    (a, b) =>
      TIER_ORDER[a.exercise.tier] - TIER_ORDER[b.exercise.tier] ||
      b.last.localeCompare(a.last) ||
      a.exercise.name.localeCompare(b.exercise.name),
  );
}

/**
 * Where the lifter lands: the competition lift trained most recently, or, with
 * no competition lift logged, whatever was trained most recently.
 */
export function defaultLift<T extends { exercise: Exercise; last: IsoDate }>(
  choices: readonly T[],
): T | null {
  const newest = (list: readonly T[]) =>
    list.reduce<T | null>((best, c) => (!best || c.last > best.last ? c : best), null);
  return (
    newest(choices.filter((c) => c.exercise.tier === 'comp' && c.exercise.base_lift)) ??
    newest(choices)
  );
}

/** The picked exercise when it is on offer, else the default one. */
export function resolvePick<T extends { exercise: Exercise; last: IsoDate }>(
  choices: readonly T[],
  picked: string | null,
): T | null {
  return choices.find((c) => c.exercise.id === picked) ?? defaultLift(choices);
}

export interface Headline {
  /** "163". */
  value: string;
  /** "+15 since April", "no change since April", or null with one day of data. */
  change: string | null;
}

/** "April", and the year when it is not this one. */
function monthPhrase(date: IsoDate, today: IsoDate): string {
  const [y, m] = date.split('-').map(Number);
  const name = MONTH_NAMES[m - 1];
  return String(y) === today.slice(0, 4) ? name : `${name} ${y}`;
}

/**
 * The latest e1RM in view and how far it has moved since the first one in view.
 * Both are rounded before they are compared, so the headline never says +15
 * beside two figures that differ by 14.
 */
export function headlineOf(points: readonly E1rmPoint[], today: IsoDate): Headline | null {
  if (points.length === 0) return null;
  const last = points[points.length - 1];
  const first = points[0];
  const value = formatE1rm(last.e1rm);
  if (points.length < 2) return { value, change: null };
  const delta = Math.round(last.e1rm) - Math.round(first.e1rm);
  const since =
    first.date.slice(0, 7) === today.slice(0, 7)
      ? 'this month'
      : `since ${monthPhrase(first.date, today)}`;
  const amount = delta === 0 ? 'no change' : `${delta > 0 ? '+' : '−'}${Math.abs(delta)}`;
  return { value, change: `${amount} ${since}` };
}

export interface HoverText {
  /** "160 kg". */
  value: string;
  /** "12 Aug · 140 × 5 @ 8.5". */
  detail: string;
  /** The set alone, "140 × 5 @ 8.5"; null when it is no longer in the log. */
  set: string | null;
}

/** What the tooltip and the table say of a point: its figure, its date and the set behind it. */
export function pointText(
  point: E1rmPoint,
  sessions: readonly Session[],
  exercise: Exercise,
  today: IsoDate,
): HoverText {
  const set = sessions
    .find((s) => s.id === point.session_id)
    ?.exercises.find((e) => e.id === point.exercise_instance_id)
    ?.performed.find((p) => p.id === point.set_id);
  const date = dateInYear(point.date, today);
  const text = set ? formatSet(set, exercise) : null;
  return {
    value: `${formatE1rm(point.e1rm)} kg`,
    detail: text ? `${date} · ${text}` : date,
    set: text,
  };
}

export interface SparseNote {
  text: string;
  /** Offer to show the whole history: there is more of it outside the range. */
  widen: boolean;
}

/**
 * What to say under a hill with little to draw. Two days or more draw a line
 * and need no apology; one is a lone stone, and none in view (with some before
 * it) is a range set too short.
 */
export function sparseNote(
  inView: number,
  inHistory: number,
  range: StrengthRange,
): SparseNote | null {
  const more = range !== 'all' && inHistory > inView;
  if (inView === 0) {
    return inHistory === 0 ? null : { text: 'No sessions in this range.', widen: more };
  }
  if (inView > 1) return null;
  return more
    ? { text: 'One session in this range.', widen: true }
    : { text: 'One session so far. The hill needs a few to draw.', widen: false };
}

// --- Labours -------------------------------------------------------------------------

/** The exercises with a record, ordered as the lift choices are. */
export function recordedExercises(
  book: readonly PersonalRecord[],
  library: readonly Exercise[],
): { exercise: Exercise; last: IsoDate; count: number }[] {
  const by = new Map<string, { last: IsoDate; count: number }>();
  for (const r of book) {
    const held = by.get(r.exercise_id);
    by.set(r.exercise_id, {
      last: held && held.last > r.date ? held.last : r.date,
      count: (held?.count ?? 0) + 1,
    });
  }
  return library
    .filter((e) => by.has(e.id))
    .map((exercise) => ({ exercise, ...by.get(exercise.id)! }))
    .sort(
      (a, b) =>
        TIER_ORDER[a.exercise.tier] - TIER_ORDER[b.exercise.tier] ||
        b.last.localeCompare(a.last) ||
        a.exercise.name.localeCompare(b.exercise.name),
    );
}

export interface RecordRow {
  reps: number;
  /** Null for a rep count with no record yet. */
  weight: string | null;
  date: string | null;
  /** "@ 8.5", "by hand", or "" for a set logged without an RPE. */
  source: string;
  /** Set in the last 30 days: the laurel and the gilded wash. */
  recent: boolean;
  /** Opens the session that set it; null for a record entered by hand or none at all. */
  sessionId: Id | null;
  manual: boolean;
  /** For a screen reader, the row in a sentence. */
  spoken: string;
}

/** One row for each of 1 to 10 reps, record or not. */
export function recordRows(
  book: readonly PersonalRecord[],
  exerciseId: string,
  today: IsoDate,
): RecordRow[] {
  return Array.from({ length: RECORD_MAX_REPS }, (_, i) => {
    const reps = i + 1;
    const unit = reps === 1 ? 'rep' : 'reps';
    const record = recordAt(book, exerciseId, reps);
    if (!record) {
      return {
        reps,
        weight: null,
        date: null,
        source: '',
        recent: false,
        sessionId: null,
        manual: false,
        spoken: `${reps} ${unit}, no record yet`,
      };
    }
    const weight = formatKg(record.weight_kg);
    const date = dateInYear(record.date, today);
    const manual = record.source === 'manual';
    const source = manual ? 'by hand' : record.rpe !== null ? `@ ${record.rpe}` : '';
    const recent = isRecentRecord(record, today);
    return {
      reps,
      weight,
      date,
      source,
      recent,
      sessionId: record.source === 'session' ? record.session_id : null,
      manual,
      spoken: `${reps} ${unit}, ${weight} kilograms, ${date}${source ? `, ${manual ? source : `at RPE ${record.rpe}`}` : ''}${recent ? ', a recent record' : ''}`,
    };
  });
}
