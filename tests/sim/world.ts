import { csvLine } from '../../src/csv';
import type { Exercise, Session, Template } from '../../src/model';
import type { Mode } from '../../src/storage/decide';
import { SyncError } from '../../src/storage/errors';
import {
  parseSession,
  parseTemplate,
  rowKey,
  rowLine,
  serializeSession,
  serializeTemplate,
  TABLES,
  tableRows,
  tableText,
  type RecordOf,
  type TableSchema,
} from '../../src/storage/formats';
import { ID_ALPHABET } from '../../src/storage/ids';
import { Log, type ConflictChoice } from '../../src/storage/log';
import { classify, FORMAT_PATH, isOurs, type TableKind } from '../../src/storage/paths';
import { MemoryRemote, type RemoteOp } from '../../src/storage/remote/memory';
import type {
  NewCommit,
  Remote,
  RemoteChange,
  RemoteTree,
  RepoInfo,
} from '../../src/storage/remote/remote';
import { MemoryStore } from '../../src/storage/store/memory';
import type { Exclusive, LocalStore, StoreOp, StoreReader } from '../../src/storage/store/store';
import { runSync, type SyncResult } from '../../src/storage/sync';
import { MARKER, prng } from '../sync-harness';
import {
  basesOf,
  forgetParsed,
  keyOf,
  Oracle,
  pathOf,
  SimFailure,
  TOKEN_COLUMN,
  valuesOf,
  type Place,
  type Value,
} from './oracle';
import type { Fault, Kind, Schedule, Step, Write } from './schedule';

/**
 * The simulated world: two or three devices, each
 * a `Log` over its own `MemoryStore`, all syncing through one `MemoryRemote`,
 * on one clock that moves a minute per step, and the lifter editing the log on
 * github.com besides. `run` plays a schedule, then heals the network and lets
 * every device sync until nothing changes, then checks every invariant. A
 * broken one throws `SimFailure`.
 *
 * Each sync runs through a store and a remote of its own that wrap the device's
 * and the log's. They inject the schedule's faults, and they tell the oracle
 * what the sync decided and what it committed, which is all it
 * needs to know who has seen what.
 */

const START = Date.parse('2026-09-27T10:00:00.000Z');
const NAMES = ['A', 'B', 'C'];

function exercise(id: string): Exercise {
  const lift = id === 'low_bar_squat' ? 'squat' : id === 'comp_bench' ? 'bench' : null;
  return {
    id,
    name: id,
    base_lift: lift,
    tier: lift === null ? 'acc' : 'comp',
    unilateral: false,
    load_type: 'external',
    default_unit: 'kg',
    muscles: { primary: [lift === null ? 'lats' : 'quads'], aux: [] },
  };
}

/** The shipped library every device runs with. */
const SHIPPED: Exercise[] = [exercise('low_bar_squat'), exercise('comp_bench')];

// Row keys. Few, so that devices often log the same one.
const WEIGH_INS = ['2026-09-20', '2026-09-21', '2026-09-22'];
const ONE_RMS = [
  ['2026-09-01', 'squat'],
  ['2026-09-01', 'bench'],
  ['2026-09-15', 'squat'],
] as const;
const RECORDS = [
  ['2026-06-01', 'low_bar_squat', 1],
  ['2026-06-01', 'low_bar_squat', 3],
  ['2026-06-02', 'comp_bench', 1],
] as const;
const BESTS = [
  ['2026-05-16', 'low_bar_squat'],
  ['2026-05-16', 'sumo_deadlift'],
  ['2026-11-07', 'bench'],
] as const;
/** A shipped exercise the lifter changes, and two of their own. */
const ADDITIONS = ['low_bar_squat', 'seal_row', 'zercher_squat'];

/** A weigh-in's weight is its version: unique per write. */
const weight = (n: number) => 50 + n;

/** Four id characters for a counter, so every record created has an id no one has used. */
function suffix(n: number): string {
  let s = '';
  for (let i = 0; i < 4; i++, n = Math.floor(n / ID_ALPHABET.length)) {
    s = ID_ALPHABET[n % ID_ALPHABET.length] + s;
  }
  return s;
}

