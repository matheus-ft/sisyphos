import { describe, expect, it, vi } from 'vitest';
import { SyncError } from '../src/storage/errors';
import { serializeSession } from '../src/storage/formats';
import { blobSha } from '../src/storage/hash';
import { FORMAT_PATH, sessionPath, templatePath } from '../src/storage/paths';
import type { MemoryRemote } from '../src/storage/remote/memory';
import type { SyncResult } from '../src/storage/sync';
import {
  BODYWEIGHT,
  bodyweight,
  callsDuring,
  change,
  conflictsIn,
  Device,
  expectConverged,
  killed,
  MARKER,
  rejection,
  remoteFiles,
  ROWS,
  S1,
  S2,
  session,
  sessionFile,
  synced,
  syncUntilQuiet,
  T0,
  T1,
  template,
  templateFile,
  withoutConflicts,
} from './sync-harness';

/**
 * Races and crashes: committing, moving the branch, settling, and recovering an
 * unfinished commit (steps 7 to 10 of `runSync`).
 *
 * A device is killed at every await of a sync in turn: a remote operation that
 * never answers (`failNext`), or the store dying on its Nth `apply`. It is then
 * relaunched over what reached its disk, and syncs alongside another device
 * until both are quiet. Wherever it died, both must end holding the same log,
 * with every change either device made and no conflict but the real one.
 */

const S3 = session('2026-09-17-cccc', 'a');
const S4 = session('2026-09-18-dddd', 'b');
const S5 = session('2026-09-19-eeee', 'b');
const S6 = session('2026-09-20-ffff', 'another device');
const S1_A = session(S1.id, 'a');
const S1_A2 = session(S1.id, 'a, again');
const T_A = template(T1.id, 'a');
const T_B = template(T1.id, 'b');

/**
 * Two devices that agreed on a log, then each changed it. B has synced; A has
 * not. A's sync takes, pushes, deletes, merges a table key by key and finds one
 * conflict, so every step of a sync has work to do.
 */
async function diverged() {
  const { remote, a, b } = await synced();
  await b.put(sessionFile(S4));
  await b.put(templateFile(T_B));
  await b.write(BODYWEIGHT, bodyweight({ '2026-09-01': 80, '2026-09-02': 81.5 }));
  await b.sync();

  await a.put(sessionFile(S1_A));
  await a.put(sessionFile(S3));
  await a.write(sessionPath(S2.id), null);
  await a.put(templateFile(T_A));
  await a.write(BODYWEIGHT, bodyweight({ ...ROWS, '2026-09-01': 83, '2026-09-04': 84 }));
  return { remote, a, b };
}

/**
 * A is relaunched and edits again what it was pushing, which is where treating
 * its own commit as someone else's would show as a conflict. B logs a session
 * and syncs. Then both sync until quiet.
 */
/**
 * What recovery was told about this device's recorded commit. It must ask
 * exactly once; the sync's other `contains` calls are history checks (step 2 of
 * `runSync`), about the last synced head, never about a recorded commit.
 */
async function recoveryAnswer(
  contains: { mock: { calls: unknown[][]; results: Array<{ value: unknown }> } },
  commit: string,
): Promise<boolean> {
  const asked = contains.mock.calls.flatMap((args, i) =>
    args[0] === commit ? [contains.mock.results[i].value] : [],
  );
  expect(asked).toHaveLength(1);
  return (await asked[0]) as boolean;
}

async function carryOn(remote: MemoryRemote, a: Device, b: Device): Promise<void> {
  a.restart();
  await a.put(sessionFile(S1_A2));
  await a.weigh('2026-09-01', 85);
  await b.put(sessionFile(S5));
  await b.sync();
  await syncUntilQuiet(a, b);
}

/** Every change either device made, and the one real conflict: T1, edited by both. */
async function expectEverything(remote: MemoryRemote, a: Device, b: Device, extra = new Map()) {
  expect(withoutConflicts(remoteFiles(remote))).toEqual(
    new Map([
      [FORMAT_PATH, MARKER],
      [BODYWEIGHT, bodyweight({ '2026-09-01': 85, '2026-09-02': 81.5, '2026-09-04': 84 })!],
      sessionFile(S1_A2),
      sessionFile(S3),
      sessionFile(S4),
      sessionFile(S5),
      templateFile(T_B),
      ...extra,
    ]),
  );
  expect(conflictsIn(remoteFiles(remote))).toEqual([
    {
      id: expect.stringMatching(/^2026-09-27-/),
      path: templatePath(T1.id),
      key: null,
      found_at: T0,
      device_id: 'dev-a',
      version: T_A,
    },
  ]);
  await expectConverged(remote, a, b);
}

/** A remote whose next branch move lands, and whose answer never arrives. */
function loseTheAnswer(remote: MemoryRemote): void {
  const move = remote.moveBranch.bind(remote);
  remote.moveBranch = async (from, to) => {
    remote.moveBranch = move;
    await move(from, to);
    throw killed();
  };
}

