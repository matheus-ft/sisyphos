import type { ConflictRecord, IsoDate, Session, TableRow, Template } from '../model';
import { decideFile, decideTable, type Mode } from './decide';
import { FormatError, SyncError } from './errors';
import {
  lineRow,
  parseConflict,
  parseFormatMarker,
  parseSession,
  parseTemplate,
  serializeConflict,
  serializeSession,
  serializeTemplate,
  TABLES,
  tableUnits,
  unitsText,
  type TableSchema,
} from './formats';
import { blobSha } from './hash';
import { newConflictId } from './ids';
import {
  classify,
  conflictPath,
  FORMAT_PATH,
  FORMAT_VERSION,
  isOurs,
  TABLE_KINDS,
  TABLE_PATHS,
} from './paths';
import type { Remote, RemoteTree } from './remote/remote';
import type { Inflight, LocalStore, StoreOp, SyncEntry } from './store/store';

/**
 * One sync (docs/STORAGE.md 4.2, 4.4, 4.5): recover an unfinished commit, read
 * the head, compare, fetch, decide, commit, move the branch fast-forward only,
 * settle. A pull stops after deciding and never commits.
 *
 * Every step that touches the device runs in `store.exclusive`. The device's
 * content is never changed before step 5, and a failure at any point leaves the
 * store consistent: killing the app between any two awaits must be safe.
 *
 * Throws `SyncError` (errors.ts) and nothing else. Unreadable remote files do
 * not throw: they are reported in the result and left alone (section 6).
 *
 * Content is compared in the app's own form. The device only ever holds files
 * as the app writes them (1.4), and a base only ever moves to such a file, so a
 * remote file is read into its record and written back before it is compared:
 * a hand-formatted copy of the same record is then the same version, not a
 * change, and never a conflict. Where the remote's bytes differ from that form,
 * a full sync pushes the app's form, which is the one rewrite 1.4 describes.
 * Tables get this for free, since `tableUnits` reads rows into their own form
 * and the base is `unitsText` of the per-key base (step 5).
 *
 * Deterministic given `now` and `random`: paths are decided in sorted order,
 * and `random` is only drawn for conflict ids, in that order.
 */

export interface SyncDeps {
  store: LocalStore;
  remote: Remote;
  deviceId: string;
  now?: () => Date;
  random?: () => number;
  /** Rounds lost to other devices before giving up with a retryable error. Default 5. */
  maxRounds?: number;
  /** Blob fetches in flight at once. Default 6. */
  concurrency?: number;
}

export interface SyncResult {
  /** The head this device is now in agreement with (or pulled from). */
  head: string;
  /** The commit this sync landed, or null if it had nothing to push. */
  committed: string | null;
  /** Paths written to the remote. */
  pushed: string[];
  /** Paths whose remote version was written to the device. */
  taken: string[];
  /** Conflict records this sync created. */
  conflicts: ConflictRecord[];
  /** Remote files that did not parse and were left alone. */
  unreadable: string[];
}

export async function runSync(deps: SyncDeps, mode: Mode): Promise<SyncResult> {
  const context: Context = {
    store: deps.store,
    remote: deps.remote,
    deviceId: deps.deviceId,
    now: deps.now ?? (() => new Date()),
    random: deps.random ?? Math.random,
    maxRounds: deps.maxRounds ?? 5,
    concurrency: Math.max(1, deps.concurrency ?? 6),
  };
  try {
    await recover(context);
    const found: Found = { taken: new Set(), conflicts: [] };
    for (let round = 0; round < context.maxRounds; round++) {
      const result = await syncRound(context, mode, found);
      if (result !== 'raced') return result;
    }
    throw new SyncError(
      'retryable',
      `Other devices changed the log ${context.maxRounds} times while this one was syncing`,
    );
  } catch (e) {
    // The store's failures and this file's broken invariants are already
    // SyncErrors (`onDevice`, `checked`). Anything else escaped from the remote,
    // whose contract is to throw only SyncErrors, or from a line not guarded
    // above. Either way an assumption broke, and section 6 says to stop and
    // report rather than retry past it.
    if (e instanceof SyncError) throw e;
    throw new SyncError('bug', `Sync failed unexpectedly: ${describe(e)}`, { cause: e });
  }
}

