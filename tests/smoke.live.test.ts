/**
 * The storage layer against a real GitHub repository: setup, sync between two
 * devices, a conflict, a lost race, a quiet sync, and the adapter's edge cases.
 * Everything else tests against the in-memory remote; this is the check that
 * GitHub behaves as that remote assumes.
 *
 * Run it yourself, with a throwaway repository:
 *
 *   1. On github.com, create a private repository (any name, say
 *      `sisyphos-smoke`) with "Add a README" ticked.
 *   2. Create a fine-grained personal access token: resource owner yourself,
 *      repository access "Only select repositories" with just that one,
 *      permissions Contents: read and write.
 *   3. Then, in the app's checkout:
 *
 *        read -s SMOKE_TOKEN && export SMOKE_TOKEN   # paste the token; it is not echoed
 *        SMOKE_REPO=you/sisyphos-smoke npm run smoke
 *
 * It runs only under `npm run smoke` with both variables set, and skips
 * otherwise, so `npm test` never touches the network. It is safe to run again
 * and again on the same repository: every record it writes is named with this
 * run's id, and the last step deletes them. The token is never logged; the log
 * shows it masked.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import exercisesCsv from '../src/library/exercises.csv?raw';
import musclesCsv from '../src/library/muscles.csv?raw';
import { parseExercises, parseMuscles } from '../src/library/parse';
import type { BodyweightEntry, Session } from '../src/model';
import { githubRemote, maskToken, parseRepo, remoteFromSettings } from '../src/storage/app';
import { SyncError } from '../src/storage/errors';
import { blobSha } from '../src/storage/hash';
import { Log } from '../src/storage/log';
import { conflictPath, FORMAT_PATH, sessionPath, TABLE_PATHS } from '../src/storage/paths';
import type { Remote } from '../src/storage/remote/remote';
import { setUp } from '../src/storage/setup';
import { MemoryStore } from '../src/storage/store/memory';
import { runSync, type SyncResult } from '../src/storage/sync';

const env = import.meta.env as Record<string, string | undefined>;
/** `npm run smoke` runs vitest with `--mode smoke`. */
const SMOKE = import.meta.env.MODE === 'smoke';
const TARGET = parseRepo(env.SMOKE_REPO ?? '');
const TOKEN = (env.SMOKE_TOKEN ?? '').trim();
const CONFIGURED = SMOKE && TARGET !== null && TOKEN !== '';

if (SMOKE && !CONFIGURED) {
  console.warn(
    [
      'The live smoke test needs a throwaway GitHub repository and a token for it:',
      '',
      '  1. On github.com, create a private repository (say sisyphos-smoke) with "Add a README" ticked.',
      '  2. Create a fine-grained personal access token (Settings > Developer settings >',
      '     Fine-grained tokens): resource owner yourself; repository access "Only select',
      '     repositories" with just that one; permissions Contents: read and write.',
      '  3. Run:',
      '       read -s SMOKE_TOKEN && export SMOKE_TOKEN   # paste the token, then Enter',
      '       SMOKE_REPO=you/sisyphos-smoke npm run smoke',
      '',
      env.SMOKE_REPO && !TARGET
        ? `SMOKE_REPO is "${env.SMOKE_REPO}", which is not owner/repo.`
        : `Missing: ${[!env.SMOKE_REPO && 'SMOKE_REPO', !TOKEN && 'SMOKE_TOKEN'].filter(Boolean).join(' and ')}.`,
    ].join('\n'),
  );
}

// --- this run ----------------------------------------------------------------------------

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
/** Four characters, as a readable id's random part (DATA.md, Ids). */
const RUN = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => ALPHABET[b % 32]).join('');
const DAY = 86_400_000;
const TODAY = new Date().toISOString().slice(0, 10);

/** The one session this run writes, named by the run. */
const SESSION = `${TODAY}-${RUN}`;
/**
 * Bodyweight is keyed by date, so this run's weigh-ins get dates of their own:
 * four days in the twentieth century, picked by the run id.
 */
const DATES = (() => {
  const n = [...RUN].reduce((sum, c) => sum * 32 + ALPHABET.indexOf(c), 0);
  const first = Date.UTC(1900, 0, 1) + (n % 36_000) * DAY;
  return [0, 1, 2, 3].map((i) => new Date(first + i * DAY).toISOString().slice(0, 10));
})();

const BODYWEIGHT = TABLE_PATHS.bodyweight;
const EMPTY_BLOB = blobSha('');

