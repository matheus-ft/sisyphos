import type { ConflictRecord, Session, TableRow, Template } from '../../src/model';
import type { ConflictChoice } from '../../src/storage/log';
import {
  parseConflict,
  parseSession,
  parseTemplate,
  rowKey,
  TABLES,
  tableRows,
} from '../../src/storage/formats';
import { blobSha } from '../../src/storage/hash';
import { classify, type TableKind } from '../../src/storage/paths';
import type { RemoteChange } from '../../src/storage/remote/remote';
import type { SyncEntry } from '../../src/storage/store/store';

/**
 * The simulation's own record of who had seen what, which the invariants 2 to
 * 4 listed in sim.test.ts are checked against. It never asks the sync what it
 * decided: it watches what reaches each device and each commit, and works out
 * the rest.
 *
 * **Places and versions.** A place is one unit of the decision: a session,
 * template or conflict file by its path, a table row as `path#key`. Every write
 * carries a version identity that survives the round trip: a session's notes, a
 * template's intention, a weigh-in's weight, a 1RM's note, a manual record's
 * context, an addition's name. A conflict record's identity is what it saves,
 * for whom, and when. A place's value is that identity, or null when absent.
 *
 * **Events.** Every change a lifter makes is an event: the place, the new value
 * (null for a deletion, which is a version too) and `seen`, the events the device
 * held at that place when it wrote. A conflict record a sync saves is an event
 * too, marked `saved`.
 *
 * **Knowledge.** Every holder (each device's local state, and each commit of the
 * log repo) keeps, per place, the event whose value it holds and `hist`: every
 * event that value reflects, its own and whatever it replaced. A device's own
 * write adds itself. A sync that writes the log's version to a device gives the
 * device the log's `hist` as well, and so does finding the device already holds
 * the log's version (two devices that deleted the same record agree, and each
 * has seen the other's deletion). A push gives the commit the device's `hist` as
 * it was when the sync decided. When a sync saves the device's version in a
 * conflict record, that version moves from the place to the record: a later edit
 * of the place does not replace it; only resolving the record does.
 *
 * "Had seen" is then membership: device D had seen event e at a place when e is
 * in D's `hist` there. Events with the same value at the same place, which a sync
 * found two holders had reached without seeing each other's, are linked, so
 * seeing one is seeing the other. For invariant 2, a value (not a deletion) is
 * also seen by a device that saw the same value at the same place, whichever
 * write put it there: a version is its content. Invariant 4 asks about
 * changes, so it keeps to the events themselves.
 *
 * **The rule, step by step.** Every value a sync takes must replace the device's
 * base content (L = B), unless it saves the device's own in a conflict record,
 * and every unit a commit changes must hold the device's base content in the
 * log (R = B). So a version can only vanish by being replaced knowingly, or when
 * its unit's content had gone back to a base, where three versions cannot show
 * the change: the known limit (docs/DESIGN.md, Storage). A deletion lost that way is reported as
 * undone by a concurrent write, invariant 2's one exception; anything else lost
 * fails.
 */

export type Place = string;
export type Value = string;

export interface Event {
  id: number;
  place: Place;
  /** The version written; null for a deletion. */
  value: Value | null;
  device: string;
  /** What the device held at this place, and had seen there, when it wrote. */
  seen: ReadonlySet<number>;
  /** Deletions only: every event the device had seen anywhere, for "nothing comes back". */
  knew: ReadonlySet<number> | null;
  /** A conflict record a sync saved, rather than a lifter's write. */
  saved: boolean;
  /** When, for reports: the step of the schedule. */
  step: string;
}

interface Held {
  value: Value | null;
  event: number | null;
  hist: ReadonlySet<number>;
}

type State = Map<Place, Held>;

const NOTHING: Held = { value: null, event: null, hist: new Set() };

/** An invariant broken, or the simulation itself inconsistent ('harness'). */
export class SimFailure extends Error {
  constructor(
    readonly invariant: string,
    message: string,
  ) {
    super(`${invariant}: ${message}`);
    this.name = 'SimFailure';
  }
}