/**
 * A file as the lifter leaves it after editing it on github.com. By hand, or
 * when only rewriting it, it is not in the app's form (DATA.md, Serialisation): JSON on one line,
 * table rows in reverse order with Windows line endings.
 */
function edited(
  text: string,
  place: Place,
  op: 'edit' | 'reformat' | 'delete',
  n: number,
  hand: boolean,
): string | null {
  const kind = classify(pathOf(place));
  const byHand = hand || op === 'reformat';
  if (kind.kind === 'session') {
    if (op === 'delete') return null;
    const session: Session = { ...parseSession(text), ...(op === 'edit' && { notes: `v${n}` }) };
    return byHand ? `${JSON.stringify(session)}\n` : serializeSession(session);
  }
  if (kind.kind === 'template') {
    if (op === 'delete') return null;
    const template: Template = {
      ...parseTemplate(text),
      ...(op === 'edit' && { intention: `v${n}` }),
    };
    return byHand ? `${JSON.stringify(template)}\n` : serializeTemplate(template);
  }
  if (kind.kind !== 'table') return text;
  const schema = TABLES[kind.table];
  const token = kind.table === 'bodyweight' ? String(weight(n)) : `v${n}`;
  const rows = tableRows(schema, text)
    .filter((row) => op !== 'delete' || rowKey(schema, row) !== keyOf(place))
    .map((row) =>
      op === 'edit' && rowKey(schema, row) === keyOf(place)
        ? { ...row, [TOKEN_COLUMN[kind.table]]: token }
        : row,
    );
  if (rows.length === 0) return null;
  if (!byHand) return tableText(schema, rows);
  const lines = [csvLine(schema.columns), ...rows.reverse().map((row) => rowLine(schema, row))];
  return lines.map((line) => `${line}\r\n`).join('');
}

function kindOf(place: Place): Kind | 'conflict' | null {
  const kind = classify(pathOf(place));
  switch (kind.kind) {
    case 'session':
    case 'template':
    case 'conflict':
      return kind.kind;
    case 'table':
      return kind.table;
    default:
      return null;
  }
}

class Device {
  disk: MemoryStore;
  log: Log;
  readonly random: () => number;

  constructor(
    readonly name: string,
    readonly id: string,
    seed: number,
    private readonly now: () => Date,
  ) {
    this.random = prng(seed);
    this.disk = new MemoryStore({ now, deviceId: id });
    this.log = this.open();
  }

  /** Killed and relaunched: only what reached the disk survives. */
  restart(): void {
    this.disk = this.disk.restart();
    this.log = this.open();
  }

  private open(): Log {
    return new Log(this.disk, { deviceId: this.id, shipped: SHIPPED, now: this.now });
  }
}

/**
 * Bugs planted on purpose, to show the simulation catches each kind: a test of
 * the oracle, never used otherwise.
 */
export interface Sabotage {
  /** The store never records the commit in flight. */
  forgetInflight?: boolean;
  /** Recovery is told no recorded commit ever landed. */
  denyLanding?: boolean;
  /** Conflict records a sync saves never reach the device. */
  dropConflicts?: boolean;
  /** Deletions a sync takes never reach the device. */
  dropDeletions?: boolean;
  /** A commit leaves out the sessions it was given, while the sync settles as if it had them. */
  dropPushes?: boolean;
  /** The head is never recorded as synced. */
  forgetHead?: boolean;
}

export class World {
  readonly remote = new MemoryRemote();
  readonly devices: Device[];
  readonly oracle: Oracle;
  readonly now = () => new Date(this.time);
  private time = START;
  /** Writes so far: every write's version, and every new record's id, comes from it. */
  private written = 0;
  private busied = 0;
  private readonly syncing = new Set<Device>();
  private races: Promise<unknown> = Promise.resolve();
  /** What the schedule actually exercised, by name, for checking the generator covers it. */
  readonly stats = new Map<string, number>();