function say(message: string): void {
  console.log(`[smoke ${RUN}] ${message}`);
}

// --- what GitHub reads back ----------------------------------------------------------------

/** A plain remote for looking at what GitHub holds, outside both devices' counts; set by step 1. */
let probe: Remote;
/** The head the latest sync left, which GitHub's reads must come to show. */
let latest: string | null = null;

/**
 * Whether `check` holds within ten seconds. GitHub's reads of a branch can trail
 * a move of it for a moment (github.ts, `headLeaves`): a check made straight
 * after a write would otherwise fail on a read that is only early.
 */
async function eventually(check: () => Promise<boolean>): Promise<boolean> {
  for (let tries = 0; tries < 20; tries++) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return check();
}

/**
 * The head, once GitHub's reads show the one the latest sync left. A lifter's
 * next sync comes seconds after the last, not milliseconds; one made sooner can
 * read the old head and spend a round on it, which is no failure of the sync.
 */
async function settled(): Promise<string> {
  let head: string | null = null;
  await eventually(async () => (head = await probe.head()) === latest);
  expect(head).toBe(latest);
  return head!;
}

const muscles = new Set(parseMuscles(musclesCsv).map((m) => m.id));
const SHIPPED = parseExercises(exercisesCsv, muscles);

// --- devices -----------------------------------------------------------------------------

interface Device {
  name: string;
  id: string;
  store: MemoryStore;
  log: Log;
  /** Every request this device sent, as `METHOD /path` below the repository. */
  requests: string[];
  /** Every branch move this device's sync attempted, and how it went. */
  moves: Array<'moved' | 'raced'>;
  commits: number;
  /** Runs once, just before this device's next branch move. */
  beforeMove: (() => Promise<void>) | null;
  remote: Remote | null;
}

function device(name: string): Device {
  const id = `smoke-${name.toLowerCase()}-${RUN}`;
  const store = new MemoryStore({ deviceId: id });
  return {
    name,
    id,
    store,
    log: new Log(store, { deviceId: id, shipped: SHIPPED }),
    requests: [],
    moves: [],
    commits: 0,
    beforeMove: null,
    remote: null,
  };
}

/** Node's fetch, writing down each request. */
function watchedFetch(d: Device): typeof fetch {
  return (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    d.requests.push(
      `${init?.method ?? 'GET'} ${url.replace(/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+/, '')}`,
    );
    return fetch(input, init);
  };
}

/** The remote the device's settings name, counting commits and moves, with the race hook. */
async function connectRemote(d: Device): Promise<Remote> {
  const inner = remoteFromSettings(await d.store.settings(), githubRemote(watchedFetch(d)));
  if (inner === null) throw new Error(`${d.name} is not set up`);
  return {
    repoInfo: () => inner.repoInfo(),
    head: () => inner.head(),
    tree: (commit) => inner.tree(commit),
    blob: (sha) => inner.blob(sha),
    commit: async (input) => {
      const made = await inner.commit(input);
      d.commits++;
      return made;
    },
    moveBranch: async (from, to) => {
      const hook = d.beforeMove;
      d.beforeMove = null;
      if (hook) await hook();
      const moved = await inner.moveBranch(from, to);
      d.moves.push(moved);
      return moved;
    },
    contains: (ancestor, descendant) => inner.contains(ancestor, descendant),
    initEmpty: (path, content, message) => inner.initEmpty(path, content, message),
  };
}

async function setUpDevice(d: Device) {
  const result = await setUp(
    { ...TARGET!, token: TOKEN },
    { store: d.store, makeRemote: githubRemote(watchedFetch(d)) },
  );
  if (result.ok) d.remote = await connectRemote(d);
  return result;
}

/** One full sync, and what it cost. */
async function sync(d: Device): Promise<SyncResult & { requests: number; commits: number }> {
  if (latest !== null) await settled();
  const before = { requests: d.requests.length, commits: d.commits, moves: d.moves.length };
  const result = await runSync({ store: d.store, remote: d.remote!, deviceId: d.id }, 'full');
  latest = (await d.store.meta()).last_synced_head;
  const cost = {
    requests: d.requests.length - before.requests,
    commits: d.commits - before.commits,
  };
  const moves = d.moves.slice(before.moves);
  say(
    `${d.name} synced: ${cost.requests} requests, ${cost.commits} commits` +
      (moves.length ? ` (branch ${moves.join(', then ')})` : '') +
      (result.pushed.length ? `; pushed ${result.pushed.join(', ')}` : '') +
      (result.taken.length ? `; took ${result.taken.length} files` : '') +
      (result.conflicts.length ? `; ${result.conflicts.length} conflicts` : '') +
      (result.unreadable.length ? `; unreadable ${result.unreadable.join(', ')}` : ''),
  );
  return { ...result, ...cost };
}

