import { describe, expect, it } from 'vitest';
import type { ConflictRecord, Template } from '../src/model';
import { parseSession, serializeConflict } from '../src/storage/formats';
import { blobSha } from '../src/storage/hash';
import { Log } from '../src/storage/log';
import { conflictPath, FORMAT_PATH, sessionPath, templatePath } from '../src/storage/paths';
import type { MemoryRemote, RemoteOp } from '../src/storage/remote/memory';
import type { Format1Records } from '../src/storage/store/upgrade';
import { conflictV1, MARKER_V1, sessionV1, templateV1 } from './format1';
import {
  BODYWEIGHT,
  bodyweight,
  callsDuring,
  conflictsIn,
  Device,
  expectConverged,
  format1Log,
  format1Records,
  killed,
  lifted,
  MARKER,
  README,
  remoteFiles,
  ROWS,
  sessionFile,
  syncUntilQuiet,
  T0,
  template,
  templateFile,
  upgradedDevice,
  withoutConflicts,
} from './sync-harness';

/**
 * Format 1 to 2 (DATA.md, The files): a log a format-1 build kept is migrated
 * in one commit before anything else, and a device that build wrote is opened
 * by this one with its unsynced changes intact, which then reach the migrated
 * log as changes, not as conflicts.
 */

function plan(id: string, intention: string): Template {
  return {
    ...template(id, intention),
    exercises: [{ exercise_id: 'low_bar_squat', rest_s: null, prescribed: [] }],
  };
}

const S1 = lifted('2026-09-14-aaaa', 'v0');
const S2 = lifted('2026-09-16-bbbb', 'v0');
const T1 = plan('squat-day-a-k3f9', 'v0');
const SAVED: ConflictRecord = {
  id: '2026-09-20-7xq2',
  path: templatePath(T1.id),
  key: null,
  found_at: '2026-09-20T10:00:00.000Z',
  device_id: 'dev-x',
  version: plan(T1.id, 'the other one'),
};

/** The log a format-1 build kept: two sessions, a template, a conflict and three weigh-ins. */
function oldLog(): MemoryRemote {
  return format1Log([
    [sessionPath(S1.id), sessionV1(S1)],
    [sessionPath(S2.id), sessionV1(S2)],
    [templatePath(T1.id), templateV1(T1)],
    [conflictPath(SAVED.id), conflictV1(SAVED)],
    [BODYWEIGHT, bodyweight(ROWS)!],
  ]);
}

/** That log in format 2. */
const MIGRATED = new Map([
  [FORMAT_PATH, MARKER],
  sessionFile(S1),
  sessionFile(S2),
  templateFile(T1),
  [conflictPath(SAVED.id), serializeConflict(SAVED)],
  [BODYWEIGHT, bodyweight(ROWS)!],
]);

// What the old build's device A did after its last sync.
const S1_A = lifted(S1.id, 'a');
const S3 = lifted('2026-09-18-cccc', 'a');
const T1_A = plan(T1.id, 'a');
const WEIGHED = { ...ROWS, '2026-09-04': 84 };
const A_CHANGES: Array<[string, string | null]> = [
  [sessionPath(S1_A.id), sessionV1(S1_A)],
  [sessionPath(S2.id), null],
  [sessionPath(S3.id), sessionV1(S3)],
  [templatePath(T1_A.id), templateV1(T1_A)],
  [BODYWEIGHT, bodyweight(WEIGHED)!],
];
/** The migrated log with A's changes in it. */
const WITH_A = new Map([
  [FORMAT_PATH, MARKER],
  sessionFile(S1_A),
  sessionFile(S3),
  templateFile(T1_A),
  [conflictPath(SAVED.id), serializeConflict(SAVED)],
  [BODYWEIGHT, bodyweight(WEIGHED)!],
]);

/** A, as this build opens what the old build left on it. */
async function deviceA(remote: MemoryRemote, seed = 1): Promise<Device> {
  return upgradedDevice(remote, 'dev-a', await format1Records(remote, A_CHANGES), { seed });
}

/** How many commits whose message says they migrate the log. */
function migrations(messages: string[]): number {
  return messages.filter((m) => m.startsWith('sync: migrate the log to format 2')).length;
}

/** The messages of every commit `remote.commit` is asked for during `work`. */
async function commitsDuring(remote: MemoryRemote, work: () => Promise<unknown>) {
  const messages: string[] = [];
  const commit = remote.commit.bind(remote);
  remote.commit = async (input) => {
    messages.push(input.message);
    return commit(input);
  };
  try {
    await work();
  } finally {
    remote.commit = commit;
  }
  return messages;
}