  count(what: string): void {
    this.stats.set(what, (this.stats.get(what) ?? 0) + 1);
  }

  constructor(
    readonly schedule: Schedule,
    readonly sabotage: Sabotage = {},
  ) {
    forgetParsed();
    const head = this.remote.externalCommit(
      [{ path: FORMAT_PATH, content: MARKER }],
      'Start the training log',
    );
    this.devices = schedule.seeds.map(
      (seed, i) => new Device(NAMES[i], `dev-${NAMES[i].toLowerCase()}`, seed, this.now),
    );
    this.oracle = new Oracle(
      head,
      this.devices.map((d) => d.id),
    );
  }

  /** Plays the schedule, heals, and checks every invariant. */
  async run(): Promise<void> {
    for (const [i, step] of this.schedule.steps.entries()) {
      this.oracle.step = `step ${i + 1}`;
      await this.execute(step);
      await this.mirror();
    }
    this.oracle.step = 'healing';
    await this.heal();
    await this.checkEnd();
  }

  async execute(step: Step): Promise<void> {
    this.time += 60_000;
    switch (step.do) {
      case 'write':
        return this.write(this.devices[step.device], step.write);
      case 'clash':
        return this.clash(step.devices, step.pick, step.deletes);
      case 'resolve':
        return this.resolve(step.devices, step.pick, step.choices);
      case 'sync':
        await this.sync(this.devices[step.device], step.mode, step.faults);
        return;
      case 'restart':
        this.devices[step.device].restart();
        return;
      case 'web':
        return this.web(step.op, step.pick, step.hand);
    }
  }

  /** The lifter changes the log on github.com, with no device involved. */
  private web(op: 'edit' | 'reformat' | 'delete', pick: number, hand: boolean): void {
    const files = appFiles(this.remote.files());
    const places = [...valuesOf(files).keys()].filter((p) => {
      const kind = kindOf(p);
      return kind !== null && kind !== 'conflict';
    });
    if (places.length === 0) return;
    const place = places[pick % places.length];
    const path = pathOf(place);
    const content = edited(files.get(path)!, place, op, ++this.written, hand);
    if (content === files.get(path)) return;
    const changes = [{ path, content }];
    this.oracle.edited(this.remote.externalCommit(changes, 'Edited on github.com'), changes);
    this.count('edited on github.com');
  }

  // --- the lifter -------------------------------------------------------------------

  private async write(device: Device, write: Write): Promise<void> {
    const n = ++this.written;
    await this.recorded(device, async () => {
      if (write.op === 'create') return this.create(device, write.kind, write.pick, n);
      const held = [...(await this.values(device)).keys()].filter((p) => kindOf(p) === write.kind);
      if (held.length === 0) return;
      const place = held[write.pick % held.length];
      if (write.op === 'edit') await this.edit(device, place, n);
      else await this.remove(device, place);
    });
  }

  /** Two devices change one record both hold, neither having seen the other's change. */
  private async clash(
    pair: [number, number],
    pick: number,
    deletes: [boolean, boolean],
  ): Promise<void> {
    const devices = pair.map((d) => this.devices[d]);
    const [mine, theirs] = [await this.values(devices[0]), await this.values(devices[1])];
    const both = [...mine.keys()].filter((p) => theirs.has(p) && kindOf(p) !== 'conflict');
    if (both.length === 0) return;
    const place = both[pick % both.length];
    this.count('clashed');
    for (const [i, device] of devices.entries()) {
      const n = ++this.written;
      await this.recorded(device, () =>
        deletes[i] ? this.remove(device, place) : this.edit(device, place, n),
      );
    }
  }