function weighIn(date: string, weight_kg: number): BodyweightEntry {
  return { date, weight_kg, source: 'manual' };
}

/** This run's weigh-ins on a device, date to kg. */
async function weights(d: Device): Promise<Record<string, number>> {
  const rows = await d.log.getRows('bodyweight');
  return Object.fromEntries(
    rows.filter((row) => DATES.includes(row.date)).map((row) => [row.date, row.weight_kg]),
  );
}

async function editNotes(d: Device, notes: string): Promise<void> {
  const session = await d.log.getSession(SESSION);
  if (!session) throw new Error(`${d.name} does not hold ${SESSION}`);
  await d.log.putSession({ ...session, notes });
}

function testSession(): Session {
  const now = new Date().toISOString();
  return {
    id: SESSION,
    date: TODAY,
    started_at: now,
    tz: 'UTC',
    time_precision: 'instant',
    ended_at: now,
    label: { name: null, block: null, week: null, day: null, weekday: null },
    bodyweight_kg: null,
    notes: `smoke run ${RUN}`,
    exercises: [],
    created_at: now,
    updated_at: now,
    device_id: 'set by the log',
  };
}

// --- the run -------------------------------------------------------------------------------

describe.skipIf(!CONFIGURED)('live smoke test against GitHub', { timeout: 120_000 }, () => {
  const A = device('A');
  const B = device('B');
  let branch: string;
  /** The head after step 2, an ancestor of every later one. */
  let earlier: string;
  /** Conflict records this run created, which the clean-up resolves. */
  const conflicts: string[] = [];
  let cleaned = false;
  /** Each step builds on the one before, so after a failure the rest are skipped, not failed again. */
  let broken = false;

  beforeEach(({ skip, onTestFailed }) => {
    if (broken) skip();
    onTestFailed(() => {
      broken = true;
    });
  });

  /** A file's content at the head, or null when it is not there. */
  async function remoteText(path: string): Promise<string | null> {
    const head = await settled();
    const file = (await probe.tree(head)).files.find((f) => f.path === path);
    return file ? probe.blob(file.sha) : null;
  }

  it('1. sets up device A, refusing a bad token first, then syncs', async () => {
    say(`repository ${TARGET!.owner}/${TARGET!.repo}, token ${maskToken(TOKEN)}`);

    const refused = await setUp(
      { ...TARGET!, token: 'github_pat_smoke_not_a_real_token_0000' },
      { store: A.store, makeRemote: githubRemote() },
    );
    say(`a made-up token: ${refused.ok ? 'accepted!' : `${refused.reason}: ${refused.message}`}`);
    expect(refused).toMatchObject({ ok: false, reason: 'token' });
    expect((await A.store.settings()).owner).toBeNull();

    const result = await setUpDevice(A);
    say(
      `A set up: ${result.ok ? (result.initialised ? 'started a new log' : 'found an existing log') : `${result.reason}: ${result.message}`}`,
    );
    expect(result).toMatchObject({ ok: true });
    branch = (await A.store.settings()).branch!;
    probe = remoteFromSettings(await A.store.settings())!;
    if (result.ok && result.initialised) {
      // The sync must read the marker the setup just committed.
      const marked = await eventually(async () =>
        (await probe.tree((await probe.head())!)).files.some((f) => f.path === FORMAT_PATH),
      );
      expect(marked).toBe(true);
    }

    const first = await sync(A);
    expect(first.conflicts).toEqual([]);
    expect((await A.store.meta()).last_synced_head).toBe(await settled());
  });

  it('2. A pushes a session and a weigh-in; B sets up and takes them', async () => {
    await A.log.putSession(testSession());
    await A.log.putRow('bodyweight', weighIn(DATES[0], 80));
    const pushed = await sync(A);
    expect(pushed.commits).toBe(1);
    expect(pushed.pushed).toEqual(expect.arrayContaining([sessionPath(SESSION), BODYWEIGHT]));
    expect(await remoteText(sessionPath(SESSION))).toBe(
      await A.store.content(sessionPath(SESSION)),
    );
    earlier = await settled();

    const result = await setUpDevice(B);
    say(`B set up: ${result.ok ? 'found the log' : `${result.reason}: ${result.message}`}`);
    expect(result).toEqual({ ok: true, initialised: false });
    const taken = await sync(B);
    expect(taken.commits).toBe(0);
    expect(taken.taken).toEqual(expect.arrayContaining([sessionPath(SESSION), BODYWEIGHT]));
    expect(await B.log.getSession(SESSION)).toEqual(await A.log.getSession(SESSION));
    expect(await weights(B)).toEqual({ [DATES[0]]: 80 });
  });

  it('3. both change different rows of one table: one commit each, both kept', async () => {
    await A.log.putRow('bodyweight', weighIn(DATES[1], 81.5));
    await B.log.putRow('bodyweight', weighIn(DATES[2], 82));
    const a = await sync(A);
    const b = await sync(B);
    expect([a.commits, b.commits]).toEqual([1, 1]);
    expect(b.conflicts).toEqual([]);
    const after = await sync(A);
    expect(after.commits).toBe(0);

    const expected = { [DATES[0]]: 80, [DATES[1]]: 81.5, [DATES[2]]: 82 };
    expect(await weights(A)).toEqual(expected);
    expect(await weights(B)).toEqual(expected);
    expect(await remoteText(BODYWEIGHT)).toBe(await A.store.content(BODYWEIGHT));
    expect(await B.store.content(BODYWEIGHT)).toBe(await A.store.content(BODYWEIGHT));
  });

  it("4. both change the same session: the remote's version stands on both, the other is saved", async () => {
    await editNotes(A, `smoke run ${RUN}: changed on A`);
    await editNotes(B, `smoke run ${RUN}: changed on B`);
    await sync(A);
    const b = await sync(B);

    expect(b.conflicts).toHaveLength(1);
    const [conflict] = b.conflicts;
    conflicts.push(conflict.id);
    say(`B saved its version as ${conflictPath(conflict.id)}`);
    expect(conflict).toMatchObject({ path: sessionPath(SESSION), key: null, device_id: B.id });
    expect((conflict.version as Session).notes).toBe(`smoke run ${RUN}: changed on B`);
    expect(b.pushed).toEqual([conflictPath(conflict.id)]);

    await sync(A);
    for (const d of [A, B]) {
      expect((await d.log.getSession(SESSION))?.notes).toBe(`smoke run ${RUN}: changed on A`);
      expect((await d.log.getConflicts()).map((c) => c.id)).toContain(conflict.id);
    }
    expect(await remoteText(sessionPath(SESSION))).toBe(
      await A.store.content(sessionPath(SESSION)),
    );
    expect(await remoteText(conflictPath(conflict.id))).toBe(
      await B.store.content(conflictPath(conflict.id)),
    );
  });

  it("5. a forced race: A lands a commit between B's commit and B's branch move; B retries and merges", async () => {
    await A.log.putRow('bodyweight', weighIn(DATES[0], 80.5));
    await B.log.putRow('bodyweight', weighIn(DATES[3], 83));
    let landed: string | null = null;
    B.beforeMove = async () => {
      say('B has made its commit; A syncs before B moves the branch');
      landed = (await sync(A)).committed;
    };
    const movesBefore = B.moves.length;
    const b = await sync(B);

    expect(landed).not.toBeNull();
    // Lost at least once, then moved. A round after the first can read the head
    // before A's move, which GitHub's reads can trail (github.ts, `headLeaves`),
    // and lose again: a correct sync, only a slower one.
    const moves = B.moves.slice(movesBefore);
    expect(moves.length).toBeGreaterThanOrEqual(2);
    expect(moves).toEqual([...moves.slice(0, -1).map(() => 'raced'), 'moved']);
    // One commit per round, and no more.
    expect(b.commits).toBe(moves.length);
    expect(await probe.contains(landed!, b.committed!)).toBe(true);

    await sync(A);
    const expected = { [DATES[0]]: 80.5, [DATES[1]]: 81.5, [DATES[2]]: 82, [DATES[3]]: 83 };
    expect(await weights(A)).toEqual(expected);
    expect(await weights(B)).toEqual(expected);
    expect(await remoteText(BODYWEIGHT)).toBe(await B.store.content(BODYWEIGHT));
  });

  it('6. a quiet sync makes one request, and no commit', async () => {
    await sync(A);
    const before = A.requests.length;
    const quiet = await sync(A);
    expect(A.requests.slice(before)).toEqual([`GET /git/ref/heads/${branch}`]);
    expect(quiet.committed).toBeNull();
  });

  it('7. contains, and the edge cases of trees, behave as the adapter expects', async () => {
    const head = await settled();
    const tree = await probe.tree(head);
    const message = `Sisyphos smoke test ${RUN} (never on the branch)`;

    // contains: identical, ahead, behind, diverged, and a commit GitHub does not have.
    const side = await probe.commit({
      parent: earlier,
      baseTree: (await probe.tree(earlier)).sha,
      changes: [{ path: `smoke-${RUN}/side.txt`, content: `${RUN}\n` }],
      message,
    });
    const unknown = blobSha(`no such commit ${RUN}`);
    const answers = {
      identical: await probe.contains(head, head),
      ahead: await probe.contains(earlier, head),
      behind: await probe.contains(head, earlier),
      diverged: await probe.contains(side.commit, head),
      unknown: await probe.contains(unknown, head),
    };
    say(`contains: ${JSON.stringify(answers)}`);
    expect(answers).toEqual({
      identical: true,
      ahead: true,
      behind: false,
      diverged: false,
      unknown: false,
    });

    // A commit with no changes writes no tree: it is on the base tree. The tree
    // a commit is read with is the tree's own sha, not the commit's (which a
    // tree listing by commit sha answers with), so a commit can be built on it.
    const same = await probe.commit({ parent: head, baseTree: tree.sha, changes: [], message });
    expect(same.tree).toBe(tree.sha);
    expect((await probe.tree(same.commit)).sha).toBe(tree.sha);

    // The empty file hashes as git says, and reads back empty.
    const emptyPath = `smoke-${RUN}/empty.txt`;
    const withEmpty = await probe.commit({
      parent: head,
      baseTree: tree.sha,
      changes: [{ path: emptyPath, content: '' }],
      message,
    });
    const listed = (await probe.tree(withEmpty.commit)).files.find((f) => f.path === emptyPath);
    expect(listed?.sha).toBe(EMPTY_BLOB);
    expect(await probe.blob(EMPTY_BLOB)).toBe('');

    // Deleting a directory's only file leaves no empty directory behind: the
    // tree is exactly the one before it was added.
    const without = await probe.commit({
      parent: withEmpty.commit,
      baseTree: withEmpty.tree,
      changes: [{ path: emptyPath, content: null }],
      message,
    });
    expect(without.tree).toBe(tree.sha);

    // Deleting a path the base tree does not hold is refused, which is why the
    // sync checks before it asks (sync.ts, step 7).
    const refused = await probe
      .commit({
        parent: head,
        baseTree: tree.sha,
        changes: [{ path: `smoke-${RUN}/absent.txt`, content: null }],
        message,
      })
      .then(
        () => null,
        (error: unknown) => error,
      );
    say(`deleting an absent path: ${refused instanceof Error ? refused.message : 'accepted!'}`);
    expect(refused).toBeInstanceOf(SyncError);
    expect((refused as SyncError).kind).toBe('repo');

    // None of that moved the branch.
    expect(await probe.head()).toBe(head);
  });

  /** Resolves this run's conflicts and deletes its records, then brings both devices level. */
  async function cleanUp(): Promise<void> {
    for (const id of conflicts) await A.log.resolveConflict(id, 'keep_log');
    await A.log.deleteSession(SESSION);
    for (const date of DATES) await A.log.deleteRow('bodyweight', weighIn(date, 0));
    await sync(A);
    await sync(B);
    cleaned = true;
  }

  it("8. cleans up: resolves this run's conflict and deletes its records, on both devices", async () => {
    await cleanUp();
    for (const d of [A, B]) {
      expect(await d.log.getSession(SESSION)).toBeNull();
      expect(await weights(d)).toEqual({});
      expect(await d.log.getConflicts()).not.toContainEqual(
        expect.objectContaining({ id: conflicts[0] }),
      );
    }
    expect(await remoteText(sessionPath(SESSION))).toBeNull();
    for (const id of conflicts) expect(await remoteText(conflictPath(id))).toBeNull();
    const table = await remoteText(BODYWEIGHT);
    for (const date of DATES) expect(table ?? '').not.toContain(date);
  });

  afterAll(async () => {
    // A step failed before the clean-up: leave the repo as tidy as possible anyway.
    if (cleaned || A.remote === null) return;
    try {
      await cleanUp();
      say('cleaned up after a failure');
    } catch (error) {
      say(`could not clean up: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
});