describe('a log in format 1', () => {
  it('is migrated in one commit before anything else, every record in it rewritten', async () => {
    const remote = oldLog();
    remote.externalCommit([{ path: 'notes.md', content: 'mine\n' }]);
    const commits = remote.commitCount();
    const b = new Device(remote, 'dev-b');

    const messages = await commitsDuring(remote, () => b.sync());

    // A new device has nothing to push: the one commit is the migration.
    expect(messages).toEqual(['sync: migrate the log to format 2']);
    expect(remote.commitCount()).toBe(commits + 1);
    expect(remoteFiles(remote)).toEqual(MIGRATED);
    // Files that are not the app's are carried forward untouched.
    expect(remote.files().get('README.md')).toBe(README);
    expect(remote.files().get('notes.md')).toBe('mine\n');
    await expectConverged(remote, b);
  });

  it('is not migrated by a pull, which never commits; the next full sync migrates it', async () => {
    const remote = oldLog();
    const a = await deviceA(remote);
    const head = await remote.head();
    const files = await a.files();
    const unsynced = async () =>
      (await a.disk.entries()).flatMap((e) => (e.unsynced_since === null ? [] : [e.path]));
    const before = await unsynced();

    const result = await a.sync('pull');
    expect(result).toMatchObject({ committed: null, pushed: [], taken: [], conflicts: [] });
    expect(await remote.head()).toBe(head);
    expect(await a.files()).toEqual(files);
    expect(await unsynced()).toEqual(before);
    expect((await a.disk.meta()).last_synced_tree).toBeNull();

    await a.sync();
    expect(remoteFiles(remote)).toEqual(WITH_A);
  });

  it('keeps a file that does not parse as it is, and reports it as before', async () => {
    const broken = sessionPath('2026-09-19-dddd');
    const remote = oldLog();
    remote.externalCommit([{ path: broken, content: '{"id": \n' }]);
    const b = new Device(remote, 'dev-b');
    const result = await b.sync();
    expect(result.unreadable).toEqual([broken]);
    expect(remote.files().get(broken)).toBe('{"id": \n');
    expect(remote.files().get(FORMAT_PATH)).toBe(MARKER);
    expect(remote.files().get(sessionPath(S1.id))).toBe(sessionFile(S1)[1]);
  });

  it('loses nothing committed while it was being migrated: the move fails, and it migrates again', async () => {
    // An old build, still on format 1, commits a session as the migration is
    // about to land. Moving fast-forward only, the migration is refused.
    const remote = oldLog();
    const S4 = lifted('2026-09-21-eeee', 'from the old build');
    remote.beforeMove = () => {
      remote.beforeMove = null;
      remote.externalCommit([{ path: sessionPath(S4.id), content: sessionV1(S4) }]);
    };
    const b = new Device(remote, 'dev-b');
    const messages = await commitsDuring(remote, () => b.sync());
    expect(migrations(messages)).toBe(2);
    expect(remoteFiles(remote)).toEqual(new Map([...MIGRATED, sessionFile(S4)]));
    await expectConverged(remote, b);
  });

  it('is migrated once: a marker set back by hand costs a commit and changes no record', async () => {
    const remote = oldLog();
    const b = new Device(remote, 'dev-b');
    await b.sync();
    remote.externalCommit([{ path: FORMAT_PATH, content: MARKER_V1 }]);
    await b.sync();
    expect(remoteFiles(remote)).toEqual(MIGRATED);
    await expectConverged(remote, b);
  });
});