  /** Devices resolve one conflict record they all hold, one after the other, before any syncs. */
  private async resolve(which: number[], pick: number, choices: ConflictChoice[]): Promise<void> {
    const devices = which.map((d) => this.devices[d]);
    const held: Map<Place, Value>[] = [];
    for (const device of devices) held.push(await this.values(device));
    const records = [...held[0].keys()].filter(
      (p) => kindOf(p) === 'conflict' && held.every((values) => values.has(p)),
    );
    if (records.length === 0) return;
    const conflict = records[pick % records.length];
    const kind = classify(conflict);
    if (kind.kind !== 'conflict') return;
    this.count(devices.length > 1 ? 'resolved on two devices' : 'resolved');
    for (const [i, device] of devices.entries()) {
      const choice = choices[i];
      await this.recorded(device, () => device.log.resolveConflict(kind.id, choice), {
        conflict,
        choice,
      });
    }
  }

  private async recorded(
    device: Device,
    work: () => Promise<void>,
    resolving?: { conflict: Place; choice: ConflictChoice },
  ): Promise<void> {
    const before = await this.values(device);
    await work();
    this.oracle.wrote(device.id, before, await this.values(device), resolving);
  }

  private async create(device: Device, kind: Kind, pick: number, n: number): Promise<void> {
    const now = this.now().toISOString();
    const date = now.slice(0, 10);
    const log = device.log;
    switch (kind) {
      case 'session':
        return log.putSession({
          id: `${date}-${suffix(n)}`,
          date,
          started_at: now,
          tz: 'Europe/Lisbon',
          time_precision: 'instant',
          ended_at: now,
          label: { name: null, block: null, week: null, day: null, weekday: null },
          bodyweight_kg: null,
          notes: `v${n}`,
          exercises: [],
          created_at: now,
          updated_at: now,
          device_id: device.id,
        });
      case 'template':
        return log.putTemplate({
          id: `day-${suffix(n)}`,
          name: `Day ${n}`,
          intention: `v${n}`,
          label: { name: null, block: null, week: null, day: null, weekday: null },
          exercises: [],
          created_at: now,
          updated_at: now,
        });
      case 'bodyweight':
        return log.putRow('bodyweight', {
          date: WEIGH_INS[pick % WEIGH_INS.length],
          weight_kg: weight(n),
          source: 'manual',
        });
      case 'oneRm': {
        const [date, lift] = ONE_RMS[pick % ONE_RMS.length];
        return log.putRow('oneRm', { date, lift, weight_kg: 200, note: `v${n}` });
      }
      case 'manualRecords': {
        const [date, exercise_id, reps] = RECORDS[pick % RECORDS.length];
        return log.putRow('manualRecords', {
          source: 'manual',
          date,
          exercise_id,
          reps,
          weight_kg: 100,
          rpe: null,
          context: `v${n}`,
        });
      }
      case 'competitionBests': {
        const [date, exercise_id] = BESTS[pick % BESTS.length];
        return log.putRow('competitionBests', { date, exercise_id, weight_kg: 200, meet: `v${n}` });
      }
      case 'additions':
        await log.saveExercise({ ...exercise(ADDITIONS[pick % ADDITIONS.length]), name: `v${n}` });
        return;
    }
  }

  private async edit(device: Device, place: Place, n: number): Promise<void> {
    const log = device.log;
    const kind = classify(pathOf(place));
    if (kind.kind === 'session') {
      const session = (await log.getSession(kind.id))!;
      return log.putSession({ ...session, notes: `v${n}` });
    }
    if (kind.kind === 'template') {
      const template = (await log.getTemplates()).find((t) => t.id === kind.id)!;
      return log.putTemplate({ ...template, intention: `v${n}` });
    }
    if (kind.kind !== 'table') throw new Error(`cannot edit ${place}`);
    switch (kind.table) {
      case 'bodyweight': {
        const row = await this.row(device, 'bodyweight', place);
        return log.putRow('bodyweight', { ...row, weight_kg: weight(n) });
      }
      case 'oneRm':
        return log.putRow('oneRm', { ...(await this.row(device, 'oneRm', place)), note: `v${n}` });
      case 'manualRecords': {
        const row = await this.row(device, 'manualRecords', place);
        return log.putRow('manualRecords', { ...row, context: `v${n}` });
      }
      case 'competitionBests': {
        const row = await this.row(device, 'competitionBests', place);
        return log.putRow('competitionBests', { ...row, meet: `v${n}` });
      }
      case 'additions': {
        const { based_on: _, ...addition } = await this.row(device, 'additions', place);
        await log.saveExercise({ ...addition, name: `v${n}` });
        return;
      }
    }
  }