describe('killed at every step of a sync', () => {
  const KILLS: Array<[string, (remote: MemoryRemote, a: Device) => void]> = [
    ['reading the head', (remote) => remote.failNext('head', killed())],
    ['reading the tree', (remote) => remote.failNext('tree', killed())],
    ['fetching', (remote) => remote.failNext('blob', killed())],
    ['applying the decision', (_, a) => a.crashAtApply(1)],
    ['writing the commit', (remote) => remote.failNext('commit', killed())],
    ['recording the commit', (_, a) => a.crashAtApply(2)],
    ['moving the branch', (remote) => remote.failNext('moveBranch', killed())],
    ['moving the branch, the answer lost after it moved', (remote) => loseTheAnswer(remote)],
    ['settling, after the branch moved', (_, a) => a.crashAtApply(3)],
  ];

  it.each(KILLS)(
    'while %s: converges with everything kept and only the real conflict',
    async (_, kill) => {
      const { remote, a, b } = await diverged();
      kill(remote, a);
      await expect(a.sync()).rejects.toThrow('killed');
      await carryOn(remote, a, b);
      await expectEverything(remote, a, b);
    },
  );

  it('after the branch moved, recovers its own commit before anything else, even in a pull', async () => {
    const { remote, a, b } = await diverged();
    a.crashAtApply(3);
    await expect(a.sync()).rejects.toThrow('killed');
    a.restart();
    expect(await remote.head()).toBe((await a.disk.inflight())!.commit);
    // Relaunched mid-session, the lifter edits again what the lost settle had pushed.
    await a.put(sessionFile(S1_A2));
    await a.weigh('2026-09-01', 85);
    await b.put(sessionFile(S5));
    await b.sync();

    // The launch pulls. The commit landed, so the pushed paths' bases move to it,
    // and the new edits read as changes on top of it, not as a conflict with it.
    const calls = await callsDuring(remote, () => a.sync('pull'));
    expect(calls.slice(0, 2)).toEqual(['head', 'contains']);
    expect(await a.disk.inflight()).toBeNull();
    expect(await a.disk.entry(sessionPath(S1.id))).toMatchObject({
      base_sha: blobSha(serializeSession(S1_A)),
      local_sha: blobSha(serializeSession(S1_A2)),
    });
    expect((await a.disk.entry(BODYWEIGHT))!.base_body).toBe(
      bodyweight({ '2026-09-01': 83, '2026-09-02': 81.5, '2026-09-04': 84 }),
    );

    await syncUntilQuiet(a, b);
    await expectEverything(remote, a, b);
  });

  const RECOVERY: Array<[string, (remote: MemoryRemote, a: Device) => void]> = [
    ['reading the head', (remote) => remote.failNext('head', killed())],
    ['asking whether the commit landed', (remote) => remote.failNext('contains', killed())],
    ['settling what landed', (_, a) => a.crashAtApply(1)],
  ];

  it.each(RECOVERY)('and again while recovering, %s: still converges', async (_, kill) => {
    const { remote, a, b } = await diverged();
    a.crashAtApply(3);
    await expect(a.sync()).rejects.toThrow('killed');
    a.restart();
    kill(remote, a);
    await expect(a.sync()).rejects.toThrow('killed');
    expect(await a.disk.inflight()).not.toBeNull();
    await carryOn(remote, a, b);
    await expectEverything(remote, a, b);
  });

  it('after losing a race, before forgetting the commit: finds it never landed', async () => {
    const { remote, a, b } = await diverged();
    remote.beforeMove = () => {
      remote.beforeMove = null;
      remote.externalCommit([change(sessionFile(S6))]);
    };
    // Applies: 1 decide, 2 record, 3 forget after the race.
    a.crashAtApply(3);
    await expect(a.sync()).rejects.toThrow('killed');
    const commit = (await a.disk.inflight())!.commit;
    const contains = vi.spyOn(remote, 'contains');
    await carryOn(remote, a, b);
    await expect(recoveryAnswer(contains, commit)).resolves.toBe(false);
    await expectEverything(remote, a, b, new Map([sessionFile(S6)]));
  });

  it('while settling the round that won after a lost one', async () => {
    const { remote, a, b } = await diverged();
    remote.beforeMove = () => {
      remote.beforeMove = null;
      remote.externalCommit([change(sessionFile(S6))]);
    };
    // Applies: 1 to 3 in the lost round, 4 decide, 5 record, 6 settle.
    a.crashAtApply(6);
    await expect(a.sync()).rejects.toThrow('killed');
    await carryOn(remote, a, b);
    await expectEverything(remote, a, b, new Map([sessionFile(S6)]));
  });
});