describe('a device a format-1 build wrote', () => {
  it('reads at once, offline, what the old build left: changes included', async () => {
    const remote = oldLog();
    const a = await deviceA(remote);
    const log = new Log(a.disk, { deviceId: 'dev-a', shipped: [] });
    expect(await log.getSession(S1.id)).toEqual(S1_A);
    expect(await log.getSession(S2.id)).toBeNull();
    expect(await log.getSession(S3.id)).toEqual(S3);
    expect(await log.getTemplates()).toEqual([T1_A]);
    expect(await log.getConflicts()).toEqual([SAVED]);
    // Still waiting to be synced, every one of them.
    const unsynced = (await a.disk.entries()).filter((e) => e.unsynced_since !== null);
    expect(unsynced.map((e) => e.path).sort()).toEqual(A_CHANGES.map(([path]) => path).sort());
  });

  it('migrates the log, then pushes its changes in format 2, with no conflict', async () => {
    const remote = oldLog();
    const a = await deviceA(remote);
    const messages = await commitsDuring(remote, () => a.sync());
    expect(messages).toEqual([
      'sync: migrate the log to format 2',
      expect.stringMatching(/^sync: /),
    ]);
    expect(remoteFiles(remote)).toEqual(WITH_A);
    expect(conflictsIn(remoteFiles(remote))).toEqual([SAVED]);
    await expectConverged(remote, a);
  });

  it('updated after another device migrated the log: its changes are pushed, not conflicts', async () => {
    const remote = oldLog();
    const a = await deviceA(remote);
    const b = new Device(remote, 'dev-b', { seed: 2 });
    await b.sync();

    let messages: string[] = [];
    const calls = await callsDuring(remote, async () => {
      messages = await commitsDuring(remote, () => a.sync());
    });
    expect(migrations(messages)).toBe(0);
    // Its bases from before the migration, read by sha and migrated as the log's were.
    expect(calls.filter((call) => call === 'blob').length).toBeGreaterThan(0);
    expect(remoteFiles(remote)).toEqual(WITH_A);
    await b.sync();
    await expectConverged(remote, a, b);
  });

  it('where the log changed a file it also changed, there is a conflict, as before', async () => {
    const remote = oldLog();
    const a = await deviceA(remote);
    const b = new Device(remote, 'dev-b', { seed: 2 });
    await b.sync();
    const S1_B = lifted(S1.id, 'b');
    await b.put(sessionFile(S1_B));
    await b.sync();

    const result = await a.sync();
    expect(result.conflicts).toEqual([
      expect.objectContaining({ path: sessionPath(S1.id), device_id: 'dev-a', version: S1_A }),
    ]);
    expect(remote.files().get(sessionPath(S1.id))).toBe(sessionFile(S1_B)[1]);
    await syncUntilQuiet(a, b);
    await expectConverged(remote, a, b);
  });

  it('keeps an old base the log does not hold: a difference is a conflict, never a loss', async () => {
    // A base the remote never held under that sha (the old build took a file
    // edited by hand, in a pull, and never pushed its own form of it).
    const remote = oldLog();
    const records = await format1Records(remote, [[sessionPath(S1_A.id), sessionV1(S1_A)]]);
    const entry = records.entries.find((e) => e.path === sessionPath(S1.id))!;
    entry.base_sha = blobSha(`${JSON.stringify(JSON.parse(sessionV1(S1)))}\n`);
    const a = upgradedDevice(remote, 'dev-a', records);

    const result = await a.sync();
    expect(result.conflicts).toEqual([
      expect.objectContaining({ path: sessionPath(S1.id), version: S1_A }),
    ]);
    expect(remote.files().get(sessionPath(S1.id))).toBe(sessionFile(S1)[1]);
    await expectConverged(remote, a);
  });

  it('killed while landing a commit before the update: finds it landed, and is not in conflict with itself', async () => {
    const remote = oldLog();
    const records = await format1Records(remote, [[sessionPath(S1_A.id), sessionV1(S1_A)]]);
    const head = records.meta!.last_synced_head!;
    // The commit the old build landed, then died before settling.
    const landed = remote.externalCommit([
      { path: sessionPath(S1_A.id), content: sessionV1(S1_A) },
    ]);
    const tree = (await remote.tree(landed)).sha;
    const inflight: Format1Records['inflight'] = {
      commit: landed,
      tree,
      parent: head,
      pushed: [{ path: sessionPath(S1_A.id), sha: blobSha(sessionV1(S1_A)), body: null }],
    };
    const a = upgradedDevice(remote, 'dev-a', { ...records, inflight });
    // And edited it again since, which would conflict with its own commit if
    // that were taken for someone else's.
    const S1_A2 = lifted(S1.id, 'a, again');
    await a.put(sessionFile(S1_A2));

    const result = await a.sync();
    expect(result.conflicts).toEqual([]);
    expect(remote.files().get(sessionPath(S1.id))).toBe(sessionFile(S1_A2)[1]);
    await expectConverged(remote, a);
  });

  it('two upgrading at once: one migration lands, the other finds the log migrated', async () => {
    const remote = oldLog();
    const a = await deviceA(remote);
    const S2_B = lifted(S2.id, 'b');
    const b = upgradedDevice(
      remote,
      'dev-b',
      await format1Records(remote, [[sessionPath(S2_B.id), sessionV1(S2_B)]]),
      { seed: 2 },
    );

    // B syncs, migration and all, just as A is about to move its migration in.
    const move = remote.moveBranch.bind(remote);
    remote.moveBranch = async (from, to) => {
      remote.moveBranch = move;
      await b.sync();
      return move(from, to);
    };
    const messages = await commitsDuring(remote, () => a.sync());
    expect(migrations(messages)).toBe(2);

    await syncUntilQuiet(a, b);
    // A deleted S2 and B changed it: the one conflict between them. Everything
    // else either changed is in the log.
    const files = remoteFiles(remote);
    expect(withoutConflicts(files)).toEqual(
      new Map([...withoutConflicts(WITH_A), sessionFile(S2_B)]),
    );
    expect(conflictsIn(files).filter((c) => c.id !== SAVED.id)).toEqual([
      expect.objectContaining({ path: sessionPath(S2.id), device_id: 'dev-a', version: null }),
    ]);
    await expectConverged(remote, a, b);
  });
});