  private async remove(device: Device, place: Place): Promise<void> {
    const log = device.log;
    const kind = classify(pathOf(place));
    if (kind.kind === 'session') return log.deleteSession(kind.id);
    if (kind.kind === 'template') return log.deleteTemplate(kind.id);
    if (kind.kind !== 'table') throw new Error(`cannot delete ${place}`);
    return log.deleteRow(kind.table, await this.row(device, kind.table, place));
  }

  /** The record at a table place, which the device holds. */
  private async row<K extends TableKind>(device: Device, kind: K, place: Place) {
    const schema = TABLES[kind] as unknown as TableSchema<RecordOf<K>>;
    const rows = await device.log.getRows(kind);
    const found = rows.find((r) => rowKey(schema, schema.toRow(r)) === keyOf(place));
    if (found === undefined) throw new Error(`${device.name} holds no row at ${place}`);
    return found;
  }

  // --- syncing ----------------------------------------------------------------------

  /**
   * One sync, with faults. An injected failure is expected, and a kill relaunches
   * the device; anything else the sync throws is a failure of the simulation.
   * Null when the sync failed, or did not run because the device was already
   * syncing (the sync lock).
   */
  async sync(device: Device, mode: Mode, faults: Fault[]): Promise<SyncResult | null> {
    if (this.syncing.has(device)) return null;
    this.syncing.add(device);
    const run = new SyncRun(this, device, faults);
    let result: SyncResult | null = null;
    let error: unknown = null;
    try {
      result = await runSync(
        {
          store: run.store,
          remote: run.remote,
          deviceId: device.id,
          now: this.now,
          random: device.random,
        },
        mode,
      );
    } catch (e) {
      error = e;
    }

    // Blobs are fetched several at a time, so a sync can fail while another of
    // its requests, or a race one of them started, is still going. Those finish
    // before the device is relaunched or the step ends, and anything they broke
    // is reported.
    for (let settled = 0; settled < run.requests.length;) {
      const pending = run.requests.slice(settled);
      settled = run.requests.length;
      for (const outcome of await Promise.allSettled(pending)) {
        if (outcome.status === 'rejected') rethrowFailure(outcome.reason);
      }
    }
    this.syncing.delete(device);

    if (error === null) {
      this.count(`${mode} completed`);
      if (result!.conflicts.length > 0) this.count('conflicts found');
      return result;
    }
    rethrowFailure(error);
    if (!run.caused(error)) {
      throw new SimFailure(
        'no unexpected errors',
        `${device.name}'s ${mode} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.count(run.killed ? 'killed' : 'offline');
    if (run.killed) device.restart();
    return null;
  }

  /**
   * Runs what a race does while a sync waits on the network. Blobs are fetched
   * several at a time, so two races can start together; they run one after the
   * other, as a lifter does one thing at a time.
   */
  meanwhile(work: () => Promise<void>): Promise<void> {
    const run = this.races.then(work);
    this.races = run.catch(() => undefined);
    return run;
  }

  /** Another client commits a file of its own on the head, just before the next branch move. */
  busy(): void {
    this.remote.beforeMove = () => {
      this.remote.beforeMove = null;
      const commit = this.remote.externalCommit(
        [{ path: 'notes/busy.md', content: `${++this.busied}\n` }],
        'Another client',
      );
      this.oracle.external(commit);
    };
  }

  // --- the end ------------------------------------------------------------------------

  /** The network is back: every device syncs in turn until a whole round changes nothing. */
  private async heal(): Promise<void> {
    for (let round = 0; round < 10; round++) {
      let changed = false;
      for (const device of this.devices) {
        const result = (await this.sync(device, 'full', []))!;
        if (result.committed !== null || result.taken.length > 0) changed = true;
      }
      if (!changed) return;
    }
    throw new SimFailure('convergence', 'the devices were still changing the log after ten rounds');
  }

  private async checkEnd(): Promise<void> {
    // 1. Convergence: every device holds exactly the log's files, agrees with it
    // on every base, has recorded its head, and has nothing in flight.
    const head = await this.remote.head();
    const log = appFiles(this.remote.files());
    for (const device of this.devices) {
      const files = await readFiles(device.disk);
      for (const path of new Set([...files.keys(), ...log.keys()])) {
        if (files.get(path) !== log.get(path)) {
          throw new SimFailure(
            'convergence',
            `${device.name} ${files.has(path) ? 'holds' : 'lacks'} ${path}, which the log ` +
              `${log.has(path) ? 'holds' : 'lacks'}${files.has(path) && log.has(path) ? ' differently' : ''}`,
          );
        }
      }
      for (const entry of await device.disk.entries()) {
        if (entry.local_sha !== entry.base_sha || entry.unsynced_since !== null) {
          throw new SimFailure('convergence', `${device.name} still has ${entry.path} to sync`);
        }
      }
      if ((await device.disk.meta()).last_synced_head !== head) {
        throw new SimFailure(
          'convergence',
          `${device.name} has not recorded the head it agrees with`,
        );
      }
      if ((await device.disk.inflight()) !== null) {
        throw new SimFailure('convergence', `${device.name} still has a commit in flight`);
      }
    }
    await this.mirror();

    // 2 and 3, against who had seen what.
    this.oracle.checkEnd(valuesOf(log));
    for (const _ of this.oracle.undone) this.count('deletions undone by a concurrent write');
    if (this.oracle.undone.length > 0) this.count('schedules with a deletion undone');

    // 5. Quiet when idle: one request, no commit.
    for (const device of this.devices) {
      const before = this.remote.calls.length;
      const result = (await this.sync(device, 'full', []))!;
      const calls = this.remote.calls.slice(before);
      if (result.committed !== null || calls.join() !== 'head') {
        throw new SimFailure(
          'quiet when idle',
          `${device.name}'s sync with nothing to do made ${calls.join(', ')}` +
            `${result.committed !== null ? ', and a commit' : ''}`,
        );
      }
    }
  }

  /** The oracle must agree with every device and the log about what they hold. */
  private async mirror(): Promise<void> {
    for (const device of this.devices) this.oracle.mirror(device.id, await this.values(device));
    this.oracle.mirrorLog(valuesOf(appFiles(this.remote.files())));
  }

  private async values(device: Device): Promise<Map<Place, Value>> {
    return valuesOf(await readFiles(device.disk));
  }
}