export class Oracle {
  readonly events: Event[] = [];
  /** The step being run, stamped on events for reports. */
  step = '';
  head: string;
  private readonly devices = new Map<string, State>();
  private readonly commits = new Map<string, State>();
  /** Each device's knowledge as its last sync decided: what that sync's commit pushes from. */
  private readonly decidedAs = new Map<string, State>();
  /** Events whose value some head of the log repo held. */
  private readonly published = new Set<number>();
  /** Union-find over events linked as the same version. */
  private readonly links = new Map<number, number>();
  /** A saved version, chosen where the data already held it, to the event that carries it on. */
  private readonly carriers = new Map<number, number>();
  /** Each device's bases as its last sync decided: what that sync's commit must push over. */
  private readonly decidedBases = new Map<string, Map<Place, Value>>();
  /**
   * Versions a sync overwrote without their writer's change being visible to it:
   * the unit's content had gone back to the base (`decided` and `committed`).
   */
  private readonly hidden = new Set<number>();
  /** Deletions undone by a concurrent write: the design limit `checkEnd` reports rather than fails. */
  readonly undone: string[] = [];

  constructor(head: string, devices: string[]) {
    this.head = head;
    this.commits.set(head, new Map());
    for (const device of devices) this.devices.set(device, new Map());
  }

  // --- watching -------------------------------------------------------------------

  /**
   * A lifter's write on a device: `before` and `after` are the device's values
   * around it. Resolving a conflict is one write to two places: keeping the
   * log's version discards the saved one; using the saved one moves it into the
   * data, replacing what stood there, and discards only the record.
   */
  wrote(
    device: string,
    before: Map<Place, Value>,
    after: Map<Place, Value>,
    resolving?: { conflict: Place; choice: ConflictChoice },
  ): void {
    const state = this.state(device);
    const changed = changes(before, after);
    const resolved = resolving && before.get(resolving.conflict);
    // Using a saved version the data already holds changes nothing, so no sync
    // will carry it anywhere: from here on the version standing there carries it.
    let joins: Place | null = null;
    if (resolved && resolving.choice === 'use_saved') {
      const about = recordInfo(resolved).about;
      if (!changed.includes(about)) {
        if (held(state, about).event === null) changed.push(about);
        else joins = about;
      }
    }
    const pre = new Map(changed.map((place) => [place, held(state, place)]));
    const record = resolving ? held(state, resolving.conflict) : null;
    if (joins !== null) {
      const standing = held(state, joins);
      for (const id of record!.hist) {
        const e = this.events[id];
        if (e.place === joins && e.value === standing.value) this.carriers.set(id, standing.event!);
      }
      state.set(joins, { ...standing, hist: union(standing.hist, record!.hist) });
    }
    for (const place of changed) {
      const was = pre.get(place)!;
      this.expect(was.value === (before.get(place) ?? null), `${device} held ${place} unseen`);
      let seen = was.hist;
      if (resolving && place === resolving.conflict && resolving.choice === 'use_saved') {
        seen = new Set([...was.hist].filter((id) => this.events[id].place === place));
      } else if (resolving && place !== resolving.conflict) {
        seen = union(was.hist, record!.hist);
      }
      const value = after.get(place) ?? null;
      const knew = value === null ? union(seen, ...[...state.values()].map((h) => h.hist)) : null;
      const event = this.event({ place, value, device, seen, knew, saved: false });
      state.set(place, { value, event, hist: union(seen, [event]) });
    }
  }