describe('killed anywhere in the migration', () => {
  /** A, from before the update, with changes to push; B, a new device that has never synced. */
  async function scenario() {
    const remote = oldLog();
    const a = await deviceA(remote);
    const b = new Device(remote, 'dev-b', { seed: 2 });
    return { remote, a, b };
  }

  /** Every device converged on the log with A's changes, and no conflict but the one there was. */
  async function expectEverything(remote: MemoryRemote, a: Device, b: Device) {
    a.restart();
    await syncUntilQuiet(a, b);
    expect(remoteFiles(remote)).toEqual(WITH_A);
    await expectConverged(remote, a, b);
    expect(parseSession(remote.files().get(sessionPath(S1.id))!).exercises[0].rest_s).toBeNull();
  }

  /** How many times A's uninterrupted sync makes each remote call, and how many applies. */
  async function census() {
    const { remote, a } = await scenario();
    const calls = await callsDuring(remote, () => a.sync());
    const counts = new Map<RemoteOp, number>();
    for (const call of calls) counts.set(call, (counts.get(call) ?? 0) + 1);
    return counts;
  }

  /** Makes the nth `op` throw: before it runs, or after, its answer lost. */
  function killAt(remote: MemoryRemote, op: RemoteOp, n: number, answered: boolean): void {
    const original = (remote[op] as (...args: unknown[]) => Promise<unknown>).bind(remote);
    let seen = 0;
    (remote as unknown as Record<string, unknown>)[op] = async (...args: unknown[]) => {
      if (++seen !== n) return original(...args);
      (remote as unknown as Record<string, unknown>)[op] = original;
      if (answered) await original(...args);
      throw killed();
    };
  }

  it('at any remote call, before or after it answers', async () => {
    const counts = await census();
    expect(counts.get('moveBranch')).toBe(2);
    for (const [op, count] of counts) {
      for (let n = 1; n <= count; n++) {
        for (const answered of [false, true]) {
          const { remote, a, b } = await scenario();
          killAt(remote, op, n, answered);
          await a.sync().catch(() => undefined);
          await expectEverything(remote, a, b);
        }
      }
    }
  });

  it('at any write to the device', async () => {
    for (let n = 1; n <= 6; n++) {
      const { remote, a, b } = await scenario();
      a.crashAtApply(n);
      await a.sync().catch(() => undefined);
      await expectEverything(remote, a, b);
    }
  });

  it('after another device migrated the log, while reading its own old bases', async () => {
    for (let n = 1; n <= 3; n++) {
      const { remote, a, b } = await scenario();
      await b.sync();
      killAt(remote, 'blob', n, false);
      await a.sync().catch(() => undefined);
      // Still marked: the next sync reads them again.
      expect((await a.disk.entries()).some((e) => e.base_format !== null)).toBe(true);
      await expectEverything(remote, a, b);
    }
  });

  it('while writing the migrated bases to the device', async () => {
    const { remote, a, b } = await scenario();
    await b.sync();
    a.crashAtApply(1);
    await a.sync().catch(() => undefined);
    expect((await a.disk.entries()).some((e) => e.base_format !== null)).toBe(true);
    await expectEverything(remote, a, b);
  });
});

describe('the device’s copy, against the log it agrees with', () => {
  it('is in agreement after the update wherever it was before, and matches the migrated log', async () => {
    // A synced with the log and changed nothing: after the update it needs no
    // base from the remote, and the migrated log matches it file for file.
    const remote = oldLog();
    const a = upgradedDevice(remote, 'dev-a', await format1Records(remote));
    expect((await a.disk.entries()).every((e) => e.base_format === null)).toBe(true);
    const result = await a.sync();
    expect(result.conflicts).toEqual([]);
    expect(result.taken).toEqual([FORMAT_PATH]);
    expect(remoteFiles(remote)).toEqual(MIGRATED);
    await expectConverged(remote, a);
  });

  it('dated as the old build left it: the change is as old as it was', async () => {
    const remote = oldLog();
    const a = await deviceA(remote);
    const entry = await a.disk.entry(sessionPath(S1.id));
    expect(entry).toMatchObject({ unsynced_since: T0, base_format: 1 });
  });
});