interface Context {
  store: LocalStore;
  remote: Remote;
  deviceId: string;
  now: () => Date;
  random: () => number;
  maxRounds: number;
  concurrency: number;
}

/** What earlier rounds of this sync already did to the device, for the result. */
interface Found {
  taken: Set<string>;
  conflicts: ConflictRecord[];
}

// --- 4.5: recovering an unfinished commit -------------------------------------------

/**
 * If the last sync recorded a commit and was killed before settling, finds out
 * whether that commit landed. If it did, the pushed paths' bases move to what
 * was pushed, so this device does not mistake its own work for someone else's.
 * Either way the record goes.
 *
 * Step 10 also records the head, but this does not: whether that round could
 * record it (nothing unreadable, nothing left for later) is not in the record.
 * Leaving the old head means only that the round which follows at once reads the
 * tree, which is always right.
 */
async function recover(context: Context): Promise<void> {
  const { store, remote } = context;
  const inflight = await onDevice(() => store.inflight());
  if (inflight === null) return;
  const head = await remote.head();
  if (head === null) throw noCommits();
  const landed = await remote.contains(inflight.commit, head);
  const ops: StoreOp[] = landed ? settleBases(inflight) : [];
  await onDevice(() =>
    store.exclusive((s) => s.apply([...ops, { op: 'inflight', inflight: null }])),
  );
}

/** Step 10's bases: each pushed path now agrees with the remote on what was pushed. */
function settleBases(inflight: Inflight): StoreOp[] {
  return inflight.pushed.map(({ path, sha, body }) => ({ op: 'base', path, sha, body }));
}

// --- 4.2: one round --------------------------------------------------------------