  /**
   * A sync decided on a device, against the log at `head`. Every
   * value the sync wrote to the device must be the log's at that head, except new
   * conflict records, which must hold the device's own version of a unit where
   * neither side had seen the other's change (invariant 4). `bases` are the
   * device's bases when it decided.
   */
  decided(
    device: string,
    head: string,
    before: Map<Place, Value>,
    after: Map<Place, Value>,
    bases: Map<Place, Value>,
  ): void {
    const log = this.commits.get(head);
    this.expect(log !== undefined, `${device} decided against ${head}, a head never seen`);
    const state = this.state(device);
    const changed = changes(before, after);
    const pre = new Map(changed.map((place) => [place, held(state, place)]));
    for (const [place, was] of pre) {
      this.expect(was.value === (before.get(place) ?? null), `${device} held ${place} unseen`);
    }

    const created = changed.filter(
      (place) =>
        isConflict(place) && after.has(place) && held(log!, place).value !== after.get(place),
    );
    for (const place of changed) {
      if (created.includes(place)) continue;
      const theirs = held(log!, place).value;
      if ((after.get(place) ?? null) !== theirs) {
        throw new SimFailure(
          'sync takes only the log’s versions',
          `${device}'s sync wrote ${show(after.get(place))} to ${place}, where the log holds ${show(theirs)}`,
        );
      }
    }

    // Each new record's version moves there from the place it was saved from.
    const moved = new Map<Place, ReadonlySet<number>>();
    for (const place of created) {
      const value = after.get(place)!;
      const record = recordInfo(value);
      if (record.device !== device) {
        throw new SimFailure(
          'conflicts only when concurrent',
          `${device}'s sync saved a conflict record in the name of ${record.device}`,
        );
      }
      // A record of this device's own whose id another device's record took is
      // saved again under a fresh id (sync.ts `saveLocal`); anything else saves
      // the device's version of the unit the record is about.
      const resaved = changed.find((p) => p !== place && isConflict(p) && before.get(p) === value);
      const origin = resaved ?? record.about;
      const mine = pre.get(origin) ?? held(state, origin);
      if (resaved === undefined && mine.value !== record.version) {
        throw new SimFailure(
          'nothing lost',
          `${device}'s sync saved ${show(record.version)} of ${origin} as a conflict, but held ${show(mine.value)}`,
        );
      }
      const theirs = held(log!, origin);
      if (mine.event === null || theirs.event === null) {
        throw new SimFailure(
          'conflicts only when concurrent',
          `${device}'s sync found a conflict on ${origin} with a version nobody wrote ` +
            `(${show(mine.value)} here, ${show(theirs.value)} in the log)`,
        );
      }
      if (this.sees(theirs.hist, mine.event)) {
        throw new SimFailure(
          'conflicts only when concurrent',
          `${device}'s sync saved its ${show(mine.value)} of ${origin} as a conflict, but the log's ` +
            `${show(theirs.value)} was written by a device that had seen it (${this.describe(mine.event)})`,
        );
      }
      if (this.sees(mine.hist, theirs.event)) {
        throw new SimFailure(
          'conflicts only when concurrent',
          `${device}'s sync saved its ${show(mine.value)} of ${origin} as a conflict against the log's ` +
            `${show(theirs.value)}, which it had already seen (${this.describe(theirs.event)})`,
        );
      }
      const going =
        resaved !== undefined
          ? mine.hist
          : new Set(
              [...mine.hist].filter(
                (id) => this.events[id].place === origin && this.events[id].value === mine.value,
              ),
            );
      moved.set(origin, going);
      const saved = this.event({
        place,
        value,
        device,
        seen: held(state, place).hist,
        knew: null,
        saved: true,
      });
      state.set(place, { value, event: saved, hist: union(going, [saved]) });
    }

    // Taken: the device now holds the log's version, and has seen what it has.
    for (const place of changed) {
      if (created.includes(place)) continue;
      const was = pre.get(place)!;
      const theirs = held(log!, place);
      const going = moved.get(place);
      // A record resolved here whose id another device's record then drew: that
      // conflict keeps no record of the resolution, since the record that stands
      // is one this device never saw (sync.ts `saveLocal`).
      const redrawn = isConflict(place) && was.value === null && theirs.value !== null;
      if (going === undefined && !redrawn) {
        // Not a conflict, so the rule took R because L = B.
        const base = bases.get(place) ?? null;
        if (was.value !== base) {
          throw new SimFailure(
            'sync takes only the log’s versions',
            `${device}'s sync replaced its ${show(was.value)} of ${place} with the log's ` +
              `${show(theirs.value)} without saving it, having last agreed on ${show(base)}`,
          );
        }
        // L = B by content, yet L is the device's own version, one the log never
        // held: its content went back to the base, and the sync cannot tell.
        const mine = was.event === null ? null : this.events[was.event];
        if (
          mine !== null &&
          mine.device === device &&
          !mine.saved &&
          !this.isPublished(mine.id) &&
          !this.sees(theirs.hist, mine.id)
        ) {
          this.hidden.add(mine.id);
        }
      }
      const kept = going ? [...was.hist].filter((id) => !going.has(id)) : was.hist;
      state.set(place, {
        value: theirs.value,
        event: theirs.event,
        hist: union(kept, theirs.hist),
      });
    }

    // Already the same on both sides: the device holds the log's version. Where
    // each side reached it without seeing the other (two devices deleted the same
    // record, or both used the same saved version), each version is the other's.
    for (const [place, theirs] of log!) {
      if (changed.includes(place)) continue;
      const mine = held(state, place);
      if (mine.value !== theirs.value) continue;
      if (
        mine.event !== null &&
        theirs.event !== null &&
        !this.sees(theirs.hist, mine.event) &&
        !this.sees(mine.hist, theirs.event)
      ) {
        this.link(mine.event, theirs.event);
      }
      if ([...theirs.hist].every((id) => mine.hist.has(id))) continue;
      state.set(place, { ...mine, hist: union(mine.hist, theirs.hist) });
    }

    this.decidedAs.set(device, new Map(state));
    this.decidedBases.set(device, bases);
  }

