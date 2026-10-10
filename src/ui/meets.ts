import { CONFIG } from '../metrics/definitions';
import type {
  CompetitionLift,
  Exercise,
  Id,
  Instant,
  IsoDate,
  Meet,
  MeetAttempt,
  MeetAttempts,
  Session,
} from '../model';
import { dayAndMonth } from './format';
import {
  BODYWEIGHT_RANGE,
  kgText,
  LIFTS,
  MAX_RANGE,
  parseKg,
  validDate,
  whenText,
  type BestLine,
} from './lifter';

/**
 * Meets as the Agora pages show them: what a meet came to, the lifter's bests
 * across all of them, and the rules for entering one. A meet stores only what
 * happened on the platform (`Meet` in model/records.ts); its best of a lift,
 * its total and every best across meets are worked out here, on each call,
 * and never saved (DATA.md, The files).
 */

/** Attempts a lift has at a meet. */
export const ATTEMPTS = 3;

/** "Squat", "Bench", "Deadlift": a lift as a heading. */
export const LIFT_NAMES: Record<CompetitionLift, string> = {
  squat: 'Squat',
  bench: 'Bench',
  deadlift: 'Deadlift',
};

/** What the equipment field suggests; any text is accepted. */
export const EQUIPMENT_SUGGESTIONS: readonly string[] = ['raw', 'wraps', 'single-ply', 'multi-ply'];

const round = (kg: number) => Math.round(kg * 100) / 100;

// --- what a meet came to ---------------------------------------------------------------

/** The heaviest good attempt of a lift's three; the earlier of two equal ones. Null if none was good. */
export function liftBest(slots: MeetAttempts): MeetAttempt | null {
  return slots.reduce<MeetAttempt | null>(
    (best, slot) => (slot?.good && (!best || slot.weight_kg > best.weight_kg) ? slot : best),
    null,
  );
}

/** The sum of the three lifts' bests; null while any lift has no good attempt. */
export function meetTotal(meet: Meet): number | null {
  let total = 0;
  for (const lift of LIFTS) {
    const best = liftBest(meet.lifts[lift]);
    if (!best) return null;
    total += best.weight_kg;
  }
  return round(total);
}