/** Steps 2 to 10. 'raced' when another device moved the branch first: the caller starts again. */
async function syncRound(
  context: Context,
  mode: Mode,
  found: Found,
): Promise<SyncResult | 'raced'> {
  const { store, remote } = context;

  // 2. The head. Unmoved and nothing changed here: one request, and done.
  const head = await remote.head();
  if (head === null) throw noCommits();
  const [meta, entries] = await onDevice(() => Promise.all([store.meta(), store.entries()]));
  const unmoved = head === meta.last_synced_head && meta.last_synced_tree !== null;
  if (unmoved && entries.every((e) => e.local_sha === e.base_sha)) {
    return result(head, null, [], found, []);
  }
  // Each table the device has changed, as it stands now, before any request
  // lets a write in: if the remote holds exactly this, it is a base the two
  // agree on, whatever the lifter writes before step 5 (`Planner.left`).
  const began = new Map<string, string>();
  for (const e of entries) {
    if (e.local_sha === null || e.local_sha === e.base_sha) continue;
    if (classify(e.path).kind !== 'table') continue;
    const text = await onDevice(() => store.content(e.path));
    if (text !== null && blobSha(text) === e.local_sha) began.set(e.path, text);
  }

  // 3. The tree. A recorded head means every base agreed with it, so when it has
  // not moved the bases are the remote's files and nothing needs asking. Foreign
  // files are not the app's: they take no part, and `baseTree` carries them.
  const tree: RemoteTree = unmoved
    ? {
        sha: meta.last_synced_tree!,
        files: entries.flatMap((e) =>
          e.base_sha === null ? [] : [{ path: e.path, sha: e.base_sha }],
        ),
      }
    : await remote.tree(head);
  const remoteShas = new Map<string, string>();
  for (const file of tree.files) if (isOurs(file.path)) remoteShas.set(file.path, file.sha);

  const known = new Map(entries.map((e) => [e.path, e]));
  /** Remote content by blob sha, exactly as the remote holds it. */
  const fetched = new Map<string, string>();
  await checkFormat(context, remoteShas, known, fetched);

  // 4. Fetch what the decision needs: remote versions that are neither the base
  // nor what the device holds. By sha, so equal files are fetched once.
  const wanted = new Set<string>();
  for (const [path, sha] of remoteShas) {
    const entry = known.get(path);
    if (sha !== (entry?.base_sha ?? null) && sha !== (entry?.local_sha ?? null)) wanted.add(sha);
  }
  for (const sha of fetched.keys()) wanted.delete(sha);
  const notText = new Set<string>();
  await fetchAll(remote, [...wanted].sort(), context.concurrency, fetched, notText);

  // Where the device held the remote's version as the round began, and its base
  // is older, the two agreed on that version at this head (4.2 step 5).
  const agreed = new Map<string, { sha: string; body: string | null }>();
  for (const [path, sha] of remoteShas) {
    const entry = known.get(path);
    if (entry?.local_sha !== sha || entry.base_sha === sha) continue;
    if (classify(path).kind !== 'table') agreed.set(path, { sha, body: null });
    else if (began.has(path)) agreed.set(path, { sha, body: began.get(path)! });
  }

  // 5. Decide, on the write queue, against the device as it is now: a write that
  // landed while step 4 was fetching is decided too, never overwritten. The
  // decision is applied in one transaction, all of it or none.
  const now = context.now();
  const plan = await onDevice(() =>
    store.exclusive(async (s) => {
      const entries = new Map((await s.entries()).map((e) => [e.path, e]));
      const paths = [...new Set([...remoteShas.keys(), ...(await s.paths()).filter(isOurs)])];
      paths.sort();
      const candidates = paths.filter((path) => {
        const entry = entries.get(path);
        const base = entry?.base_sha ?? null;
        const local = entry?.local_sha ?? null;
        return !(base === local && local === (remoteShas.get(path) ?? null));
      });
      // No `local_sha` is no content (section 3), so only paths with some are read.
      const local = new Map<string, string | null>();
      for (const path of candidates) {
        local.set(path, entries.get(path)?.local_sha ? await s.content(path) : null);
      }

      // Conflict ids already in use on either side (1.2): a new one avoids them all.
      const held = new Set<string>();
      for (const path of [...tree.files.map((f) => f.path), ...paths]) {
        const kind = classify(path);
        if (kind.kind === 'conflict') held.add(kind.id);
      }

      const plan = checked(() =>
        new Planner({
          mode,
          deviceId: context.deviceId,
          now,
          random: context.random,
          remote: remoteShas,
          fetched,
          notText,
          agreed,
          entries,
          local,
          held,
        }).run(candidates),
      );

      // 6. Nothing to push: the head is synced, if every base now agrees with it.
      const ops = [...plan.ops];
      const record = plan.pushes.length === 0 && plan.agreed;
      if (record && (meta.last_synced_head !== head || meta.last_synced_tree !== tree.sha)) {
        ops.push({ op: 'meta', meta: { last_synced_head: head, last_synced_tree: tree.sha } });
      }
      if (ops.length > 0) await s.apply(ops);
      return plan;
    }),
  );
  for (const path of plan.taken) found.taken.add(path);
  found.conflicts.push(...plan.conflicts);

  if (plan.pushes.length === 0) return result(head, null, [], found, plan.unreadable);

  // 7. Write the tree and the commit.
  const changes = plan.pushes.map(({ path, content }) => {
    // GitHub refuses the whole tree for a deletion of a path it does not hold.
    if (content === null && !remoteShas.has(path)) {
      throw new SyncError('bug', `Sync tried to delete ${path}, which the log repo does not hold`);
    }
    return { path, content };
  });
  const next = await remote.commit({
    parent: head,
    baseTree: tree.sha,
    changes,
    message: commitMessage(plan.pushes),
  });

  // 8. Record it, so a device killed after the branch moves still knows (4.5).
  const inflight: Inflight = {
    commit: next.commit,
    tree: next.tree,
    parent: head,
    pushed: plan.pushes.map(({ path, content, body }) => ({
      path,
      sha: content === null ? null : blobSha(content),
      body,
    })),
  };
  await onDevice(() => store.exclusive((s) => s.apply([{ op: 'inflight', inflight }])));

  // 9. Move the branch. Lost to another device: the pushed paths' bases are still
  // the old ones, so the next round merges against the new remote.
  if ((await remote.moveBranch(head, next.commit)) === 'raced') {
    await onDevice(() => store.exclusive((s) => s.apply([{ op: 'inflight', inflight: null }])));
    return 'raced';
  }

  // 10. Settle.
  const settle: StoreOp[] = settleBases(inflight);
  if (plan.agreed) {
    settle.push({
      op: 'meta',
      meta: { last_synced_head: next.commit, last_synced_tree: next.tree },
    });
  }
  settle.push({ op: 'inflight', inflight: null });
  await onDevice(() => store.exclusive((s) => s.apply(settle)));

  const pushed = plan.pushes.map((p) => p.path).sort();
  return result(next.commit, next.commit, pushed, found, plan.unreadable);
}