  /** A device's sync wrote a commit on `parent`: what it pushes is what the device held when it decided. */
  committed(device: string, commit: string, parent: string, pushed: RemoteChange[]): void {
    const was = this.commits.get(parent);
    this.expect(was !== undefined, `${device} committed on ${parent}, a commit never seen`);
    const mine = this.decidedAs.get(device);
    const bases = this.decidedBases.get(device);
    this.expect(mine !== undefined && bases !== undefined, `${device} committed without deciding`);
    const next = new Map(was!);
    for (const { path, content } of pushed) {
      const values = valuesOf(new Map(content === null ? [] : [[path, content]]));
      const places = new Set([
        ...values.keys(),
        ...[...was!.keys()].filter((p) => pathOf(p) === path),
      ]);
      for (const place of places) {
        const value = values.get(place) ?? null;
        const before = held(was!, place);
        if (value === before.value) continue;
        const held_ = held(mine!, place);
        if (held_.value !== value || held_.event === null) {
          throw new SimFailure(
            'sync pushes only the device’s versions',
            `${device} pushed ${show(value)} to ${place}, having decided while holding ${show(held_.value)}`,
          );
        }
        // Pushed because R = B: the log must hold what the device last agreed on.
        const base = bases!.get(place) ?? null;
        if (before.value !== base) {
          throw new SimFailure(
            'sync pushes only over what it agreed on',
            `${device} pushed ${show(value)} to ${place} over the log's ${show(before.value)}, ` +
              `having last agreed on ${show(base)}`,
          );
        }
        // R = B by content, yet the device never saw R's change: the log's content
        // went back to the device's base, and the sync cannot tell.
        if (before.event !== null && !this.sees(held_.hist, before.event)) {
          this.hidden.add(before.event);
        }
        next.set(place, { value, event: held_.event, hist: union(before.hist, held_.hist) });
      }
    }
    this.commits.set(commit, next);
  }

  /** The branch moved to a commit a device made. */
  moved(commit: string): void {
    const state = this.commits.get(commit);
    this.expect(state !== undefined, `the branch moved to ${commit}, a commit never seen`);
    this.head = commit;
    for (const h of state!.values()) if (h.event !== null) this.published.add(h.event);
  }

  /** Another client committed on the head, touching none of the app's files. */
  external(commit: string): void {
    this.commits.set(commit, this.commits.get(this.head)!);
    this.head = commit;
  }