/** Newest first: by date, then by id, so two meets on one day keep one order. */
export function meetsNewestFirst(meets: readonly Meet[]): Meet[] {
  return [...meets].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

/** The most recent meet, or null before the first. */
export function latestMeet(meets: readonly Meet[]): Meet | null {
  return meetsNewestFirst(meets)[0] ?? null;
}

// --- bests across meets ----------------------------------------------------------------

/** One good attempt, with the meet it was made at. */
export interface MeetLift {
  kg: number;
  exercise_id: string;
  date: IsoDate;
  meet_id: Id;
  /** The meet's name, if it has one. */
  meet: string | null;
}

/** Every good attempt of a lift in every meet, as `MeetLift`s. */
function goodAttempts(meets: readonly Meet[], lift: CompetitionLift): MeetLift[] {
  return meets.flatMap((meet) =>
    meet.lifts[lift].flatMap((slot) =>
      slot?.good
        ? [
            {
              kg: slot.weight_kg,
              exercise_id: slot.exercise_id,
              date: meet.date,
              meet_id: meet.id,
              meet: meet.name,
            },
          ]
        : [],
    ),
  );
}

/** The heavier; on a tie the earlier meet, as the record book keeps the first to lift it. */
function heaviest(rows: readonly MeetLift[]): MeetLift | null {
  return rows.reduce<MeetLift | null>(
    (best, r) =>
      !best ||
      r.kg > best.kg ||
      (r.kg === best.kg &&
        (r.date < best.date || (r.date === best.date && r.meet_id < best.meet_id)))
        ? r
        : best,
    null,
  );
}

/** The heaviest good attempt a lift ever had at a meet, whichever exercise it was; null if none. */
export function bestOfLift(meets: readonly Meet[], lift: CompetitionLift): MeetLift | null {
  return heaviest(goodAttempts(meets, lift));
}

/** The heaviest good attempt of one exercise ever made at a meet: sumo and conventional apart. */
export function bestOfExercise(meets: readonly Meet[], exerciseId: string): MeetLift | null {
  return heaviest(
    LIFTS.flatMap((lift) => goodAttempts(meets, lift)).filter((r) => r.exercise_id === exerciseId),
  );
}

/**
 * The lift's all-time meet best as a reference max's card shows it, naming the
 * stance once the lifter has made more than one good attempt of different ones.
 */
export function meetBestLine(
  lift: CompetitionLift,
  meets: readonly Meet[],
  library: readonly Exercise[],
): BestLine | null {
  const best = bestOfLift(meets, lift);
  if (!best) return null;
  const stances = new Set(goodAttempts(meets, lift).map((r) => r.exercise_id));
  const name = library.find((e) => e.id === best.exercise_id)?.name ?? best.exercise_id;
  return {
    kg: best.kg,
    date: best.date,
    exercise: stances.size > 1 ? name : null,
    meet: best.meet,
  };
}

/** The best total across meets, the earlier on a tie; null while no meet has one. */
export function bestTotal(
  meets: readonly Meet[],
): { kg: number; date: IsoDate; meet_id: Id; meet: string | null } | null {
  let best: { kg: number; date: IsoDate; meet_id: Id; meet: string | null } | null = null;
  for (const meet of meets) {
    const kg = meetTotal(meet);
    if (kg === null) continue;
    if (!best || kg > best.kg || (kg === best.kg && meet.date < best.date)) {
      best = { kg, date: meet.date, meet_id: meet.id, meet: meet.name };
    }
  }
  return best;
}

/** The days an exercise was made good at a meet, for Labours' "last day with data". */
export function meetDays(meets: readonly Meet[]): Map<string, IsoDate> {
  const last = new Map<string, IsoDate>();
  for (const lift of LIFTS) {
    for (const r of goodAttempts(meets, lift)) {
      const held = last.get(r.exercise_id);
      if (!held || r.date > held) last.set(r.exercise_id, r.date);
    }
  }
  return last;
}

/** The lift's row of the summary above the list. */
export interface LiftSummary {
  lift: CompetitionLift;
  /** The all-time meet best, with the stance named once the lifter has taken more than one. */
  best: (MeetLift & { exercise: string | null }) | null;
  /** The lift's best at the most recent meet; null when that meet did not have one. */
  latest: { kg: number; exercise: string | null } | null;
}

export interface MeetsSummary {
  lifts: LiftSummary[];
  total: ReturnType<typeof bestTotal>;
  /** The most recent meet, and what it totalled. */
  latest: { meet: Meet; total: number | null } | null;
}

/** Per lift, the all-time meet best and the most recent meet's; and the totals. */
export function meetsSummary(meets: readonly Meet[], library: readonly Exercise[]): MeetsSummary {
  const names = new Map(library.map((e) => [e.id, e.name]));
  const latest = latestMeet(meets);
  // A stance is named only when more than one has been lifted: with one, it adds nothing.
  const stances = (lift: CompetitionLift) =>
    new Set(goodAttempts(meets, lift).map((r) => r.exercise_id)).size;
  const name = (lift: CompetitionLift, id: string) =>
    stances(lift) > 1 ? (names.get(id) ?? id) : null;
  return {
    lifts: LIFTS.map((lift): LiftSummary => {
      const best = bestOfLift(meets, lift);
      const there = latest ? liftBest(latest.lifts[lift]) : null;
      return {
        lift,
        best: best && { ...best, exercise: name(lift, best.exercise_id) },
        latest: there && { kg: there.weight_kg, exercise: name(lift, there.exercise_id) },
      };
    }),
    total: bestTotal(meets),
    latest: latest && { meet: latest, total: meetTotal(latest) },
  };
}

// --- the lists -------------------------------------------------------------------------

/** What a meet is called: its name, else the day it was. */
export function meetTitle(meet: Meet): string {
  return meet.name ?? `Meet of ${dayAndMonth(meet.date)} ${meet.date.slice(0, 4)}`;
}

/** "16 May 2026 · Lisbon": when, and where if known. */
export function meetWhen(meet: Meet, today: IsoDate): string {
  return [whenText(meet.date, today), meet.location].filter(Boolean).join(' · ');
}

/** "600 kg", or a dash while a lift has no good attempt. */
export function totalText(total: number | null): string {
  return total === null ? '—' : `${kgText(total)} kg`;
}

/** Agora's row: how many meets and the best total, or that there are none. */
export function meetsLine(meets: readonly Meet[]): string {
  if (meets.length === 0) return 'None yet';
  const count = `${meets.length} ${meets.length === 1 ? 'meet' : 'meets'}`;
  const total = bestTotal(meets);
  return total ? `${count} · best total ${kgText(total.kg)} kg` : count;
}

// --- the exercises a meet's attempts can be of ---------------------------------------------

/** A lift's competition-tier exercises: each stance of the squat and the deadlift is its own. */
export function meetExercises(library: readonly Exercise[], lift: CompetitionLift): Exercise[] {
  return library.filter((e) => e.tier === 'comp' && e.base_lift === lift);
}

/**
 * The exercise a lift's row starts on: the one the most recent meet used, else
 * the one most trained, else the first lift of that name that keeps a record
 * book (`records` in `definitions.json`), else the first there is. Empty only
 * when the library has no competition exercise for the lift.
 */
export function usualExercises(
  meets: readonly Meet[],
  sessions: readonly Session[],
  library: readonly Exercise[],
): Record<CompetitionLift, string> {
  const trained = new Map<string, number>();
  for (const session of sessions) {
    for (const instance of session.exercises) {
      const sets = instance.performed.filter((p) => p.state === 'done' && !p.is_warmup).length;
      trained.set(instance.exercise_id, (trained.get(instance.exercise_id) ?? 0) + sets);
    }
  }
  const ordered = meetsNewestFirst(meets);
  const usual = (lift: CompetitionLift): string => {
    const options = meetExercises(library, lift);
    const ids = new Set(options.map((e) => e.id));
    for (const meet of ordered) {
      const used = meet.lifts[lift].find((slot) => slot && ids.has(slot.exercise_id));
      if (used) return used.exercise_id;
    }
    const most = options.reduce<Exercise | null>(
      (best, e) => ((trained.get(e.id) ?? 0) > (trained.get(best?.id ?? '') ?? 0) ? e : best),
      null,
    );
    if (most && (trained.get(most.id) ?? 0) > 0) return most.id;
    const kept = options.find((e) => CONFIG.recordExercises.includes(e.id));
    return (kept ?? options[0])?.id ?? '';
  };
  return { squat: usual('squat'), bench: usual('bench'), deadlift: usual('deadlift') };
}

// --- the editor -------------------------------------------------------------------------

/** One attempt as the editor holds it: text for the weight, an empty one meaning not taken. */
export interface AttemptForm {
  exerciseId: string;
  kg: string;
  good: boolean;
}

export interface MeetForm {
  date: string;
  name: string;
  location: string;
  federation: string;
  weightClass: string;
  equipment: string;
  bodyweight: string;
  placing: string;
  notes: string;
  lifts: Record<CompetitionLift, [AttemptForm, AttemptForm, AttemptForm]>;
}

type Usual = Record<CompetitionLift, string>;

function slotsOf(lift: CompetitionLift, usual: Usual, meet: Meet | null) {
  const slots = (meet?.lifts[lift] ?? [null, null, null]) as MeetAttempts;
  // A row's exercise is its first attempt's; one with none starts on the usual.
  const first = slots.find((s) => s !== null)?.exercise_id ?? usual[lift];
  return slots.map((slot): AttemptForm =>
    slot
      ? { exerciseId: slot.exercise_id, kg: kgText(slot.weight_kg), good: slot.good }
      : { exerciseId: first, kg: '', good: true },
  ) as [AttemptForm, AttemptForm, AttemptForm];
}

/** A new meet: today, nothing taken, each row on the lifter's usual exercise. */
export function blankForm(today: IsoDate, usual: Usual): MeetForm {
  return {
    date: today,
    name: '',
    location: '',
    federation: '',
    weightClass: '',
    equipment: '',
    bodyweight: '',
    placing: '',
    notes: '',
    lifts: {
      squat: slotsOf('squat', usual, null),
      bench: slotsOf('bench', usual, null),
      deadlift: slotsOf('deadlift', usual, null),
    },
  };
}

/** A saved meet as the editor shows it. */
export function formFrom(meet: Meet, usual: Usual): MeetForm {
  return {
    date: meet.date,
    name: meet.name ?? '',
    location: meet.location ?? '',
    federation: meet.federation ?? '',
    weightClass: meet.weight_class ?? '',
    equipment: meet.equipment ?? '',
    bodyweight: meet.bodyweight_kg === null ? '' : kgText(meet.bodyweight_kg),
    placing: meet.placing === null ? '' : String(meet.placing),
    notes: meet.notes ?? '',
    lifts: {
      squat: slotsOf('squat', usual, meet),
      bench: slotsOf('bench', usual, meet),
      deadlift: slotsOf('deadlift', usual, meet),
    },
  };
}

/** The exercise a lift's row shows: that of its first attempt (they move together). */
export function rowExercise(form: MeetForm, lift: CompetitionLift): string {
  return form.lifts[lift][0].exerciseId;
}

/** Sets the exercise of all of a lift's attempts: one choice per row. */
export function withRowExercise(form: MeetForm, lift: CompetitionLift, id: string): MeetForm {
  return {
    ...form,
    lifts: {
      ...form.lifts,
      [lift]: form.lifts[lift].map((a) => ({ ...a, exerciseId: id })),
    },
  };
}

const taken = (a: AttemptForm) => a.kg.trim() !== '';

const PLACING = /^\d+$/;

/** Why a meet cannot be saved, or null. */
export function meetProblem(
  form: MeetForm,
  library: readonly Exercise[],
  today: IsoDate,
): string | null {
  if (!validDate(form.date, today)) return 'Pick a date that is not in the future.';
  for (const lift of LIFTS) {
    const allowed = new Set(meetExercises(library, lift).map((e) => e.id));
    for (const [i, attempt] of form.lifts[lift].entries()) {
      if (!taken(attempt)) continue;
      const where = `${LIFT_NAMES[lift]} ${i + 1}`;
      if (parseKg(attempt.kg, MAX_RANGE) === null) {
        return `${where}: enter the weight in kilograms, between ${MAX_RANGE.min} and ${MAX_RANGE.max}, or leave it empty.`;
      }
      if (!allowed.has(attempt.exerciseId)) return `${where}: pick the ${lift} that was lifted.`;
    }
  }
  if (form.bodyweight.trim() !== '' && parseKg(form.bodyweight, BODYWEIGHT_RANGE) === null) {
    return `Bodyweight is in kilograms, between ${BODYWEIGHT_RANGE.min} and ${BODYWEIGHT_RANGE.max}.`;
  }
  if (form.placing.trim() !== '') {
    if (!PLACING.test(form.placing.trim()) || Number(form.placing) < 1) {
      return 'Placing is a whole number from 1.';
    }
  }
  const anything =
    form.name.trim() !== '' || LIFTS.some((lift) => form.lifts[lift].some((a) => taken(a)));
  return anything ? null : 'Give the meet a name or at least one attempt.';
}

const text = (value: string): string | null => (value.trim() === '' ? null : value.trim());

/** The meet the form describes, under `from`'s identity. Call only once `meetProblem` is null. */
export function meetFrom(
  form: MeetForm,
  from: Pick<Meet, 'id' | 'created_at' | 'updated_at' | 'device_id'>,
): Meet {
  const slots = (lift: CompetitionLift): MeetAttempts =>
    form.lifts[lift].map((a) => {
      const kg = parseKg(a.kg, MAX_RANGE);
      return taken(a) && kg !== null
        ? { exercise_id: a.exerciseId, weight_kg: kg, good: a.good }
        : null;
    }) as MeetAttempts;
  return {
    id: from.id,
    date: form.date,
    name: text(form.name),
    location: text(form.location),
    federation: text(form.federation),
    weight_class: text(form.weightClass),
    equipment: text(form.equipment),
    bodyweight_kg:
      text(form.bodyweight) === null ? null : parseKg(form.bodyweight, BODYWEIGHT_RANGE),
    placing: text(form.placing) === null ? null : Number(form.placing.trim()),
    notes: text(form.notes),
    lifts: { squat: slots('squat'), bench: slots('bench'), deadlift: slots('deadlift') },
    created_at: from.created_at as Instant,
    updated_at: from.updated_at as Instant,
    device_id: from.device_id,
  };
}

/** What a toast or a delete confirmation calls the meet: its name and total. */
export function meetSaid(meet: Meet): string {
  const total = meetTotal(meet);
  return total === null ? meetTitle(meet) : `${meetTitle(meet)} · ${kgText(total)} kg`;
}