function result(
  head: string,
  committed: string | null,
  pushed: string[],
  found: Found,
  unreadable: string[],
): SyncResult {
  return {
    head,
    committed,
    pushed,
    taken: [...found.taken].sort(),
    conflicts: [...found.conflicts],
    unreadable: [...unreadable],
  };
}

// --- 1.3: the format marker -----------------------------------------------------

/**
 * The remote's `sisyphos.json` must be there and readable, in a format this
 * build knows, before anything else is read. Its content is left in `fetched`
 * when it had to be asked for, so step 5 can take it.
 */
async function checkFormat(
  context: Context,
  remoteShas: Map<string, string>,
  known: Map<string, SyncEntry>,
  fetched: Map<string, string>,
): Promise<void> {
  const sha = remoteShas.get(FORMAT_PATH);
  if (sha === undefined) {
    throw new SyncError(
      'repo',
      `The log repo has no ${FORMAT_PATH}, so it is not set up as a training log. Run setup again.`,
    );
  }
  let text: string | null = null;
  if (known.get(FORMAT_PATH)?.local_sha === sha) {
    text = await onDevice(() => context.store.content(FORMAT_PATH));
  }
  let format: number;
  try {
    // Inside the try: a marker that is not even text is as unreadable as one
    // that does not parse, and that is a problem with the repo (section 6).
    if (text === null) {
      text = await context.remote.blob(sha);
      fetched.set(sha, text);
    }
    format = parseFormatMarker(text).format;
  } catch (e) {
    if (!(e instanceof FormatError)) throw e;
    throw new SyncError('repo', `The log repo's ${FORMAT_PATH} is unreadable: ${e.message}`);
  }
  if (format > FORMAT_VERSION) {
    throw new SyncError(
      'update',
      `The log is in format ${format}, newer than this version of the app reads. Update the app.`,
    );
  }
  // There is no older format yet. When there is, its migration goes here (1.3).
  if (format < FORMAT_VERSION) {
    throw new SyncError('bug', `This version of the app cannot migrate a log in format ${format}`);
  }
}

// --- 4: fetching -----------------------------------------------------------------

/** Fetches every sha into `into`, at most `limit` at a time. Stops starting new ones after a failure. */
async function fetchAll(
  remote: Remote,
  shas: string[],
  limit: number,
  into: Map<string, string>,
  notText: Set<string>,
): Promise<void> {
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < shas.length) {
      const sha = shas[next++];
      try {
        into.set(sha, await remote.blob(sha));
      } catch (e) {
        // A file that is not text is one file that does not parse: its paths are
        // unreadable, and every other path still syncs (section 6).
        if (e instanceof FormatError) {
          notText.add(sha);
          continue;
        }
        failed = true;
        throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, shas.length) }, worker));
}

// --- 5: deciding ---------------------------------------------------------------