  /**
   * The lifter changed the log on github.com, committing on the head: a writer
   * whose knowledge is the log's. A file rewritten in another form, holding the
   * same record, is no new version.
   */
  edited(commit: string, changes: RemoteChange[]): void {
    const was = this.commits.get(this.head)!;
    const next = new Map(was);
    for (const { path, content } of changes) {
      const values = valuesOf(new Map(content === null ? [] : [[path, content]]));
      const places = new Set([
        ...values.keys(),
        ...[...was.keys()].filter((p) => pathOf(p) === path),
      ]);
      for (const place of places) {
        const value = values.get(place) ?? null;
        const before = held(was, place);
        if (value === before.value) continue;
        const knew =
          value === null ? union(before.hist, ...[...was.values()].map((h) => h.hist)) : null;
        const event = this.event({
          place,
          value,
          device: 'web',
          seen: before.hist,
          knew,
          saved: false,
        });
        next.set(place, { value, event, hist: union(before.hist, [event]) });
      }
    }
    this.commits.set(commit, next);
    this.moved(commit);
  }

  // --- checking -------------------------------------------------------------------

  /** The oracle's idea of a device's values must be the device's. */
  mirror(device: string, values: Map<Place, Value>): void {
    this.same(`${device}`, this.state(device), values);
  }

  /** The oracle's idea of the log's head must be the log's. */
  mirrorLog(values: Map<Place, Value>): void {
    this.same('the log', this.commits.get(this.head)!, values);
  }

  /**
   * Invariants 2 and 3, over the log everyone converged on (invariant 1 is
   * checked by the caller, and 4 as each conflict is found).
   */
  checkEnd(values: Map<Place, Value>): void {
    const records = [...values]
      .filter(([place]) => isConflict(place))
      .map(([, v]) => recordInfo(v));
    const holds = (place: Place, value: Value | null) =>
      (values.get(place) ?? null) === value ||
      records.some((r) => r.about === place && r.version === value);
    // A deletion of versions that never left the device undoes nothing anyone
    // else holds: it matters only if it deleted a version the log once held.
    const matters = (e: Event) =>
      [...e.seen].some((id) => this.events[id].place === e.place && this.isPublished(id));

    // 2. Nothing lost.
    for (const e of this.events) {
      if (e.saved) continue;
      let survives: boolean;
      if (isConflict(e.place)) {
        // Only ever deleted, by resolving: the record resolved does not come back.
        if (!matters(e)) continue;
        const now = values.get(e.place);
        survives = now === undefined || ![...e.seen].some((id) => this.events[id].value === now);
      } else {
        if (e.value === null && !matters(e)) continue;
        survives = holds(e.place, e.value);
      }
      if (!survives && !this.excused(e)) {
        if (e.value === null && !isConflict(e.place) && this.undoneUnseen(e.id)) {
          this.undone.push(this.describe(e.id));
          continue;
        }
        throw new SimFailure(
          'nothing lost',
          `${this.describe(e.id)} is gone, and no device that had seen it replaced it ` +
            `(the log holds ${show(values.get(e.place))} there)`,
        );
      }
    }

    // 3. Nothing comes back.
    for (const d of this.events) {
      if (d.value !== null || d.knew === null) continue;
      const versions = this.events.filter((e) => e.place === d.place && e.value !== null);
      if (versions.some((e) => e.id > d.id)) continue;
      if (!versions.every((e) => this.sees(d.knew!, e.id))) continue;
      if (values.has(d.place)) {
        throw new SimFailure(
          'nothing comes back',
          `${this.describe(d.id)}, having seen every version of it, but the log holds ` +
            `${show(values.get(d.place))} there`,
        );
      }
    }
  }

  describe(id: number): string {
    const e = this.events[id];
    const what = e.saved
      ? `saved ${show(e.value)} as ${e.place}`
      : e.value === null
        ? `deleted ${e.place}`
        : `wrote ${show(e.value)} to ${e.place}`;
    return `${e.device} ${what} (event ${e.id}, ${e.step})`;
  }

  // --- internals --------------------------------------------------------------------

  private state(device: string): State {
    return this.devices.get(device)!;
  }

  private event(fields: Omit<Event, 'id' | 'step'>): number {
    const id = this.events.length;
    this.events.push({ ...fields, id, step: this.step });
    return id;
  }