/**
 * One sync's view of the device and the log, with the schedule's faults. Remote
 * requests and store writes are counted from the start of the sync, recovery
 * included, so a fault can hit any await in it.
 */
class SyncRun {
  readonly store: SyncStore;
  readonly remote: SyncRemote;
  killed = false;
  private applies = 0;
  private moved = false;
  /** Another client commits before this sync's first branch move only, so it loses one round. */
  private busied = false;
  private readonly injected: unknown[] = [];
  /** Every remote request the sync made, settled or not. */
  readonly requests: Promise<unknown>[] = [];

  constructor(
    readonly world: World,
    readonly device: Device,
    readonly faults: Fault[],
  ) {
    this.store = new SyncStore(this, device.disk);
    this.remote = new SyncRemote(this, world.remote);
  }

  /** Whether the sync failed because of a fault this run injected. */
  caused(error: unknown): boolean {
    return this.injected.some((e) => e === error || (error instanceof Error && error.cause === e));
  }

  beforeApply(): void {
    const at = ++this.applies;
    const dies = this.faults.some(
      (f) => (f.kind === 'crash' && f.at === at) || (f.kind === 'settle' && this.moved),
    );
    if (dies) throw this.kill(new Error('killed'));
  }

  /** The ops a sabotaged store would actually apply. */
  sabotaged(ops: StoreOp[]): StoreOp[] {
    const sabotage = this.world.sabotage;
    return ops.filter(
      (op) =>
        !(sabotage.forgetInflight && op.op === 'inflight' && op.inflight !== null) &&
        !(sabotage.forgetHead && op.op === 'meta') &&
        !(
          sabotage.dropDeletions &&
          op.op === 'content' &&
          op.text === null &&
          !isConflictPath(op.path)
        ) &&
        !(
          sabotage.dropConflicts &&
          op.op === 'content' &&
          op.text !== null &&
          isConflictPath(op.path)
        ),
    );
  }