/** One file in the commit. */
interface Push {
  path: string;
  /** The new content, or null to delete it. */
  content: string | null;
  /** Tables only: the pushed text, which becomes `base_body` once the commit lands. */
  body: string | null;
}

/** What step 5 decided. `ops` go to the device at once; `pushes` go into the commit. */
interface Plan {
  ops: StoreOp[];
  pushes: Push[];
  taken: string[];
  conflicts: ConflictRecord[];
  unreadable: string[];
  /**
   * Every path outside `pushes` now has its base at the remote's version at this
   * head, so once the push lands, or if there is none, the head can be recorded.
   * False for an unreadable file, a path written during step 4 and left for later,
   * and in a pull, a local change skipped over a remote one or a hand-formatted
   * file a pull may not rewrite. Recording the head then would make the next
   * sync take stale bases for the remote's files (step 3).
   */
  agreed: boolean;
}

interface PlanInput {
  mode: Mode;
  deviceId: string;
  now: Date;
  random: () => number;
  /** The remote's blob sha of each of the app's paths at the head. */
  remote: Map<string, string>;
  /** Remote content by blob sha, as fetched. */
  fetched: Map<string, string>;
  /** Blobs step 4 fetched that are not UTF-8 text: their paths are unreadable. */
  notText: Set<string>;
  /** Paths whose remote version the device held as the round began: the base, and a table's body. */
  agreed: Map<string, { sha: string; body: string | null }>;
  entries: Map<string, SyncEntry>;
  /** The device's current content of every path being decided. */
  local: Map<string, string | null>;
  /** Conflict ids in use locally or remotely; ids drawn here are added. */
  held: Set<string>;
}

/** How step 5 left one path. */
type Outcome =
  /** Not pushed; its base is now this sha. */
  | { base: string | null }
  /** In the commit; its base becomes what was pushed once the commit lands. */
  | 'pushed'
  /** Left exactly as it was, base included. */
  | 'left';

type FileKind = 'session' | 'template' | 'conflict';
type FileRecord = Session | Template | ConflictRecord;

const UNREADABLE = Symbol('unreadable');

/** Decides every path whose base, local and remote versions are not all equal (4.3). Pure. */
class Planner {
  private readonly plan: Plan = {
    ops: [],
    pushes: [],
    taken: [],
    conflicts: [],
    unreadable: [],
    agreed: true,
  };
  private readonly foundAt: string;
  /** The date of `foundAt`, so a conflict id's date and its `found_at` always agree. */
  private readonly today: IsoDate;

  constructor(private readonly input: PlanInput) {
    this.foundAt = input.now.toISOString();
    this.today = this.foundAt.slice(0, 10);
  }

  run(paths: string[]): Plan {
    for (const path of paths) {
      const remote = this.input.remote.get(path) ?? null;
      const outcome = this.decide(path, remote);
      if (outcome === 'left' || (outcome !== 'pushed' && outcome.base !== remote)) {
        this.plan.agreed = false;
      }
    }
    return this.plan;
  }

  private decide(path: string, remote: string | null): Outcome {
    const kind = classify(path);
    switch (kind.kind) {
      case 'format':
        return this.marker(path, remote);
      case 'session':
      case 'template':
      case 'conflict':
        return this.file(path, kind.kind, remote);
      case 'table':
        return this.table(path, TABLES[kind.table], remote);
      case 'foreign':
        throw new Error(`${path} is not the app's and must never be decided`);
    }
  }

  /**
   * The device takes the remote's marker as it is and never pushes its own (1.3):
   * the format is the log's to say, so a difference is never a conflict.
   */
  private marker(path: string, remote: string | null): Outcome {
    const entry = this.input.entries.get(path);
    if ((entry?.local_sha ?? null) !== remote) {
      const text = remote === null ? null : this.input.fetched.get(remote);
      // Written on the device during step 4; the next sync takes it.
      if (text === undefined) return 'left';
      this.write(path, text);
      this.plan.taken.push(path);
    }
    if ((entry?.base_sha ?? null) !== remote) {
      this.plan.ops.push({ op: 'base', path, sha: remote });
    }
    return { base: remote };
  }

