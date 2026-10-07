import { toKg } from '../metrics/load';
import {
  formatInterval,
  isComplete,
  type Exercise,
  type ExerciseInstance,
  type Id,
  type IsoDate,
  type Load,
  type LoadPrescription,
  type LoadUnit,
  type PerformedSet,
  type PrescribedSet,
  type Session,
  type Template,
} from '../model';

/**
 * What the session screen does to a session, as pure functions: each takes a
 * session and returns the next one, which the screen saves. Ids come from the
 * caller, so the same edit gives the same session.
 */

export type NewId = () => Id;

/** The calendar date at `at` where the lifter is: the session's aggregation key. */
export function localDate(at: Date): IsoDate {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** A session started now, or with `planned`, one filled in ahead and started later. */
export function newSession(input: {
  id: Id;
  at: Date;
  tz: string;
  deviceId: string;
  planned?: boolean;
}): Session {
  const now = input.at.toISOString();
  return {
    id: input.id,
    date: localDate(input.at),
    started_at: input.planned ? null : now,
    tz: input.tz,
    time_precision: 'instant',
    ended_at: null,
    label: { name: null, block: null, week: null, day: null, weekday: null },
    bodyweight_kg: null,
    notes: null,
    exercises: [],
    created_at: now,
    updated_at: now,
    device_id: input.deviceId,
  };
}

/**
 * What a set of this exercise measures. The library says how an exercise is
 * loaded, not whether unloaded work is timed or measured in distance; held
 * positions are the unloaded work it holds, so unloaded means timed.
 */
export function measureOf(exercise: Exercise): 'weight' | 'time' {
  return exercise.load_type === 'none' ? 'time' : 'weight';
}

function emptySet(id: Id, prescribedId: Id | null = null): PerformedSet {
  return {
    id,
    prescribed_id: prescribedId,
    state: 'pending',
    reps: null,
    rpe: null,
    load: null,
    is_warmup: false,
    notes: null,
  };
}

export function addExercise(session: Session, exercise: Exercise, newId: NewId): Session {
  const instance: ExerciseInstance = {
    id: newId(),
    exercise_id: exercise.id,
    rest_s: null,
    prescribed: [],
    performed: [emptySet(newId())],
    notes: null,
  };
  return { ...session, exercises: [...session.exercises, instance] };
}

/**
 * A target rest as the log keeps one: whole seconds, at least one, since the
 * format refuses anything else (DATA.md, The files). Null, and anything that is
 * not a number of seconds, is the tier's default.
 */
export function restSeconds(seconds: number | null): number | null {
  return seconds === null || !Number.isFinite(seconds) ? null : Math.max(1, Math.round(seconds));
}

/** The exercise's target rest for the rest of this session. */
export function setRest(session: Session, instanceId: Id, seconds: number | null): Session {
  return updateInstance(session, instanceId, (e) => ({ ...e, rest_s: restSeconds(seconds) }));
}

function updateInstance(
  session: Session,
  instanceId: Id,
  update: (instance: ExerciseInstance) => ExerciseInstance,
): Session {
  return {
    ...session,
    exercises: session.exercises.map((e) => (e.id === instanceId ? update(e) : e)),
  };
}

function updateSet(
  session: Session,
  instanceId: Id,
  setId: Id,
  update: (set: PerformedSet) => PerformedSet,
): Session {
  return updateInstance(session, instanceId, (e) => ({
    ...e,
    performed: e.performed.map((s) => (s.id === setId ? update(s) : s)),
  }));
}

/**
 * A new set after the last one. The next set is usually the same load for the
 * same reps, so a weighted set copies those; never the RPE, which is what the
 * set turns out to feel like, so the copy stays pending until it is lifted. A
 * timed set copies nothing: its time is all it holds, and a copy would count as
 * done before it was held.
 */
export function addSet(session: Session, instanceId: Id, newId: NewId): Session {
  return updateInstance(session, instanceId, (e) => {
    const last = e.performed.at(-1);
    const next = emptySet(newId());
    if (last?.load?.kind === 'weight') {
      next.load = last.load;
      next.reps = last.reps;
    }
    return { ...e, performed: [...e.performed, next] };
  });
}

export interface SetEdit {
  /** The number typed as the load: kilograms, pounds or pins; seconds for timed work. Null clears it. */
  amount?: number | null;
  unit?: LoadUnit;
  reps?: number | null;
  rpe?: number | null;
  is_warmup?: boolean;
}

/**
 * One field of a set changed. Whether the set is done follows from its values
 * (`isComplete`): there is nothing to tick, and a set left blank, such as an
 * untouched target, stays pending.
 */
export function editSet(
  session: Session,
  instanceId: Id,
  setId: Id,
  edit: SetEdit,
  measure: 'weight' | 'time',
  defaultUnit: LoadUnit,
): Session {
  return updateSet(session, instanceId, setId, (set) => {
    const next: PerformedSet = { ...set };
    if (edit.reps !== undefined) next.reps = measure === 'time' ? null : edit.reps;
    if (edit.rpe !== undefined) next.rpe = edit.rpe;
    if (edit.is_warmup !== undefined) next.is_warmup = edit.is_warmup;
    if (edit.amount !== undefined || edit.unit !== undefined) {
      const amount = edit.amount !== undefined ? edit.amount : amountOf(set);
      if (amount === null) next.load = null;
      else if (measure === 'time') next.load = { kind: 'time', seconds: amount };
      else
        next.load = {
          kind: 'weight',
          value: amount,
          unit: edit.unit ?? unitOf(set) ?? defaultUnit,
        };
    }
    next.state = isComplete(next) ? 'done' : 'pending';
    return next;
  });
}

/**
 * A set filled in ahead, in a session not started yet. Its numbers are what is
 * to be lifted, not what was, so it stays pending whatever it holds (a warm-up
 * or a hold would otherwise count as done) and takes no RPE, which is what the
 * set will feel like once it is lifted.
 */
export function planSet(
  session: Session,
  instanceId: Id,
  setId: Id,
  edit: SetEdit,
  measure: 'weight' | 'time',
  defaultUnit: LoadUnit,
): Session {
  const { rpe: _felt, ...numbers } = edit;
  const next = editSet(session, instanceId, setId, numbers, measure, defaultUnit);
  return updateSet(next, instanceId, setId, (set) => ({ ...set, state: 'pending' }));
}

/** The number a set's load holds, whatever it measures. */
export function amountOf(set: PerformedSet): number | null {
  if (!set.load) return null;
  if (set.load.kind === 'weight') return set.load.value;
  return set.load.kind === 'time' ? set.load.seconds : set.load.meters;
}

export function unitOf(set: PerformedSet): LoadUnit | null {
  return set.load?.kind === 'weight' ? set.load.unit : null;
}

/**
 * Skips a set: planned, deliberately not done. A skipped set holds no numbers;
 * typing into it again makes it an ordinary set.
 */
export function skipSet(session: Session, instanceId: Id, setId: Id, skipped: boolean): Session {
  return updateSet(session, instanceId, setId, (set) =>
    skipped
      ? { ...set, state: 'skipped', load: null, reps: null, rpe: null }
      : { ...set, state: 'pending' },
  );
}

export function setExerciseNotes(session: Session, instanceId: Id, notes: string): Session {
  return updateInstance(session, instanceId, (e) => ({
    ...e,
    notes: notes.trim() === '' ? null : notes,
  }));
}

/** How many sets are done: one more than before means a set was just finished. */
export function doneCount(session: Session): number {
  return session.exercises.reduce(
    (n, e) => n + e.performed.filter((s) => s.state === 'done').length,
    0,
  );
}

/** The set moved `by` places among its exercise's sets; its target, if it has one, goes with it. */
export function moveSet(session: Session, instanceId: Id, setId: Id, by: number): Session {
  return updateInstance(session, instanceId, (e) => {
    const at = e.performed.findIndex((s) => s.id === setId);
    return at === -1 ? e : { ...e, performed: move(e.performed, at, by) };
  });
}

/**
 * A copy right after the set: its load and reps, warm-up or not, but never its
 * RPE, and pending until it is lifted, as a new set is (`addSet`). It fulfils
 * no target, which stays with the set it was planned for.
 */
export function duplicateSet(session: Session, instanceId: Id, setId: Id, newId: NewId): Session {
  return updateInstance(session, instanceId, (e) => ({
    ...e,
    performed: e.performed.flatMap((s) => {
      if (s.id !== setId) return [s];
      const copy: PerformedSet = {
        ...emptySet(newId()),
        is_warmup: s.is_warmup,
        load: s.state === 'skipped' ? null : s.load,
        reps: s.state === 'skipped' ? null : s.reps,
      };
      return [s, copy];
    }),
  }));
}

/** What a copied set holds for pasting: what was loaded, and for how many. */
export interface SetCopy {
  load: Load;
  reps: number | null;
}

/** The set as copied, or null for one with nothing loaded yet. */
export function copyOf(set: PerformedSet): SetCopy | null {
  return set.load ? { load: set.load, reps: set.reps } : null;
}

/**
 * The edit pasting `copy` makes to a set measured by `measure`: the load and
 * the reps, never the RPE, which is what this set felt like; null when the copy
 * measures something else (a hold pasted onto a squat).
 */
export function pasteEdit(copy: SetCopy, measure: 'weight' | 'time'): SetEdit | null {
  if (copy.load.kind === 'weight' && measure === 'weight') {
    return { amount: copy.load.value, unit: copy.load.unit, reps: copy.reps };
  }
  if (copy.load.kind === 'time' && measure === 'time') return { amount: copy.load.seconds };
  return null;
}

export function removeSet(session: Session, instanceId: Id, setId: Id): Session {
  return updateInstance(session, instanceId, (e) => ({
    ...e,
    performed: e.performed.filter((s) => s.id !== setId),
  }));
}

export function removeExercise(session: Session, instanceId: Id): Session {
  return { ...session, exercises: session.exercises.filter((e) => e.id !== instanceId) };
}

/** The list with the item at `from` moved `by` places, staying within the list. */
export function move<T>(list: T[], from: number, by: number): T[] {
  const to = Math.min(Math.max(from + by, 0), list.length - 1);
  if (from < 0 || from >= list.length || to === from) return list;
  const next = [...list];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/** An exercise moved up (`by` < 0) or down the session; order is array order. */
export function moveExercise(session: Session, instanceId: Id, by: number): Session {
  const from = session.exercises.findIndex((e) => e.id === instanceId);
  return { ...session, exercises: move(session.exercises, from, by) };
}

/**
 * Moves a session to another date. A session dated other than the day it was
 * started on was logged after the fact, so its clock time says nothing about
 * when it happened, and analysis must not read it as if it did.
 */
export function setDate(session: Session, date: IsoDate): Session {
  // A planned session gets its clock time when it starts.
  const sameDay = session.started_at === null || date === localDate(new Date(session.started_at));
  return { ...session, date, time_precision: sameDay ? 'instant' : 'date_only' };
}

/** Starts a planned session: it happens now, today, whenever it was planned for. */
export function start(session: Session, at: Date): Session {
  return {
    ...session,
    started_at: at.toISOString(),
    date: localDate(at),
    time_precision: 'instant',
  };
}

/**
 * A session being lifted now: started, not finished, and timed to the instant.
 * One logged after the fact is open too, but dated by the day only, its clock
 * says nothing about now: nothing in it rests, rings or keeps the screen on.
 */
export function isLive(session: Session): boolean {
  return (
    session.started_at !== null && session.ended_at === null && session.time_precision === 'instant'
  );
}

export function finish(session: Session, at: Date): Session {
  return { ...session, ended_at: at.toISOString() };
}

/** A bodyweight-plus set counts the lifter's bodyweight, which the session must hold. */
export function needsBodyweight(session: Session, exercise: Exercise): boolean {
  return exercise.load_type === 'bw_plus' && session.bodyweight_kg === null;
}

// --- what came before ---------------------------------------------------------------

/** "140 × 5 @ 8", "1:30", "+20 × 8 @ 7" for a bodyweight-plus set. */
export function formatSet(set: PerformedSet, exercise?: Exercise): string {
  const load = set.load;
  let text = '';
  if (load?.kind === 'time') text = formatSeconds(load.seconds);
  else if (load?.kind === 'distance') text = `${load.meters} m`;
  else if (load?.kind === 'weight') {
    const value =
      exercise?.load_type === 'bw_plus' && load.value >= 0 ? `+${load.value}` : `${load.value}`;
    text = `${value}${load.unit === 'kg' ? '' : ` ${load.unit}`}`;
  }
  if (set.reps !== null) text += `${text ? ' × ' : ''}${set.reps}`;
  if (set.rpe !== null) text += ` @ ${set.rpe}`;
  return text.trim();
}

export function formatSeconds(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s} s`;
}

/** The most recent other session holding this exercise, newest first by date and start. */
export function lastInstance(
  exerciseId: string,
  sessions: Session[],
  except: Id,
): ExerciseInstance | null {
  const ordered = [...sessions].sort(
    (a, b) =>
      b.date.localeCompare(a.date) || (b.started_at ?? '').localeCompare(a.started_at ?? ''),
  );
  for (const session of ordered) {
    if (session.id === except) continue;
    const found = session.exercises.find(
      (e) => e.exercise_id === exerciseId && e.performed.some((s) => s.state === 'done'),
    );
    if (found) return found;
  }
  return null;
}

/** The done sets of this exercise in the last other session that had it. */
export function lastTime(exercise: Exercise, sessions: Session[], except: Id): string | null {
  const found = lastInstance(exercise.id, sessions, except);
  if (!found) return null;
  return found.performed
    .filter((s) => s.state === 'done')
    .map((s) => formatSet(s, exercise))
    .join(', ');
}

export interface HistoryEntry {
  session: Session;
  /** The exercise's done sets that day, as `formatSet` writes them. */
  sets: string[];
}

/** Every session that did this exercise, newest first, with its done sets. */
export function historyOf(exercise: Exercise, sessions: Session[]): HistoryEntry[] {
  return [...sessions]
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) || (b.started_at ?? '').localeCompare(a.started_at ?? ''),
    )
    .flatMap((session) => {
      const sets = session.exercises
        .filter((e) => e.exercise_id === exercise.id)
        .flatMap((e) => e.performed.filter((s) => s.state === 'done'))
        .map((s) => formatSet(s, exercise));
      return sets.length ? [{ session, sets }] : [];
    });
}

/** The unit this exercise was last logged in; gyms differ, so a habit beats the library's hint. */
export function lastUnit(exercise: Exercise, sessions: Session[], except: Id): LoadUnit {
  const found = lastInstance(exercise.id, sessions, except);
  const unit = found?.performed.map(unitOf).find((u) => u !== null);
  return unit ?? exercise.default_unit;
}

/**
 * The unit a set is entered in: its own, else today's. A lifter who switched
 * units in this session means it for the sets still to come, so this session
 * speaks before the past: the unit last picked for the exercise (`chosen`, which
 * an empty set cannot hold), else the nearest earlier weighted set of the
 * instance, else the latest weighted set of the exercise anywhere in the
 * session. Only then the habit of past sessions (`lastUnit`), and last the
 * library's hint.
 */
export function unitFor(input: {
  session: Session;
  instance: ExerciseInstance;
  set: PerformedSet;
  exercise: Exercise | undefined;
  sessions: Session[];
  chosen?: LoadUnit | null;
}): LoadUnit {
  const { session, instance, set, exercise } = input;
  const picked = unitOf(set) ?? input.chosen;
  if (picked) return picked;
  const at = instance.performed.findIndex((s) => s.id === set.id);
  const earlier = instance.performed
    .slice(0, Math.max(at, 0))
    .map(unitOf)
    .findLast((u) => u !== null);
  if (earlier) return earlier;
  const today = session.exercises
    .filter((e) => e.exercise_id === instance.exercise_id)
    .flatMap((e) => e.performed.map(unitOf))
    .findLast((u) => u !== null);
  if (today) return today;
  return exercise ? lastUnit(exercise, input.sessions, session.id) : 'kg';
}

// --- templates ----------------------------------------------------------------------

/** A session's done sets as the targets of a template. */
export function templateFrom(
  session: Session,
  input: { id: Id; name: string; at: Date },
): Template {
  const now = input.at.toISOString();
  return {
    id: input.id,
    name: input.name,
    intention: null,
    label: { ...session.label },
    exercises: session.exercises
      .map((e) => ({
        exercise_id: e.exercise_id,
        rest_s: e.rest_s,
        prescribed: e.performed.filter((s) => s.state === 'done').map(prescriptionOf),
      }))
      .filter((e) => e.prescribed.length > 0),
    created_at: now,
    updated_at: now,
  };
}

function prescriptionOf(set: PerformedSet): Omit<PrescribedSet, 'id'> {
  const exactly = (n: number | null): [number | null, number | null] | null =>
    n === null ? null : [n, n];
  let load: LoadPrescription = { kind: 'weight', weight: { mode: 'rpe_driven' } };
  if (set.load?.kind === 'time')
    load = { kind: 'time', seconds: [set.load.seconds, set.load.seconds] };
  else if (set.load?.kind === 'distance')
    load = { kind: 'distance', meters: [set.load.meters, set.load.meters] };
  else if (set.load?.kind === 'weight') {
    // A prescription is in kilograms; a pin setting has none, so RPE decides it.
    const kg = toKg(set.load.value, set.load.unit);
    if (kg !== null) {
      const round = Math.round(kg * 100) / 100;
      load = { kind: 'weight', weight: { mode: 'absolute', kg: [round, round] } };
    }
  }
  return {
    reps: exactly(set.reps),
    rpe: exactly(set.rpe),
    load,
    is_warmup: set.is_warmup,
    notes: null,
  };
}

/**
 * A new session's exercises from a template: its targets prescribed, one
 * pending set for each, its target rests; and the template's program label.
 */
export function fromTemplate(session: Session, template: Template, newId: NewId): Session {
  const exercises: ExerciseInstance[] = template.exercises.map((e) => {
    const prescribed = e.prescribed.map((p) => ({ ...p, id: newId() }));
    return {
      id: newId(),
      exercise_id: e.exercise_id,
      rest_s: e.rest_s,
      prescribed,
      performed: prescribed.map((p) => ({ ...emptySet(newId(), p.id), is_warmup: p.is_warmup })),
      notes: null,
    };
  });
  return {
    ...session,
    label: { ...template.label },
    exercises: [...session.exercises, ...exercises],
  };
}

/** What a set's prescription asks for, field by field, shown faintly in its empty fields. */
export function targetsOf(
  instance: ExerciseInstance,
  set: PerformedSet,
): { amount: string; reps: string; rpe: string } {
  const p = instance.prescribed.find((x) => x.id === set.prescribed_id);
  const low = (i: [number | null, number | null] | null | undefined) =>
    i ? formatInterval(i) : '';
  if (!p) return { amount: '', reps: '', rpe: '' };
  let amount = '';
  if (p.load.kind === 'time')
    amount = p.load.seconds[0] === null ? '' : formatSeconds(p.load.seconds[0]);
  else if (p.load.kind === 'weight' && p.load.weight.mode === 'absolute')
    amount = low(p.load.weight.kg);
  return { amount, reps: low(p.reps), rpe: low(p.rpe) };
}

// --- what was typed ---------------------------------------------------------------

/**
 * A number typed into a set's field: `null` for an empty field, `undefined` for
 * one that is not a number, which the field then ignores. A comma is a decimal
 * point, as phones in most locales type it.
 */
export function parseNumber(text: string): number | null | undefined {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Seconds, typed as `90` or `1:30`. */
export function parseSeconds(text: string): number | null | undefined {
  const match = /^\s*(\d+):([0-5]?\d)\s*$/.exec(text);
  return match ? Number(match[1]) * 60 + Number(match[2]) : parseNumber(text);
}

/** An RPE as the chart reads it: 1 to 10, in halves. */
export function parseRpe(text: string): number | null | undefined {
  const n = parseNumber(text);
  if (n === null || n === undefined) return n;
  return n >= 1 && n <= 10 && Number.isInteger(n * 2) ? n : undefined;
}

// --- new exercises ------------------------------------------------------------------

/** An exercise's id from its name, as the library spells ids: `low_bar_squat`. */
export function exerciseIdFrom(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Why a name cannot be an exercise's, or null. The submission workflow refuses
 * commas and quotes, which would split the library's row, and `#` and `@`,
 * which GitHub would read as a link or a mention.
 */
export function nameProblem(name: string): string | null {
  if (name.trim() === '') return 'Give it a name.';
  if (/[,"#@]/.test(name)) return 'No commas, double quotes, # or @ in the name.';
  if (exerciseIdFrom(name) === '') return 'The name needs a letter or a digit.';
  return null;
}