  /**
   * Replaced or deleted by a later write on a device that had seen it there. A
   * later write of the same value at the same place (using a saved version)
   * carries it on, so it is excused once that write is.
   *
   * A version is its content (the sync compares units by their serialisations), so a write of a value has been seen by a device that saw that same
   * value at that place, whichever write put it there: using a saved version
   * writes a value again, on any device that chooses it. A deletion is only
   * seen as itself, or as a deletion linked to it (invariant 2's exception
   * turns on exactly which deletion a device had seen).
   */
  private excused(e: Event, memo = new Map<number, boolean>()): boolean {
    const known = memo.get(e.id);
    if (known !== undefined) return known;
    memo.set(e.id, false);
    const carrier = this.carriers.get(e.id);
    const seenBy = (x: Event) =>
      this.sees(x.seen, e.id) ||
      (e.value !== null &&
        [...x.seen].some(
          (id) => this.events[id].place === e.place && this.events[id].value === e.value,
        ));
    const excused =
      (carrier !== undefined && this.excused(this.events[carrier], memo)) ||
      this.events.some(
        (x) =>
          x.id !== e.id &&
          seenBy(x) &&
          (x.place !== e.place || x.value !== e.value || this.excused(x, memo)),
      );
    memo.set(e.id, excused);
    return excused;
  }

  /**
   * The design limit (`docs/DESIGN.md`, Storage: nothing marks a record as
   * changed or deleted). A version a sync overwrote while its unit's content
   * equalled the base, so the sync had no way to see it: on its own device,
   * whose content had gone back to the base; or in the log, whose content had
   * gone back to the pushing device's base. The same version under another event
   * counts: linked, or carried on by a later write of it that had seen it (using
   * a saved deletion writes the deletion again), as `excused` reads it.
   */
  private undoneUnseen(id: number): boolean {
    const root = this.find(id);
    for (const hidden of this.hidden) if (this.find(hidden) === root) return true;
    const carrier = this.carriers.get(id);
    if (carrier !== undefined && this.undoneUnseen(carrier)) return true;
    const e = this.events[id];
    return this.events.some(
      (x) =>
        x.id > id &&
        x.place === e.place &&
        x.value === e.value &&
        this.sees(x.seen, id) &&
        this.undoneUnseen(x.id),
    );
  }

  private isPublished(id: number): boolean {
    const root = this.find(id);
    for (const published of this.published) if (this.find(published) === root) return true;
    return false;
  }

  private sees(hist: ReadonlySet<number>, id: number): boolean {
    if (hist.has(id)) return true;
    const root = this.find(id);
    for (const x of hist) if (this.find(x) === root) return true;
    return false;
  }

  private find(id: number): number {
    let at = id;
    while (this.links.has(at)) at = this.links.get(at)!;
    return at;
  }

  private link(a: number, b: number): void {
    const x = this.find(a);
    const y = this.find(b);
    if (x !== y) this.links.set(Math.max(x, y), Math.min(x, y));
  }

  private same(who: string, state: State, values: Map<Place, Value>): void {
    for (const place of new Set([...state.keys(), ...values.keys()])) {
      const expected = state.get(place)?.value ?? null;
      const actual = values.get(place) ?? null;
      if (expected !== actual) {
        throw new SimFailure(
          'harness',
          `${who} holds ${show(actual)} at ${place}, where the simulation expected ${show(expected)}`,
        );
      }
    }
  }

  private expect(condition: boolean, message: string): void {
    if (!condition) throw new SimFailure('harness', message);
  }
}

// --- values ---------------------------------------------------------------------------

/** The version identity of each kind of table row. */
export const TOKEN_COLUMN: Record<TableKind, string> = {
  bodyweight: 'weight_kg',
  oneRm: 'note',
  manualRecords: 'context',
  additions: 'name',
};

export function isConflict(place: Place): boolean {
  return classify(pathOf(place)).kind === 'conflict';
}

/** The file a place is in. */
export function pathOf(place: Place): string {
  const at = place.indexOf('#');
  return at === -1 ? place : place.slice(0, at);
}

/** The row key of a table place. */
export function keyOf(place: Place): string {
  return place.slice(place.indexOf('#') + 1);
}

/** What a conflict record saves, for whom, and when: its identity, whatever its id. */
export interface RecordInfo {
  device: string;
  foundAt: string;
  about: Place;
  version: Value | null;
}