  /** A session, template or conflict record: the unit is the file (4.3). */
  private file(path: string, kind: FileKind, sha: string | null): Outcome {
    const { mode } = this.input;
    const entry = this.input.entries.get(path);
    const base = entry?.base_sha ?? null;
    const local = entry?.local_sha ?? null;
    const localText = this.input.local.get(path) ?? null;

    // R, in the app's form: `remote` is its sha, `remoteText` its content, known
    // wherever the decision can need it. Where `sha` is the base, R cannot be
    // taken (L = B = R was never a candidate), so its content is not needed.
    let remote: string | null;
    let remoteText: string | null | undefined;
    if (sha === null || sha === local) {
      remote = sha;
      remoteText = sha === null ? null : localText;
    } else if (sha === base) {
      remote = sha;
    } else if (this.fetchedOrNotText(sha)) {
      const record = this.readRemote(path, () => parseFile(kind, this.remoteText(sha)));
      if (record === UNREADABLE) return 'left';
      remoteText = serializeFile(kind, record);
      remote = blobSha(remoteText);
    } else {
      // Not fetched because it was the device's version when step 4 looked, and
      // the device has written this path since.
      return this.left(path);
    }

    const decision = decideFile({ base, local, remote }, mode);
    if (decision === 'skip') return { base };
    if (decision === 'push') {
      this.push(path, localText, null);
      return 'pushed';
    }

    // same, take or conflict: the device ends up holding R, and the base moves to it.
    if (decision !== 'same') {
      if (decision === 'conflict') this.saveLocal(path, kind, localText);
      this.write(path, needed(path, remoteText));
      this.plan.taken.push(path);
    }
    if (remote !== base) this.plan.ops.push({ op: 'base', path, sha: remote });
    // The remote's bytes are not the app's form of what it holds (a hand-edited
    // file): the app's form is pushed, once (1.4).
    if (mode === 'full' && remote !== sha) {
      this.push(path, needed(path, remoteText), null);
      return 'pushed';
    }
    return { base: remote };
  }

  /** A table: the unit is the row with a given key (4.3). */
  private table(path: string, schema: TableSchema<unknown>, sha: string | null): Outcome {
    const { mode } = this.input;
    const entry = this.input.entries.get(path);
    const base = entry?.base_sha ?? null;
    const local = entry?.local_sha ?? null;
    const localText = this.input.local.get(path) ?? null;

    const baseUnits = this.baseUnits(path, schema, entry);
    const localUnits = tableUnits(schema, localText);
    let remoteUnits: Map<string, string>;
    if (sha === null) remoteUnits = new Map();
    else if (sha === local) remoteUnits = localUnits;
    else if (sha === base) remoteUnits = baseUnits;
    else if (this.fetchedOrNotText(sha)) {
      const units = this.readRemote(path, () => tableUnits(schema, this.remoteText(sha)));
      if (units === UNREADABLE) return 'left';
      remoteUnits = units;
    } else {
      // As for files: written on the device during step 4.
      return this.left(path);
    }

    const decision = decideTable({ base: baseUnits, local: localUnits, remote: remoteUnits }, mode);
    const resultText = tableFile(schema, decision.result);
    const nextBaseText = tableFile(schema, decision.nextBase);
    const nextBase = nextBaseText === null ? null : blobSha(nextBaseText);

    if (resultText !== localText) {
      this.write(path, resultText);
      // Pushing and skipping keep this device's row, so any other difference came from R.
      const keys = new Set([...decision.result.keys(), ...localUnits.keys()]);
      if ([...keys].some((key) => decision.result.get(key) !== localUnits.get(key))) {
        this.plan.taken.push(path);
      }
    }
    // Key by key (step 5): only rows now agreed with the remote move, so a retried
    // round never takes an older remote row for this device's version.
    if (nextBase !== base) {
      this.plan.ops.push({ op: 'base', path, sha: nextBase, body: nextBaseText });
    }

    for (const conflict of decision.conflicts) {
      const row = lineRow(schema, conflict.local ?? remoteUnits.get(conflict.key)!);
      this.record({
        id: this.newId(this.today),
        path,
        key: pick(row, schema.key),
        found_at: this.foundAt,
        device_id: this.input.deviceId,
        version: conflict.local === null ? null : row,
      });
    }

    const result = resultText === null ? null : blobSha(resultText);
    if (mode === 'full' && result !== sha) {
      this.push(path, resultText, resultText);
      return 'pushed';
    }
    return { base: nextBase };
  }