describe('determinism', () => {
  it('makes the same decisions, conflict ids included, given the same clock and random', async () => {
    const run = async () => {
      const { remote, a, b } = await diverged();
      const { head: _head, committed: _committed, ...result } = await a.sync();
      await b.sync();
      // Commit shas differ between remotes, as between repositories; nothing else may.
      return { result, files: remoteFiles(remote) };
    };
    const first = await run();
    expect(first.result.conflicts).toHaveLength(1);
    expect(await run()).toEqual(first);
  });
});

describe('racing another device', () => {
  it('loses the race, merges what landed first, and lands on top of it', async () => {
    const { remote, a, b } = await synced();
    await a.put(sessionFile(S1_A));
    remote.beforeMove = () => {
      remote.beforeMove = null;
      remote.externalCommit([change(sessionFile(S6))]);
    };
    const commits = remote.commitCount();

    let result: SyncResult | undefined;
    const calls = await callsDuring(remote, async () => {
      result = await a.sync();
    });
    expect(calls).toEqual([
      ...['head', 'commit', 'moveBranch'],
      // The head moved, so the round first checks it still holds the last synced one.
      ...['head', 'contains', 'tree', 'blob', 'commit', 'moveBranch'],
    ]);
    expect(remote.commitCount()).toBe(commits + 2);
    expect(result).toEqual({
      head: await remote.head(),
      committed: await remote.head(),
      pushed: [sessionPath(S1.id)],
      taken: [sessionPath(S6.id)],
      conflicts: [],
      unreadable: [],
    });
    await b.sync();
    await expectConverged(remote, a, b);
  });

  it('does not mistake a row it took in the lost round for its own when the retry finds it changed again', async () => {
    const { remote, a, b } = await synced();
    await b.weigh('2026-09-05', 82);
    await b.sync();
    await a.weigh('2026-09-04', 81);
    // The round takes B's row and loses the race to B changing that row again.
    remote.beforeMove = () => {
      remote.beforeMove = null;
      remote.externalCommit([change([BODYWEIGHT, bodyweight({ ...ROWS, '2026-09-05': 83 })!])]);
    };

    const result = await a.sync();
    expect(result.conflicts).toEqual([]);
    expect(remote.files().get(BODYWEIGHT)).toBe(
      bodyweight({ ...ROWS, '2026-09-04': 81, '2026-09-05': 83 }),
    );
    await b.sync();
    await expectConverged(remote, a, b);
  });

  it('finds a conflict in the round after a lost race, and pushes it in the commit that lands', async () => {
    const { remote, a, b } = await synced();
    await a.put(sessionFile(S1_A));
    remote.beforeMove = () => {
      remote.beforeMove = null;
      remote.externalCommit([change(sessionFile(session(S1.id, 'another device')))]);
    };

    const result = await a.sync();
    expect(result.conflicts).toEqual([
      expect.objectContaining({ path: sessionPath(S1.id), version: S1_A }),
    ]);
    expect(conflictsIn(remoteFiles(remote))).toEqual(result.conflicts);
    await b.sync();
    await expectConverged(remote, a, b);
  });

  it('gives up with a retryable error after five lost rounds, and lands once the log is quiet', async () => {
    const { remote, a, b } = await diverged();
    let n = 0;
    remote.beforeMove = () =>
      void remote.externalCommit([{ path: 'notes/busy.md', content: `${++n}\n` }]);

    let error: unknown;
    const calls = await callsDuring(remote, async () => {
      error = await rejection(a.sync());
    });
    expect(error).toBeInstanceOf(SyncError);
    expect(error).toMatchObject({ kind: 'retryable' });
    expect(calls.filter((call) => call === 'moveBranch')).toHaveLength(5);
    expect(await a.disk.inflight()).toBeNull();

    remote.beforeMove = null;
    await carryOn(remote, a, b);
    await expectEverything(remote, a, b);
  });

  it('gives up after as many rounds as it is told', async () => {
    const { remote, a } = await diverged();
    remote.beforeMove = () =>
      void remote.externalCommit([{ path: 'notes/busy.md', content: '1\n' }]);
    const calls = await callsDuring(remote, () => rejection(a.sync('full', { maxRounds: 2 })));
    expect(calls.filter((call) => call === 'moveBranch')).toHaveLength(2);
  });

  it('throws a refusal that is not a race as it is, and the next sync lands the push', async () => {
    const { remote, a, b } = await diverged();
    const refusal = new SyncError(
      'repo',
      'GitHub refused the request: Update is not a fast forward',
    );
    remote.failNext('moveBranch', refusal);
    expect(await rejection(a.sync())).toBe(refusal);
    // Whether the branch moved is not known, so the commit stays recorded for recovery.
    expect(await a.disk.inflight()).not.toBeNull();

    const commit = (await a.disk.inflight())!.commit;
    const contains = vi.spyOn(remote, 'contains');
    await carryOn(remote, a, b);
    await expect(recoveryAnswer(contains, commit)).resolves.toBe(false);
    await expectEverything(remote, a, b);
  });
});