  decided(before: Map<Place, Value>, after: Map<Place, Value>, bases: Map<Place, Value>): void {
    this.world.oracle.decided(this.device.id, this.remote.lastHead!, before, after, bases);
  }

  async beforeRequest(op: RemoteOp, at: number): Promise<void> {
    for (const fault of this.faults) {
      if (fault.kind === 'race' && fault.at === at) {
        await this.world.meanwhile(async () => {
          for (const step of fault.steps) await this.world.execute(step);
        });
      }
      if (fault.kind === 'busy' && op === 'moveBranch' && !this.busied) {
        this.busied = true;
        this.world.busy();
      }
    }
    // At most one failure per request, so none is left queued for someone else's.
    const failure = this.faults.find(
      (f) => (f.kind === 'offline' || f.kind === 'kill') && f.at === at,
    );
    if (failure?.kind === 'offline') {
      const error = new SyncError('retryable', 'offline', { network: true });
      this.injected.push(error);
      this.world.remote.failNext(op, error);
    } else if (failure?.kind === 'kill') {
      this.world.remote.failNext(op, this.kill(new SyncError('retryable', 'killed')));
    }
  }

  afterRequest(at: number): void {
    if (this.faults.some((f) => f.kind === 'lose' && f.at === at)) {
      throw this.kill(new SyncError('retryable', 'killed'));
    }
  }

  committed(input: { parent: string; changes: RemoteChange[] }, next: NewCommit): void {
    this.world.oracle.committed(this.device.id, next.commit, input.parent, input.changes);
  }

  branchMoved(to: string): void {
    this.moved = true;
    this.world.oracle.moved(to);
  }

  private kill<E>(error: E): E {
    if (this.moved) this.world.count('killed after the branch moved');
    this.killed = true;
    this.injected.push(error);
    return error;
  }
}

/** The device's store, as one sync sees it. */
class SyncStore implements LocalStore {
  constructor(
    private readonly run: SyncRun,
    private readonly disk: MemoryStore,
  ) {}

  content = (path: string) => this.disk.content(path);
  paths = () => this.disk.paths();
  entry = (path: string) => this.disk.entry(path);
  entries = () => this.disk.entries();
  meta = () => this.disk.meta();
  inflight = () => this.disk.inflight();
  settings = () => this.disk.settings();
  saveSettings: LocalStore['saveSettings'] = (patch) => this.disk.saveSettings(patch);
  resetSync = () => this.disk.resetSync();

  exclusive<T>(fn: (store: Exclusive) => Promise<T>): Promise<T> {
    return this.disk.exclusive(async (s) => {
      // Only deciding lists the paths, and it does so before writing.
      let before: Map<Place, Value> | null = null;
      let bases: Map<Place, Value> | null = null;
      const result = await fn({
        content: (path) => s.content(path),
        entry: (path) => s.entry(path),
        entries: () => s.entries(),
        meta: () => s.meta(),
        inflight: () => s.inflight(),
        paths: async () => {
          if (before === null) {
            before = valuesOf(await readFiles(s));
            bases = basesOf(await s.entries());
          }
          return s.paths();
        },
        apply: async (ops: StoreOp[]) => {
          this.run.beforeApply();
          if (before === null && ops.some((op) => op.op === 'content')) {
            throw new SimFailure('harness', 'a sync wrote content without deciding');
          }
          await s.apply(this.run.sabotaged(ops));
        },
      });
      if (before !== null) this.run.decided(before, valuesOf(await readFiles(s)), bases!);
      return result;
    });
  }
}