  /**
   * The local side of a file conflict becomes a conflict record (5.1).
   *
   * A conflict record in conflict is two devices having drawn the same id, which
   * is rare but possible. A record cannot hold another, so this device's record
   * is saved again under a fresh id, otherwise unchanged. A deletion here (the
   * lifter resolved the record they had) is dropped: the record that stands is
   * one this device never saw, and keeping it loses nothing.
   */
  private saveLocal(path: string, kind: FileKind, localText: string | null): void {
    // The device's own file. It was written by the app, so not parsing is a bug.
    const version = localText === null ? null : parseFile(kind, localText);
    if (kind === 'conflict') {
      if (version === null) return;
      const saved = version as ConflictRecord;
      const date = /^\d{4}-\d{2}-\d{2}/.exec(saved.found_at)?.[0] ?? this.today;
      this.record({ ...saved, id: this.newId(date) });
      return;
    }
    this.record({
      id: this.newId(this.today),
      path,
      key: null,
      found_at: this.foundAt,
      device_id: this.input.deviceId,
      version: version as Session | Template | null,
    });
  }

  /**
   * A path the device wrote while step 4 fetched, whose remote version was not
   * fetched because the device held it then: left for the next sync, which
   * fetches it; the head is not recorded, so that sync reads the tree. The
   * device held the remote's version as the round began, so that is its base
   * now, as it would have been had the write come a moment later. Otherwise a
   * version both sides held reads next time as this device's own change, and
   * comes back as a conflict against a writer who had seen it.
   */
  private left(path: string): Outcome {
    const agreed = this.input.agreed.get(path);
    if (agreed) this.plan.ops.push({ op: 'base', path, sha: agreed.sha, body: agreed.body });
    return 'left';
  }

  /** Written to the device and pushed in this same commit. */
  private record(conflict: ConflictRecord): void {
    const path = conflictPath(conflict.id);
    const text = serializeConflict(conflict);
    this.write(path, text);
    this.push(path, text, null);
    this.plan.conflicts.push(conflict);
  }

  private newId(date: IsoDate): string {
    const id = newConflictId(date, (taken) => this.input.held.has(taken), this.input.random);
    this.input.held.add(id);
    return id;
  }

  /** The base rows of a table, which its per-key decision needs. */
  private baseUnits(
    path: string,
    schema: TableSchema<unknown>,
    entry: SyncEntry | undefined,
  ): Map<string, string> {
    if (!entry || entry.base_sha === null) return new Map();
    if (entry.base_body === null || blobSha(entry.base_body) !== entry.base_sha) {
      throw new SyncError('bug', `The recorded base of ${path} does not match its hash`);
    }
    return tableUnits(schema, entry.base_body);
  }

  /** True when step 4 fetched this blob, or found it was not text: either way, it was looked at. */
  private fetchedOrNotText(sha: string): boolean {
    return this.input.fetched.has(sha) || this.input.notText.has(sha);
  }

  /** A fetched blob's text; one that is not UTF-8 is a file that does not parse. */
  private remoteText(sha: string): string {
    if (this.input.notText.has(sha)) throw new FormatError('not UTF-8 text');
    return this.input.fetched.get(sha)!;
  }

