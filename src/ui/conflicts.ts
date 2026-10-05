import type { LibraryConflict } from '../library/assemble';
import type { ConflictRecord, Exercise, Session, TableRow, Template } from '../model';
import type { ConflictChoice } from '../storage/log';
import { classify } from '../storage/paths';
import { longDate } from './format';
import { formatSet } from './session';

/**
 * A conflict as the resolution screen shows it: what it is about, and both
 * versions as short lines a person can compare, rather than as JSON.
 */
export interface ConflictView {
  id: string;
  what: string;
  /** The version the data holds now: the log's. */
  current: string[];
  /** The version that did not stand, kept in the conflict record. */
  saved: string[];
  /** The two side by side, for highlighting what differs. */
  diff: DiffRow[];
  /** "Two versions of one session". */
  title: string;
  /** What happened, in a sentence: "Thursday 1 October was changed on two devices. Keep one." */
  line: string;
  /** The two versions as the card draws them, this device's first. */
  sides: ConflictSide[];
}

/** A run of text in a line, marked when it is what differs from the other version. */
export interface Span {
  text: string;
  changed: boolean;
}

/** One version of a conflicted record, ready to draw and to keep. */
export interface ConflictSide {
  /** "This phone", the device's own name, or "Another device". */
  device: string;
  /** When this version was last changed, if the record says; an ISO instant. */
  when: string | null;
  /** The `resolveConflict` choice that keeps this version. */
  choice: ConflictChoice;
  /** Each line as runs of words, with the ones that differ marked. */
  lines: Span[][];
}

/** Which device is this one, and what the lifter calls it. */
export interface DeviceNames {
  /** This device's id, as the conflict records carry it. */
  id: string;
  /** `prefs.deviceName`; empty when never set. */
  name: string;
}

/**
 * One row of the two versions laid side by side. A line only one side has
 * leaves the other cell null; two different lines in the same place share a row
 * so the screen can show them facing each other.
 */
export interface DiffRow {
  current: string | null;
  saved: string | null;
  /** Both cells hold the same line; every other row is highlighted. */
  same: boolean;
}

/**
 * Lines aligned by their longest common run, so one inserted line does not mark
 * every line after it as changed, which a comparison line by line would. Between
 * two matching lines, what each side has left over is paired off in order.
 */