/** The log repo, as one sync sees it. */
class SyncRemote implements Remote {
  /** The head the sync last read: what its round decides against. */
  lastHead: string | null = null;
  private requests = 0;

  constructor(
    private readonly run: SyncRun,
    private readonly remote: MemoryRemote,
  ) {}

  repoInfo(): Promise<RepoInfo> {
    return this.request('repoInfo', () => this.remote.repoInfo());
  }

  head(): Promise<string | null> {
    return this.request('head', async () => (this.lastHead = await this.remote.head()));
  }

  tree(commit: string): Promise<RemoteTree> {
    return this.request('tree', () => this.remote.tree(commit));
  }

  blob(sha: string): Promise<string> {
    return this.request('blob', () => this.remote.blob(sha));
  }

  commit(input: {
    parent: string;
    baseTree: string;
    changes: RemoteChange[];
    message: string;
  }): Promise<NewCommit> {
    return this.request('commit', async () => {
      if (this.run.world.sabotage.dropPushes) {
        input = {
          ...input,
          changes: input.changes.filter((c) => classify(c.path).kind !== 'session'),
        };
      }
      const next = await this.remote.commit(input);
      this.run.committed(input, next);
      return next;
    });
  }

  moveBranch(from: string, to: string): Promise<'moved' | 'raced'> {
    return this.request('moveBranch', async () => {
      try {
        const moved = await this.remote.moveBranch(from, to);
        if (moved === 'moved') this.run.branchMoved(to);
        else this.run.world.count('lost a race');
        return moved;
      } finally {
        // Another client's commit is for this move only.
        this.remote.beforeMove = null;
      }
    });
  }

  contains(ancestor: string, descendant: string): Promise<boolean> {
    return this.request('contains', async () => {
      const landed = await this.remote.contains(ancestor, descendant);
      return landed && !this.run.world.sabotage.denyLanding;
    });
  }

  initEmpty(path: string, content: string, message: string): Promise<string> {
    return this.request('initEmpty', () => this.remote.initEmpty(path, content, message));
  }

  private request<T>(op: RemoteOp, send: () => Promise<T>): Promise<T> {
    const at = ++this.requests;
    const answer = (async () => {
      await this.run.beforeRequest(op, at);
      const answer = await send();
      this.run.afterRequest(at);
      return answer;
    })();
    this.run.requests.push(answer);
    return answer;
  }
}

async function readFiles(reader: StoreReader): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const path of await reader.paths()) {
    const text = await reader.content(path);
    if (text !== null) files.set(path, text);
  }
  return files;
}

function isConflictPath(path: string): boolean {
  return classify(path).kind === 'conflict';
}

/** A failure of the simulation's own, wherever in a chain of causes the sync wrapped it. */
function rethrowFailure(error: unknown): void {
  for (let cause: unknown = error; cause instanceof Error; cause = cause.cause) {
    if (cause instanceof SimFailure) throw cause;
  }
}

function appFiles(files: Map<string, string>): Map<string, string> {
  return new Map([...files].filter(([path]) => isOurs(path)));
}

/** Plays a schedule; the invariant it broke, or null. */
/** Plays a schedule: the world as it ended, and the invariant it broke, or null. */
export async function play(
  schedule: Schedule,
  sabotage?: Sabotage,
): Promise<{ world: World; failure: SimFailure | null }> {
  const world = new World(schedule, sabotage);
  try {
    await world.run();
    return { world, failure: null };
  } catch (e) {
    const failure =
      e instanceof SimFailure
        ? e
        : new SimFailure(
            'no unexpected errors',
            e instanceof Error ? (e.stack ?? e.message) : String(e),
          );
    return { world, failure };
  }
}

export async function failureOf(
  schedule: Schedule,
  sabotage?: Sabotage,
): Promise<SimFailure | null> {
  return (await play(schedule, sabotage)).failure;
}