  /** Reads a remote file; one that does not parse is unreadable and left alone (section 6). */
  private readRemote<T>(path: string, read: () => T): T | typeof UNREADABLE {
    try {
      return read();
    } catch (e) {
      if (!(e instanceof FormatError)) throw e;
      this.plan.unreadable.push(path);
      return UNREADABLE;
    }
  }

  private write(path: string, text: string | null): void {
    this.plan.ops.push({ op: 'content', path, text });
  }

  private push(path: string, content: string | null, body: string | null): void {
    this.plan.pushes.push({ path, content, body });
  }
}

function parseFile(kind: FileKind, text: string): FileRecord {
  switch (kind) {
    case 'session':
      return parseSession(text);
    case 'template':
      return parseTemplate(text);
    case 'conflict':
      return parseConflict(text);
  }
}

function serializeFile(kind: FileKind, record: FileRecord): string {
  switch (kind) {
    case 'session':
      return serializeSession(record as Session);
    case 'template':
      return serializeTemplate(record as Template);
    case 'conflict':
      return serializeConflict(record as ConflictRecord);
  }
}

/**
 * A table's file for these rows. A table with no rows is no file: one form for
 * empty, so an emptied table and an absent one never differ, and nothing
 * creates a header-only file in the log.
 */
function tableFile(schema: TableSchema<unknown>, units: Map<string, string>): string | null {
  return units.size === 0 ? null : unitsText(schema, units);
}

function pick(row: TableRow, columns: readonly string[]): TableRow {
  return Object.fromEntries(columns.map((column) => [column, row[column]]));
}

function needed(path: string, text: string | null | undefined): string | null {
  if (text === undefined) throw new Error(`the remote content of ${path} is needed and not known`);
  return text;
}

// --- 7: the commit message -------------------------------------------------------

/** What the commit holds, in a line: `sync: 2 sessions, bodyweight, 1 conflict`. */
function commitMessage(pushes: Push[]): string {
  let sessions = 0;
  let templates = 0;
  let conflicts = 0;
  let resolved = 0;
  const tables = new Set<string>();
  for (const { path, content } of pushes) {
    const kind = classify(path);
    if (kind.kind === 'session') sessions++;
    else if (kind.kind === 'template') templates++;
    else if (kind.kind === 'table') tables.add(kind.table);
    else if (kind.kind === 'conflict') {
      if (content === null) resolved++;
      else conflicts++;
    }
  }
  const parts = [
    count(sessions, 'session'),
    count(templates, 'template'),
    ...TABLE_KINDS.filter((table) => tables.has(table)).map((table) =>
      TABLE_PATHS[table].replace(/^.*\//, '').replace(/\.csv$/, ''),
    ),
    count(conflicts, 'conflict'),
    resolved > 0 ? `${resolved} resolved` : null,
  ];
  return `sync: ${parts.filter((part) => part !== null).join(', ')}`;
}

function count(n: number, noun: string): string | null {
  return n === 0 ? null : `${n} ${noun}${n === 1 ? '' : 's'}`;
}

// --- errors ---------------------------------------------------------------------

/**
 * Runs something against the device's store. A failure there (quota, a
 * transaction the browser aborted) is the device's storage, not the log: the
 * store is all-or-nothing, so nothing is half-written, and the next try may
 * well work. Retryable.
 */
async function onDevice<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    if (e instanceof SyncError) throw e;
    throw new SyncError('retryable', `The device's storage failed: ${describe(e)}`, {
      cause: e,
    });
  }
}

/**
 * Runs the pure part of the sync. Everything it reads was read and checked
 * already, so a failure is a broken invariant: a device file that does not
 * parse, a serialiser that does not round-trip. Stop and report (section 6).
 */
function checked<T>(work: () => T): T {
  try {
    return work();
  } catch (e) {
    if (e instanceof SyncError) throw e;
    throw new SyncError('bug', `Sync hit a broken invariant: ${describe(e)}`, { cause: e });
  }
}

function noCommits(): SyncError {
  return new SyncError(
    'repo',
    'The log repo has no commits yet. Finish setting it up in the app before syncing.',
  );
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