export function diffLines(current: readonly string[], saved: readonly string[]): DiffRow[] {
  // lcs[i][j]: the longest common run of current[i..] and saved[j..].
  const lcs = Array.from({ length: current.length + 1 }, () =>
    new Array<number>(saved.length + 1).fill(0),
  );
  for (let i = current.length - 1; i >= 0; i--) {
    for (let j = saved.length - 1; j >= 0; j--) {
      lcs[i][j] =
        current[i] === saved[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let onlyCurrent: string[] = [];
  let onlySaved: string[] = [];
  const flush = () => {
    for (let k = 0; k < Math.max(onlyCurrent.length, onlySaved.length); k++) {
      rows.push({ current: onlyCurrent[k] ?? null, saved: onlySaved[k] ?? null, same: false });
    }
    onlyCurrent = [];
    onlySaved = [];
  };

  let i = 0;
  let j = 0;
  while (i < current.length || j < saved.length) {
    if (i < current.length && j < saved.length && current[i] === saved[j]) {
      flush();
      rows.push({ current: current[i], saved: saved[j], same: true });
      i++;
      j++;
    } else if (j >= saved.length || (i < current.length && lcs[i + 1][j] >= lcs[i][j + 1])) {
      onlyCurrent.push(current[i++]);
    } else {
      onlySaved.push(saved[j++]);
    }
  }
  flush();
  return rows;
}

/**
 * Words and the gaps between them, so a number is one piece ("8.5" is not "8"
 * and ".5") and the marks fall on whole figures.
 */
function tokens(text: string): string[] {
  return text.match(/\p{N}+(?:[.,]\p{N}+)*|\p{L}+(?:['’-]\p{L}+)*|\s+|./gu) ?? [];
}

/**
 * Two lines compared word by word: what is left of each once their common words
 * are taken away is marked changed, so only the figures that differ are
 * painted. A gap between two changed words is changed with them, so one run
 * reads as one mark.
 */
export function diffWords(a: string, b: string): { a: Span[]; b: Span[] } {
  const x = tokens(a);
  const y = tokens(b);
  const lcs = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const markX = new Array<boolean>(x.length).fill(true);
  const markY = new Array<boolean>(y.length).fill(true);
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      markX[i++] = false;
      markY[j++] = false;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
    else j++;
  }
  return { a: spansOf(x, markX), b: spansOf(y, markY) };
}

function spansOf(parts: string[], marked: boolean[]): Span[] {
  const changed = parts.map((part, k) => {
    if (!/^\s+$/.test(part)) return marked[k];
    // A gap is part of a mark only when both neighbours are.
    return k > 0 && k < parts.length - 1 && marked[k - 1] && marked[k + 1];
  });
  const spans: Span[] = [];
  parts.forEach((text, k) => {
    const last = spans.at(-1);
    if (last && last.changed === changed[k]) last.text += text;
    else spans.push({ text, changed: changed[k] });
  });
  return spans;
}

/**
 * The rows of a line diff as one line of spans per version. A line the other
 * version lacks is marked whole; a line it has too is marked word by word. A
 * cell a version lacks draws nothing.
 */
export function markedLines(rows: readonly DiffRow[]): { current: Span[][]; saved: Span[][] } {
  const current: Span[][] = [];
  const saved: Span[][] = [];
  for (const row of rows) {
    if (row.same) {
      current.push([{ text: row.current ?? '', changed: false }]);
      saved.push([{ text: row.saved ?? '', changed: false }]);
      continue;
    }
    const pair = diffWords(row.current ?? '', row.saved ?? '');
    if (row.current !== null) current.push(pair.a);
    if (row.saved !== null) saved.push(pair.b);
  }
  return { current, saved };
}

type Version = Session | Template | TableRow | null;

/** "This phone" or the lifter's own name for this device; any other is "Another device". */
export function deviceLabel(deviceId: string | null, device: DeviceNames): string {
  if (deviceId !== null && deviceId === device.id) return device.name || 'This phone';
  return 'Another device';
}

/** When a version was last changed; only sessions and templates say. */
function whenOf(version: Version): string | null {
  return version !== null && 'updated_at' in version && typeof version.updated_at === 'string'
    ? version.updated_at
    : null;
}

/** The device that made a version, when the record says (sessions and templates do). */
function deviceOf(version: Version): string | null {
  return version !== null && 'device_id' in version && typeof version.device_id === 'string'
    ? version.device_id
    : null;
}

/** What each table's rows are called, as the lifter says it. */
const TABLE_NOUN: Record<string, string> = {
  bodyweight: 'weigh-in',
  oneRm: 'reference max',
  manualRecords: 'record',
  additions: 'exercise',
};

/** The title and sentence a conflict card opens with. */
function wording(
  kind: ReturnType<typeof classify>,
  record: ConflictRecord,
  current: Version,
  names: Map<string, string>,
): { title: string; line: string } {
  const deleted = current === null || record.version === null;
  const about = (noun: string, subject: string) => ({
    title: `Two versions of one ${noun}`,
    line: deleted
      ? `${subject} was deleted on one device and changed on another. Keep one.`
      : `${subject} was changed on two devices. Keep one.`,
  });
  const sample = record.version ?? current;
  const field = (name: string): string | null => {
    const value = (sample as Record<string, unknown> | null)?.[name];
    return typeof value === 'string' ? value : null;
  };
  if (kind.kind === 'session') {
    const date = field('date');
    return about('session', date ? longDate(date) : 'This session');
  }
  if (kind.kind === 'template') {
    const name = field('name');
    return about('template', name ? `The template "${name}"` : 'This template');
  }
  if (kind.kind === 'table') {
    const noun = TABLE_NOUN[kind.table] ?? 'entry';
    const key = keyText(record, names);
    return about(noun, key ? `The ${noun} for ${key}` : `This ${noun}`);
  }
  return about('record', 'This record');
}

/** A table row's key in words: "Sunday 4 October", "Saturday 14 March, Low-Bar Squat, 1 rep". */
function keyText(record: ConflictRecord, names: Map<string, string>): string {
  return Object.entries(record.key ?? {})
    .map(([column, value]) =>
      /^\d{4}-\d\d-\d\d$/.test(value)
        ? longDate(value)
        : column === 'reps' || column === 'exercise_id' || column === 'lift'
          ? cellLine(column, value, names)
          : value,
    )
    .join(', ');
}

export function describeConflict(
  record: ConflictRecord,
  current: Version,
  names: Map<string, string>,
  device: DeviceNames = { id: '', name: '' },
): ConflictView {
  const kind = classify(record.path);
  const what =
    kind.kind === 'table'
      ? `${kind.table}: ${Object.values(record.key ?? {}).join(', ')}`
      : `${kind.kind} ${'id' in kind ? kind.id : record.path}`;
  const currentLines = linesOf(current, names, record.key);
  const savedLines = linesOf(record.version, names, record.key);
  const diff = diffLines(currentLines, savedLines);
  const spans = markedLines(diff);

  const savedBy = deviceLabel(record.device_id, device);
  // A table row does not say who wrote it: with the saved one named, the log's is the other.
  const madeBy = deviceOf(current);
  const currentBy =
    madeBy !== null && madeBy !== record.device_id
      ? deviceLabel(madeBy, device)
      : savedBy === 'Another device'
        ? deviceLabel(device.id, device)
        : 'Another device';
  const sides: ConflictSide[] = [
    { device: currentBy, when: whenOf(current), choice: 'keep_log', lines: spans.current },
    { device: savedBy, when: whenOf(record.version), choice: 'use_saved', lines: spans.saved },
  ];
  // This device's version first, so it is the top card.
  if (sides[0].device === 'Another device' && sides[1].device !== 'Another device') sides.reverse();

  return {
    id: record.id,
    what,
    current: currentLines,
    saved: savedLines,
    diff,
    ...wording(kind, record, current, names),
    sides,
  };
}

/** A library conflict: the app's shipped exercise against the lifter's own addition. */
export interface LibraryConflictView {
  id: string;
  title: string;
  line: string;
  sides: { label: string; lines: Span[][]; keepMine: boolean }[];
}

function exerciseLines(e: Exercise): string[] {
  const aux = e.muscles.aux.length ? ` + ${e.muscles.aux.join('/')}` : '';
  return [
    e.name,
    `${e.tier.replace('_', ' ')}, ${e.base_lift ?? 'no lift'}`,
    `${e.muscles.primary.join('/')}${aux}`,
  ];
}

export function describeLibraryConflict(conflict: LibraryConflict): LibraryConflictView {
  const spans = markedLines(
    diffLines(exerciseLines(conflict.shipped), exerciseLines(conflict.addition)),
  );
  return {
    id: conflict.id,
    title: 'Two versions of one exercise',
    line: `${conflict.addition.name} is in the app's library now, and you had added your own. Keep one.`,
    sides: [
      { label: 'In the app', lines: spans.current, keepMine: false },
      { label: 'Yours', lines: spans.saved, keepMine: true },
    ],
  };
}

/**
 * "today 18:02", "yesterday 18:10", "Thu 1 Oct 17:30": when a version was
 * changed, as short as it can be said.
 */
export function whenLabel(instant: string, now: Date = new Date()): string {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days === 0) return `today ${clock}`;
  if (days === 1) return `yesterday ${clock}`;
  const date = at.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${date.replace(',', '')} ${clock}`;
}

/** The toast after keeping a version: "Kept the version from this phone". */
export function keptMessage(device: string): string {
  return `Kept the version from ${device === 'This phone' || device === 'Another device' ? device.toLowerCase() : device}`;
}

export interface NoticeGate {
  /** A sync found conflicts, or the app launched with some, and the lifter has not said Later. */
  requested: boolean;
  /** Conflicts still unresolved. */
  count: number;
  inSession: boolean;
  /** On the finish screen, which the notice would cover just as the lifter is done. */
  finishing: boolean;
  /** Setup or the new-exercise form is on screen. */
  takeover: boolean;
}

/**
 * Whether the full-screen notice is up. A session only ever gets the banner,
 * and the finish screen waits for Done; a notice asked for meanwhile is still
 * asked for afterwards.
 */
export function noticeShown(gate: NoticeGate): boolean {
  return gate.requested && gate.count > 0 && !gate.inSession && !gate.finishing && !gate.takeover;
}

/**
 * What a conflict is about, as the notice lists it before any is opened:
 * "The session of Friday 2 October", "The weigh-in for Saturday 3 October".
 * Only the record is read, so a deleted version still names its subject.
 */
export function conflictSubject(record: ConflictRecord, names: Map<string, string>): string {
  const kind = classify(record.path);
  const version = record.version as Record<string, unknown> | null;
  const text = (name: string) => {
    const value = version?.[name];
    return typeof value === 'string' ? value : null;
  };
  if (kind.kind === 'session') {
    // A session's id starts with its date, which outlives a deleted version.
    const date = text('date') ?? /^\d{4}-\d\d-\d\d/.exec(kind.id)?.[0] ?? null;
    return date ? `The session of ${longDate(date)}` : 'A session';
  }
  if (kind.kind === 'template') {
    const name = text('name');
    return name ? `The template "${name}"` : 'A template';
  }
  if (kind.kind === 'table') {
    const noun = TABLE_NOUN[kind.table] ?? 'entry';
    const key = keyText(record, names);
    return key ? `The ${noun} for ${key}` : `A ${noun}`;
  }
  return 'A record';
}

/** A library conflict in the notice's list. */
export function libraryConflictSubject(conflict: LibraryConflict): string {
  return `The exercise "${conflict.addition.name}"`;
}

/** The notice's words: how many, and that nothing was lost. */
export function noticeCopy(count: number): { title: string; line: string } {
  const one = count === 1;
  return {
    title: one ? '1 conflict to settle' : `${count} conflicts to settle`,
    line: `${one ? 'Two devices changed the same thing' : 'Two devices changed the same things'}. Nothing was lost: both versions are kept until you pick one.`,
  };
}

/**
 * One version as lines to compare. The session's date is in the card's title,
 * so it is not repeated; warm-ups get a line of their own so a difference in
 * them is still seen without crowding the working sets.
 */
function linesOf(version: Version, names: Map<string, string>, key: TableRow | null): string[] {
  if (version === null) return ['deleted'];
  if (isSession(version)) {
    return [
      ...version.exercises.flatMap((e) => {
        const name = names.get(e.exercise_id) ?? e.exercise_id;
        const done = e.performed.filter((s) => s.state === 'done');
        const sets = (warmup: boolean) =>
          done
            .filter((s) => s.is_warmup === warmup)
            .map((s) => formatSet(s))
            .join(', ');
        return [
          `${name}: ${sets(false) || 'no sets'}`,
          ...(sets(true) ? [`${name} warm-up: ${sets(true)}`] : []),
        ];
      }),
      ...(version.notes ? [`Notes: ${version.notes}`] : []),
    ];
  }
  if (isTemplate(version)) {
    return [
      version.name,
      ...version.exercises.map(
        (e) => `${names.get(e.exercise_id) ?? e.exercise_id}: ${e.prescribed.length} sets`,
      ),
    ];
  }
  // The key names the row, and the title already says it. An empty cell has
  // nothing to say; a difference in it still shows as a line on one side only.
  return Object.entries(version)
    .filter(([column, value]) => !(key && column in key) && value !== '')
    .map(([column, value]) => cellLine(column, value, names));
}

/** A table row's cell as the lifter would say it: "83.4 kg", "5 reps", "entered by hand". */
function cellLine(column: string, value: string, names: Map<string, string>): string {
  switch (column) {
    case 'weight_kg':
      return `${value} kg`;
    case 'reps':
      return `${value} ${value === '1' ? 'rep' : 'reps'}`;
    case 'rpe':
      return `@ ${value}`;
    case 'exercise_id':
      return names.get(value) ?? value;
    case 'lift':
      return value.charAt(0).toUpperCase() + value.slice(1);
    case 'source':
      return value === 'manual' ? 'entered by hand' : value === 'import' ? 'imported' : value;
    case 'note':
    case 'context':
      return `“${value}”`;
    default:
      return `${column.replaceAll('_', ' ')}: ${value}`;
  }
}

/** A session has exercises and a start; a template has exercises only; a table row neither. */
function isSession(v: Session | Template | TableRow): v is Session {
  return 'exercises' in v && 'started_at' in v;
}

function isTemplate(v: Session | Template | TableRow): v is Template {
  return 'exercises' in v && !('started_at' in v);
}

/** Names by id, for showing exercises in a conflict. */
export function exerciseNames(library: Exercise[]): Map<string, string> {
  return new Map(library.map((e) => [e.id, e.name]));
}