export function recordInfo(value: Value): RecordInfo {
  const [device, foundAt, about, version] = JSON.parse(value) as [
    string,
    string,
    Place,
    Value | null,
  ];
  return { device, foundAt, about, version };
}

function recordValue(conflict: ConflictRecord): Value {
  const target = classify(conflict.path);
  let about: Place = conflict.path;
  let version: Value | null = null;
  if (target.kind === 'table') {
    const schema = TABLES[target.table];
    about = `${conflict.path}#${rowKey(schema, conflict.key!)}`;
    if (conflict.version !== null)
      version = (conflict.version as TableRow)[TOKEN_COLUMN[target.table]];
  } else if (target.kind === 'session') {
    version = (conflict.version as Session | null)?.notes ?? null;
  } else if (target.kind === 'template') {
    version = (conflict.version as Template | null)?.intention ?? null;
  }
  return JSON.stringify([conflict.device_id, conflict.found_at, about, version]);
}

/** Parsed files by path and text: the same files are read again after every step. */
const parsed = new Map<string, Array<[Place, Value]>>();
/** The value of every session, template and conflict file read, by blob sha: how a base is read back. */
const bySha = new Map<string, Value>();

/** Forgets parsed files, so a long run does not keep every file it ever saw. */
export function forgetParsed(): void {
  parsed.clear();
  bySha.clear();
}

/** The value at every place in these files. Absent places are missing. */
export function valuesOf(files: Map<string, string>): Map<Place, Value> {
  const values = new Map<Place, Value>();
  for (const [path, text] of files) {
    for (const [place, value] of cached(path, text)) values.set(place, value);
  }
  return values;
}

/** The value at every place as a device last agreed on it with the log: its bases. */
export function basesOf(entries: SyncEntry[]): Map<Place, Value> {
  const bases = new Map<Place, Value>();
  for (const { path, base_sha, base_body } of entries) {
    const kind = classify(path).kind;
    if (kind === 'table') {
      if (base_body !== null) {
        for (const [place, value] of cached(path, base_body)) bases.set(place, value);
      }
    } else if (kind !== 'format' && kind !== 'foreign' && base_sha !== null) {
      const value = bySha.get(base_sha);
      if (value === undefined) {
        throw new SimFailure('harness', `the base of ${path} is content never read`);
      }
      bases.set(path, value);
    }
  }
  return bases;
}

function cached(path: string, text: string): Array<[Place, Value]> {
  const key = `${path}\n${text}`;
  let entries = parsed.get(key);
  if (!entries) {
    entries = read(path, text);
    parsed.set(key, entries);
    if (classify(path).kind !== 'table' && entries.length > 0) {
      bySha.set(blobSha(text), entries[0][1]);
    }
  }
  return entries;
}

function read(path: string, text: string): Array<[Place, Value]> {
  const kind = classify(path);
  switch (kind.kind) {
    case 'session':
      return [[path, parseSession(text).notes ?? '']];
    case 'template':
      return [[path, parseTemplate(text).intention ?? '']];
    case 'conflict':
      return [[path, recordValue(parseConflict(text))]];
    case 'table': {
      const schema = TABLES[kind.table];
      return tableRows(schema, text).map((row) => [
        `${path}#${rowKey(schema, row)}`,
        row[TOKEN_COLUMN[kind.table]],
      ]);
    }
    default:
      return [];
  }
}

function held(state: ReadonlyMap<Place, Held>, place: Place): Held {
  return state.get(place) ?? NOTHING;
}

function changes(before: Map<Place, Value>, after: Map<Place, Value>): Place[] {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((place) => (before.get(place) ?? null) !== (after.get(place) ?? null))
    .sort();
}

function union(a: Iterable<number>, ...more: Iterable<number>[]): Set<number> {
  const all = new Set(a);
  for (const set of more) for (const id of set) all.add(id);
  return all;
}

function show(value: Value | null | undefined): string {
  if (value === null || value === undefined) return 'nothing';
  if (value.startsWith('[')) {
    const r = recordInfo(value);
    return `a record of ${r.device}'s ${show(r.version)} of ${r.about}`;
  }
  return `"${value}"`;
}
