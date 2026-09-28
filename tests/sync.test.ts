import { describe, expect, it, vi } from 'vitest';
import type { ConflictRecord } from '../src/model';
import { FormatError, SyncError } from '../src/storage/errors';
import {
  serializeConflict,
  serializeSession,
  serializeTemplate,
  TABLES,
  tableText,
} from '../src/storage/formats';
import { blobSha } from '../src/storage/hash';
import {
  classify,
  conflictPath,
  FORMAT_PATH,
  sessionPath,
  templatePath,
} from '../src/storage/paths';
import { MemoryRemote } from '../src/storage/remote/memory';
import type { SyncResult } from '../src/storage/sync';
import {
  BODYWEIGHT,
  bodyweight,
  callsDuring,
  change,
  conflictsIn,
  Device,
  expectConverged,
  expectQuiet,
  failure,
  killed,
  MARKER,
  newLog,
  README,
  rejection,
  remoteFiles,
  ROWS,
  S1,
  S2,
  session,
  sessionFile,
  synced,
  T0,
  T1,
  template,
  templateFile,
  weighIn,
  withoutConflicts,
} from './sync-harness';

/**
 * The sync (docs/STORAGE.md 4.2 to 4.5, 5.1, 6) against the in-memory store and
 * remote. Races and crashes are in sync-crash.test.ts.
 */

const CONFLICT_ID = /^2026-09-27-[0-9a-hjkmnp-tv-z]{4}$/;

const byId = (x: ConflictRecord, y: ConflictRecord) => (x.id < y.id ? -1 : 1);

describe('the first sync', () => {
  it('onto a fresh log takes the format marker and records the head, with no commit', async () => {
    const remote = newLog();
    const a = new Device(remote, 'dev-a');
    const head = (await remote.head())!;

    expect(await a.sync()).toEqual({
      head,
      committed: null,
      pushed: [],
      taken: [FORMAT_PATH],
      conflicts: [],
      unreadable: [],
    });
    expect(remote.commitCount()).toBe(2);
    expect(await a.files()).toEqual(new Map([[FORMAT_PATH, MARKER]]));
    expect(await a.disk.meta()).toEqual({
      last_synced_head: head,
      last_synced_tree: (await remote.tree(head)).sha,
    });
    await expectConverged(remote, a);
    await expectQuiet(a);
  });

  it('onto a fresh log pushes what the device holds in one commit, carrying the README forward', async () => {
    const remote = newLog();
    const a = new Device(remote, 'dev-a');
    await a.put(sessionFile(S1));
    await a.put(sessionFile(S2));
    await a.put(templateFile(T1));
    await a.write(BODYWEIGHT, bodyweight(ROWS));
    const commit = vi.spyOn(remote, 'commit');

    const result = await a.sync();
    expect(remote.commitCount()).toBe(3);
    expect(result.committed).toBe(await remote.head());
    expect(result.pushed).toEqual([
      BODYWEIGHT,
      sessionPath(S1.id),
      sessionPath(S2.id),
      templatePath(T1.id),
    ]);
    expect(commit.mock.calls[0][0].message).toBe('sync: 2 sessions, 1 template, bodyweight');
    expect(remote.files().get('README.md')).toBe(README);
    await expectConverged(remote, a);
    await expectQuiet(a);
  });

  it('restores a log that already holds data, fetching each file once and committing nothing', async () => {
    const remote = newLog();
    const saved: ConflictRecord = {
      id: '2026-09-20-x7q2',
      path: sessionPath(S1.id),
      key: null,
      found_at: '2026-09-20T09:00:00.000Z',
      device_id: 'dev-old',
      version: session(S1.id, 'saved'),
    };
    const oneRm = TABLES.oneRm;
    const files: [string, string][] = [
      sessionFile(S1),
      sessionFile(S2),
      templateFile(T1),
      [BODYWEIGHT, bodyweight(ROWS)!],
      [
        oneRm.path,
        tableText(oneRm, [
          oneRm.toRow({ date: '2026-09-01', lift: 'squat', weight_kg: 200, note: null }),
        ]),
      ],
      [conflictPath(saved.id), serializeConflict(saved)],
    ];
    remote.externalCommit(files.map(change));
    const a = new Device(remote, 'dev-a');

    let result: SyncResult | undefined;
    const calls = await callsDuring(remote, async () => {
      result = await a.sync();
    });
    // The marker, then every file: each fetched once.
    expect(calls).toEqual(['head', 'tree', ...files.map(() => 'blob'), 'blob']);
    expect(result).toMatchObject({ committed: null, pushed: [], conflicts: [] });
    expect(result!.taken).toEqual([FORMAT_PATH, ...files.map(([path]) => path)].sort());
    await expectConverged(remote, a);
    expect(await a.conflicts()).toEqual([saved]);
    await expectQuiet(a);
  });

  it('merges a device that logged before setup: null bases, a conflict wherever both differ', async () => {
    const remote = newLog();
    const S3 = session('2026-09-17-cccc', 'mine');
    const S4 = session('2026-09-18-dddd', 'theirs');
    const theirsS2 = session(S2.id, 'theirs');
    const mineS2 = session(S2.id, 'mine');
    remote.externalCommit(
      [
        sessionFile(S1),
        sessionFile(theirsS2),
        sessionFile(S4),
        [BODYWEIGHT, bodyweight({ '2026-09-01': 80, '2026-09-03': 82, '2026-09-04': 84 })!] as [
          string,
          string,
        ],
      ].map(change),
    );
    const a = new Device(remote, 'dev-a');
    await a.put(sessionFile(S1));
    await a.put(sessionFile(mineS2));
    await a.put(sessionFile(S3));
    await a.write(BODYWEIGHT, bodyweight({ '2026-09-01': 80, '2026-09-02': 81, '2026-09-04': 83 }));
    const commits = remote.commitCount();

    const result = await a.sync();

    // The same on both sides: nothing. Only in the log: taken. Only on the
    // device: pushed. Different on each: the log's stands, the device's is saved.
    expect(result.conflicts.map((c) => [c.path, c.key, c.version])).toEqual([
      [BODYWEIGHT, { date: '2026-09-04' }, weighIn('2026-09-04', 83)],
      [sessionPath(S2.id), null, mineS2],
    ]);
    for (const conflict of result.conflicts) {
      expect(conflict).toMatchObject({ id: expect.stringMatching(CONFLICT_ID), found_at: T0 });
      expect(conflict.device_id).toBe('dev-a');
    }
    expect(remote.commitCount()).toBe(commits + 1);
    expect(result.taken).toEqual(
      [FORMAT_PATH, BODYWEIGHT, sessionPath(S2.id), sessionPath(S4.id)].sort(),
    );
    expect(result.pushed).toEqual(
      [
        BODYWEIGHT,
        sessionPath(S3.id),
        ...result.conflicts.map((conflict) => conflictPath(conflict.id)),
      ].sort(),
    );

    const files = remoteFiles(remote);
    expect(withoutConflicts(files)).toEqual(
      new Map([
        [FORMAT_PATH, MARKER],
        [
          BODYWEIGHT,
          bodyweight({ '2026-09-01': 80, '2026-09-02': 81, '2026-09-03': 82, '2026-09-04': 84 })!,
        ],
        sessionFile(S1),
        sessionFile(theirsS2),
        sessionFile(S3),
        sessionFile(S4),
      ]),
    );
    expect(conflictsIn(files).sort(byId)).toEqual([...result.conflicts].sort(byId));
    await expectConverged(remote, a);
  });
});

describe('normal operation', () => {
  it('pushes an edit and a deletion, and the other device takes both', async () => {
    const { remote, a, b } = await synced();
    await a.put(sessionFile(session(S1.id, 'v1')));
    await a.write(sessionPath(S2.id), null);

    const pushed = await a.sync();
    expect(pushed.pushed).toEqual([sessionPath(S1.id), sessionPath(S2.id)]);
    expect(pushed.committed).toBe(await remote.head());
    expect(remote.files().has(sessionPath(S2.id))).toBe(false);

    const taken = await b.sync();
    expect(taken).toMatchObject({
      committed: null,
      pushed: [],
      taken: [sessionPath(S1.id), sessionPath(S2.id)],
      conflicts: [],
    });
    await expectConverged(remote, a, b);
  });

  it('merges a table where each side changed different rows, in one commit keeping both', async () => {
    const { remote, a, b } = await synced();
    // B edits one row and deletes another; A edits a third and adds one.
    await b.write(BODYWEIGHT, bodyweight({ '2026-09-01': 80, '2026-09-02': 81.5 }));
    await b.sync();
    await a.write(BODYWEIGHT, bodyweight({ ...ROWS, '2026-09-01': 79.5, '2026-09-04': 83 }));
    const commits = remote.commitCount();

    const result = await a.sync();
    expect(remote.commitCount()).toBe(commits + 1);
    expect(result).toMatchObject({ pushed: [BODYWEIGHT], taken: [BODYWEIGHT], conflicts: [] });
    expect(remote.files().get(BODYWEIGHT)).toBe(
      bodyweight({ '2026-09-01': 79.5, '2026-09-02': 81.5, '2026-09-04': 83 }),
    );
    await b.sync();
    await expectConverged(remote, a, b);
  });

  it('makes one request when nothing changed on either side', async () => {
    const { a, b } = await synced();
    await expectQuiet(a);
    await expectQuiet(b);
  });

  it('reads no tree and fetches nothing when only the device changed', async () => {
    const { remote, a } = await synced();
    await a.put(sessionFile(session(S1.id, 'v1')));
    await a.write(BODYWEIGHT, bodyweight({ '2026-09-01': 80 }));
    expect(await callsDuring(remote, () => a.sync())).toEqual(['head', 'commit', 'moveBranch']);
    await expectConverged(remote, a);
  });

  it('fetches only what changed elsewhere', async () => {
    const { remote, a, b } = await synced();
    await b.put(sessionFile(session(S1.id, 'v1')));
    await b.sync();
    expect(await callsDuring(remote, () => a.sync())).toEqual(['head', 'tree', 'blob']);
    await expectConverged(remote, a, b);
  });

  it('never reads, changes or deletes a file that is not the app’s, and carries it forward', async () => {
    const { remote, a, b } = await synced();
    const foreign = new Map([
      ['README.md', '# My training log\n'],
      ['notes/peaking.md', 'Meet in November.\n'],
      ['sessions/notes.txt', 'not a session\n'],
      ['sessions/2025/2026-01-01-abcd.json', '{"filed": "under the wrong year"}\n'],
      ['lifter/bodyweight.txt', 'not the table\n'],
      ['conflicts/README', 'not a conflict\n'],
    ]);
    remote.externalCommit([...foreign].map(change));
    await a.put(sessionFile(session(S1.id, 'v1')));
    await a.write(sessionPath(S2.id), null);

    const calls = await callsDuring(remote, () => a.sync());
    expect(calls).toEqual(['head', 'tree', 'commit', 'moveBranch']);
    for (const [path, content] of foreign) expect(remote.files().get(path)).toBe(content);
    await b.sync();
    for (const device of [a, b]) {
      expect([...(await device.files()).keys()].filter((path) => foreign.has(path))).toEqual([]);
    }
    await expectConverged(remote, a, b);
  });

  it('sends no deletion for a file the log no longer holds', async () => {
    const { remote, a, b } = await synced();
    await b.write(sessionPath(S2.id), null);
    await b.sync();
    await a.write(sessionPath(S2.id), null);
    expect((await a.sync()).committed).toBeNull();
    await expectConverged(remote, a, b);
  });

  it('includes an edit made while the commit was being written in the next sync', async () => {
    const { remote, a } = await synced();
    const v1 = session(S1.id, 'v1');
    const v2 = session(S1.id, 'v2');
    await a.put(sessionFile(v1));
    const commit = remote.commit.bind(remote);
    remote.commit = async (input) => {
      remote.commit = commit;
      await a.put(sessionFile(v2));
      return commit(input);
    };

    const result = await a.sync();
    expect(remote.files().get(sessionPath(S1.id))).toBe(serializeSession(v1));
    // The base is what landed; the device holds a newer edit, so the path still needs syncing.
    expect(await a.disk.entry(sessionPath(S1.id))).toMatchObject({
      base_sha: blobSha(serializeSession(v1)),
      local_sha: blobSha(serializeSession(v2)),
    });
    expect((await a.disk.meta()).last_synced_head).toBe(result.committed);

    expect(await callsDuring(remote, () => a.sync())).toEqual(['head', 'commit', 'moveBranch']);
    expect(remote.files().get(sessionPath(S1.id))).toBe(serializeSession(v2));
    await expectConverged(remote, a);
  });

  it('writes a table with no rows as no file', async () => {
    const { remote, a, b } = await synced();
    // The lifter deleted every weigh-in.
    await a.write(BODYWEIGHT, tableText(TABLES.bodyweight, []));
    expect(await a.sync()).toMatchObject({ pushed: [BODYWEIGHT], conflicts: [] });
    expect(remote.files().has(BODYWEIGHT)).toBe(false);
    expect(await a.disk.content(BODYWEIGHT)).toBeNull();
    await b.sync();
    await expectConverged(remote, a, b);

    // An empty table written again is no change for the log.
    await a.write(TABLES.oneRm.path, tableText(TABLES.oneRm, []));
    expect(await a.sync()).toMatchObject({ committed: null, taken: [] });
    await expectConverged(remote, a, b);
  });

  it('says what the commit holds', async () => {
    const { remote, a, b } = await synced();
    const old: ConflictRecord = {
      id: '2026-09-20-x7q2',
      path: sessionPath(S1.id),
      key: null,
      found_at: '2026-09-20T09:00:00.000Z',
      device_id: 'dev-old',
      version: null,
    };
    remote.externalCommit([change([conflictPath(old.id), serializeConflict(old)])]);
    await a.sync();
    await b.put(templateFile(template(T1.id, 'theirs')));
    await b.sync();
    // Two sessions, a new template, a table, a conflict on T1, and the old record resolved.
    await a.put(sessionFile(session(S1.id, 'v1')));
    await a.put(sessionFile(session(S2.id, 'v1')));
    await a.put(templateFile(template('bench-day-b-m4r8')));
    await a.put(templateFile(template(T1.id, 'mine')));
    await a.write(BODYWEIGHT, bodyweight({ '2026-09-01': 80 }));
    await a.write(conflictPath(old.id), null);
    const commit = vi.spyOn(remote, 'commit');

    await a.sync();
    expect(commit.mock.calls[0][0].message).toBe(
      'sync: 2 sessions, 1 template, bodyweight, 1 conflict, 1 resolved',
    );
  });
});

describe('conflicts', () => {
  type Change = 'edit' | 'delete';
  const SHAPES: Array<[string, Change, Change]> = [
    ['both edited', 'edit', 'edit'],
    ['edited here, deleted elsewhere', 'edit', 'delete'],
    ['deleted here, edited elsewhere', 'delete', 'edit'],
  ];

  it.each(SHAPES)(
    '%s, a session: the log’s version stands and this one is saved, in the same commit',
    async (_, here, there) => {
      const { remote, a, b } = await synced();
      const path = sessionPath(S1.id);
      const theirs = there === 'edit' ? session(S1.id, 'theirs') : null;
      const mine = here === 'edit' ? session(S1.id, 'mine') : null;
      await b.write(path, theirs && serializeSession(theirs));
      await b.sync();
      await a.write(path, mine && serializeSession(mine));
      const commits = remote.commitCount();
      const commit = vi.spyOn(remote, 'commit');

      const result = await a.sync();
      expect(result.conflicts).toEqual([
        {
          id: expect.stringMatching(CONFLICT_ID),
          path,
          key: null,
          found_at: T0,
          device_id: 'dev-a',
          version: mine,
        },
      ]);
      const [conflict] = result.conflicts;
      expect(remote.commitCount()).toBe(commits + 1);
      expect(result.pushed).toEqual([conflictPath(conflict.id)]);
      expect(commit.mock.calls[0][0].message).toBe('sync: 1 conflict');
      expect(remote.files().get(conflictPath(conflict.id))).toBe(serializeConflict(conflict));
      const stands = theirs && serializeSession(theirs);
      expect(remote.files().get(path) ?? null).toBe(stands);
      expect((await a.files()).get(path) ?? null).toBe(stands);

      await b.sync();
      await expectConverged(remote, a, b);
      expect(await b.conflicts()).toEqual([conflict]);
    },
  );

  it.each(SHAPES)(
    '%s, a table row: the log’s row stands and this one is saved, in the same commit',
    async (_, here, there) => {
      const { remote, a, b } = await synced();
      const changed = (how: Change, weight: number) => {
        const rows: Record<string, number> = { ...ROWS };
        if (how === 'edit') rows['2026-09-02'] = weight;
        else delete rows['2026-09-02'];
        return rows;
      };
      await b.write(BODYWEIGHT, bodyweight(changed(there, 85)));
      await b.sync();
      // And a row of its own, which goes into the same commit.
      await a.write(BODYWEIGHT, bodyweight({ ...changed(here, 79), '2026-09-04': 83 }));

      const result = await a.sync();
      expect(result.conflicts).toEqual([
        {
          id: expect.stringMatching(CONFLICT_ID),
          path: BODYWEIGHT,
          key: { date: '2026-09-02' },
          found_at: T0,
          device_id: 'dev-a',
          version: here === 'edit' ? weighIn('2026-09-02', 79) : null,
        },
      ]);
      const [conflict] = result.conflicts;
      expect(result.pushed).toEqual([conflictPath(conflict.id), BODYWEIGHT]);
      const stands = bodyweight({ ...changed(there, 85), '2026-09-04': 83 });
      expect(remote.files().get(BODYWEIGHT)).toBe(stands);
      expect((await a.files()).get(BODYWEIGHT)).toBe(stands);

      await b.sync();
      await expectConverged(remote, a, b);
      expect(await b.conflicts()).toEqual([conflict]);
    },
  );

  it('two devices drawing the same conflict id: the log’s record stands, this one is saved again under a fresh id', async () => {
    // Same seed: both devices draw the same id for their first conflict.
    const remote = newLog();
    const a = new Device(remote, 'dev-a', { seed: 7 });
    const b = new Device(remote, 'dev-b', { seed: 7 });
    await a.put(sessionFile(S1));
    await a.put(templateFile(T1));
    await a.sync();
    await b.sync();
    // A third device changes both; A and B each change one of them differently.
    remote.externalCommit(
      [sessionFile(session(S1.id, 'third')), templateFile(template(T1.id, 'third'))].map(change),
    );
    await a.put(sessionFile(session(S1.id, 'a')));
    await b.put(templateFile(template(T1.id, 'b')));
    // A finds its conflict, but its commit never reaches the log...
    remote.failNext('commit', killed());
    await expect(a.sync()).rejects.toThrow('killed');
    const [mine] = await a.conflicts();
    // ...and B names its own conflict the same.
    const [theirs] = (await b.sync()).conflicts;
    expect(theirs.id).toBe(mine.id);
    expect([mine.path, theirs.path]).toEqual([sessionPath(S1.id), templatePath(T1.id)]);

    const result = await a.sync();
    expect(result.conflicts).toHaveLength(1);
    const [resaved] = result.conflicts;
    expect(resaved.id).toMatch(CONFLICT_ID);
    expect(resaved.id).not.toBe(mine.id);
    expect({ ...resaved, id: mine.id }).toEqual(mine);
    expect(result.pushed).toEqual([conflictPath(resaved.id)]);

    const files = remoteFiles(remote);
    expect(files.get(conflictPath(mine.id))).toBe(serializeConflict(theirs));
    expect(files.get(conflictPath(resaved.id))).toBe(serializeConflict(resaved));
    // Nothing nests: every record is about a session or a template.
    expect(conflictsIn(files).map((conflict) => classify(conflict.path).kind)).toEqual(
      expect.arrayContaining(['session', 'template']),
    );
    expect(conflictsIn(files)).toHaveLength(2);
    await b.sync();
    await expectConverged(remote, a, b);
    expect((await b.conflicts()).sort(byId)).toEqual([theirs, resaved].sort(byId));
  });
});

describe('a pull', () => {
  it('takes what changed elsewhere, leaves every local change as it is, and never commits', async () => {
    const { remote, a, b } = await synced();
    const S3 = session('2026-09-20-cccc', 'b');
    await b.put(sessionFile(session(S1.id, 'b')));
    await b.put(sessionFile(S3));
    await b.write(BODYWEIGHT, bodyweight({ ...ROWS, '2026-09-01': 79 }));
    await b.sync();
    const recorded = await a.disk.meta();
    // A edits S1 too (a conflict, in a full sync), S2, and a row B did not touch.
    await a.put(sessionFile(session(S1.id, 'a')));
    await a.put(sessionFile(session(S2.id, 'a')));
    await a.write(BODYWEIGHT, bodyweight({ ...ROWS, '2026-09-03': 85 }));
    const before = new Map((await a.disk.entries()).map((entry) => [entry.path, entry]));

    let result: SyncResult | undefined;
    const calls = await callsDuring(remote, async () => {
      result = await a.sync('pull');
    });
    expect(calls).toEqual(['head', 'tree', 'blob', 'blob', 'blob']);
    expect(result).toEqual({
      head: await remote.head(),
      committed: null,
      pushed: [],
      taken: [BODYWEIGHT, sessionPath(S3.id)],
      conflicts: [],
      unreadable: [],
    });
    const files = await a.files();
    expect(files.get(sessionPath(S3.id))).toBe(serializeSession(S3));
    expect(files.get(BODYWEIGHT)).toBe(bodyweight({ ...ROWS, '2026-09-01': 79, '2026-09-03': 85 }));
    // Local changes, bases included, exactly as they were.
    for (const path of [sessionPath(S1.id), sessionPath(S2.id)]) {
      expect(await a.disk.entry(path)).toEqual(before.get(path));
    }
    expect(files.get(sessionPath(S1.id))).toBe(serializeSession(session(S1.id, 'a')));
    // S1's base is not the log's version at this head, so the head is not recorded.
    expect(await a.disk.meta()).toEqual(recorded);

    // The full sync that follows finds what the pull left alone.
    const full = await a.sync();
    expect(full.conflicts.map((conflict) => conflict.path)).toEqual([sessionPath(S1.id)]);
    expect(full.pushed).toEqual([
      conflictPath(full.conflicts[0].id),
      BODYWEIGHT,
      sessionPath(S2.id),
    ]);
    await b.sync();
    await expectConverged(remote, a, b);
  });

  it('records the head when every change it skipped is against an unchanged remote', async () => {
    const { remote, a, b } = await synced();
    const S3 = session('2026-09-20-cccc', 'b');
    await b.put(sessionFile(S3));
    await b.sync();
    await a.put(sessionFile(session(S2.id, 'a')));

    const result = await a.sync('pull');
    expect(result).toMatchObject({ committed: null, taken: [sessionPath(S3.id)] });
    // Every base agrees with the log at this head, so the full sync that follows
    // pushes without reading the tree.
    expect((await a.disk.meta()).last_synced_head).toBe(await remote.head());
    expect(await callsDuring(remote, () => a.sync())).toEqual(['head', 'commit', 'moveBranch']);
    await b.sync();
    await expectConverged(remote, a, b);
  });
});

describe('an unreadable remote file', () => {
  it('is left alone and reported, while every other path syncs', async () => {
    const { remote, a, b } = await synced();
    const S3 = session('2026-09-20-cccc', 'b');
    const S4 = session('2026-09-21-dddd', 'a');
    const broken = new Map([
      [BODYWEIGHT, 'date,kg\n2026-09-01,80\n'],
      [sessionPath(S1.id), '{"id": "2026-09-14-aaaa",\n'],
    ]);
    remote.externalCommit([...broken, sessionFile(S3)].map(change));
    // A has its own change to one of the broken files, and a new session.
    const mine = session(S1.id, 'a');
    await a.put(sessionFile(mine));
    await a.put(sessionFile(S4));
    const entries = new Map((await a.disk.entries()).map((entry) => [entry.path, entry]));

    const result = await a.sync();
    expect(result).toMatchObject({
      unreadable: [BODYWEIGHT, sessionPath(S1.id)],
      taken: [sessionPath(S3.id)],
      pushed: [sessionPath(S4.id)],
      conflicts: [],
    });
    // Not taken, not pushed, not overwritten.
    for (const [path, content] of broken) {
      expect(remote.files().get(path)).toBe(content);
      expect(await a.disk.entry(path)).toEqual(entries.get(path));
    }
    expect((await a.files()).get(sessionPath(S1.id))).toBe(serializeSession(mine));
    expect((await a.files()).get(BODYWEIGHT)).toBe(bodyweight(ROWS));
    // The head is not recorded, so the next sync reads the tree and reports them again.
    expect((await a.disk.meta()).last_synced_head).not.toBe(await remote.head());
    let again: SyncResult | undefined;
    const calls = await callsDuring(remote, async () => {
      again = await a.sync();
    });
    expect(calls).toContain('tree');
    expect(again!.unreadable).toEqual([BODYWEIGHT, sessionPath(S1.id)]);

    // Once repaired, everything syncs.
    remote.externalCommit(
      [
        sessionFile(S1),
        [BODYWEIGHT, bodyweight({ ...ROWS, '2026-09-05': 84 })!] as [string, string],
      ].map(change),
    );
    expect(await a.sync()).toMatchObject({
      unreadable: [],
      taken: [BODYWEIGHT],
      pushed: [sessionPath(S1.id)],
      conflicts: [],
    });
    await b.sync();
    await expectConverged(remote, a, b);
  });

  it('treats a file that is not UTF-8 text as unreadable, not as a broken repo', async () => {
    const { remote, a } = await synced();
    const S3 = session('2026-09-20-cccc', 'b');
    // Stands in for bytes the GitHub adapter could not decode as UTF-8 (a table
    // saved from a spreadsheet in another encoding): the in-memory remote holds
    // strings, so the adapter's FormatError is injected for this one blob.
    const garbled = bodyweight({ ...ROWS, '2026-09-06': 85 })!;
    remote.externalCommit([[BODYWEIGHT, garbled] as [string, string], sessionFile(S3)].map(change));
    const read = remote.blob.bind(remote);
    remote.blob = async (sha) => {
      if (sha === blobSha(garbled)) throw new FormatError(`blob ${sha} is not UTF-8 text`);
      return read(sha);
    };
    const before = await a.disk.entry(BODYWEIGHT);

    expect(await a.sync()).toMatchObject({
      unreadable: [BODYWEIGHT],
      taken: [sessionPath(S3.id)],
      conflicts: [],
    });
    expect(await a.disk.entry(BODYWEIGHT)).toEqual(before);
    expect((await a.disk.meta()).last_synced_head).not.toBe(await remote.head());
  });
});

describe('the format marker', () => {
  /** The sync's error kind, having checked that nothing changed on either side. */
  async function refused(remote: MemoryRemote, device: Device): Promise<string> {
    const files = await device.files();
    const entries = await device.disk.entries();
    const meta = await device.disk.meta();
    const head = await remote.head();
    const kind = await failure(device.sync());
    expect(await device.files()).toEqual(files);
    expect(await device.disk.entries()).toEqual(entries);
    expect(await device.disk.meta()).toEqual(meta);
    expect(await remote.head()).toBe(head);
    return kind;
  }

  it('missing from a repo never set up: a repo error', async () => {
    const remote = new MemoryRemote();
    const a = new Device(remote, 'dev-a');
    await a.put(sessionFile(S1));
    expect(await refused(remote, a)).toBe('repo');
  });

  it('deleted from a log this device synced with: a repo error', async () => {
    const { remote, a } = await synced();
    remote.externalCommit([{ path: FORMAT_PATH, content: null }]);
    await a.put(sessionFile(session(S1.id, 'a')));
    expect(await refused(remote, a)).toBe('repo');
  });

  it.each([
    ['newer than this build: an update error', '{\n  "format": 2\n}\n', 'update'],
    ['not JSON: a repo error', 'format: 1\n', 'repo'],
    ['without a format number: a repo error', '{\n  "format": "one"\n}\n', 'repo'],
  ])('%s', async (_, marker, kind) => {
    const { remote, a } = await synced();
    remote.externalCommit([
      { path: FORMAT_PATH, content: marker },
      change(sessionFile(session(S2.id, 'b'))),
    ]);
    await a.put(sessionFile(session(S1.id, 'a')));
    expect(await refused(remote, a)).toBe(kind);
  });

  it('newer, on a device that never synced: an update error', async () => {
    const remote = new MemoryRemote();
    remote.externalCommit([{ path: FORMAT_PATH, content: '{\n  "format": 2\n}\n' }]);
    const a = new Device(remote, 'dev-a');
    expect(await refused(remote, a)).toBe('update');
  });

  it('is the log’s to say: a different local copy is replaced, never pushed', async () => {
    const { remote, a } = await synced();
    await a.write(FORMAT_PATH, '{\n  "format": 1, "mine": true\n}\n');
    const result = await a.sync();
    expect(result).toMatchObject({ committed: null, taken: [FORMAT_PATH], conflicts: [] });
    expect(remote.files().get(FORMAT_PATH)).toBe(MARKER);
    await expectConverged(remote, a);
  });
});

describe('a hand-formatted remote file', () => {
  const handFormatted = new Map([
    [sessionPath(S1.id), `${JSON.stringify(S1)}\n`],
    [templatePath(T1.id), `${JSON.stringify(T1, null, 4)}\n`],
    // ROWS, unsorted, with CRLF, a trailing zero and padding the reader trims.
    [
      BODYWEIGHT,
      'date,weight_kg,source\r\n2026-09-03,82.0,manual\r\n2026-09-02,81,manual\r\n2026-09-01, 80 ,manual\r\n',
    ],
  ]);

  it('is taken, rewritten in the app’s form once, and then left alone', async () => {
    const remote = newLog();
    remote.externalCommit([...handFormatted].map(change));
    const a = new Device(remote, 'dev-a');
    const commits = remote.commitCount();

    const result = await a.sync();
    expect(result.taken).toEqual([FORMAT_PATH, ...handFormatted.keys()].sort());
    expect(result.pushed).toEqual([...handFormatted.keys()].sort());
    expect(result.conflicts).toEqual([]);
    expect(remote.commitCount()).toBe(commits + 1);
    expect(remote.files().get(sessionPath(S1.id))).toBe(serializeSession(S1));
    expect(remote.files().get(templatePath(T1.id))).toBe(serializeTemplate(T1));
    expect(remote.files().get(BODYWEIGHT)).toBe(bodyweight(ROWS));
    await expectConverged(remote, a);
    await expectQuiet(a);

    // Another device finds nothing to argue about.
    const b = new Device(remote, 'dev-b');
    expect(await b.sync()).toMatchObject({ committed: null, conflicts: [] });
    await expectConverged(remote, a, b);
  });

  it('holding what the device already has is no change, and never a conflict', async () => {
    const { remote, a, b } = await synced();
    remote.externalCommit([...handFormatted].map(change));
    const mine = session(S1.id, 'a');
    await a.put(sessionFile(mine));
    await a.write(BODYWEIGHT, bodyweight({ ...ROWS, '2026-09-04': 83 }));

    // A pull takes nothing from it; the log still needs rewriting, so the head is not recorded.
    const pulled = await a.sync('pull');
    expect(pulled).toMatchObject({ taken: [], conflicts: [] });
    expect((await a.disk.meta()).last_synced_head).not.toBe(await remote.head());

    const result = await a.sync();
    expect(result).toMatchObject({ taken: [], conflicts: [] });
    expect(result.pushed).toEqual([...handFormatted.keys()].sort());
    expect(remote.files().get(sessionPath(S1.id))).toBe(serializeSession(mine));
    expect(remote.files().get(templatePath(T1.id))).toBe(serializeTemplate(T1));
    await b.sync();
    await expectConverged(remote, a, b);
  });
});

describe('fetching', () => {
  it.each([6, 2, 1])('keeps at most %i requests in flight', async (limit) => {
    const remote = newLog();
    const sessions = Array.from({ length: 20 }, (_, i) =>
      session(`2026-09-${String(i + 1).padStart(2, '0')}-aaaa`, `n${i}`),
    );
    remote.externalCommit(sessions.map(sessionFile).map(change));
    const blob = remote.blob.bind(remote);
    let inFlight = 0;
    let most = 0;
    remote.blob = async (sha) => {
      most = Math.max(most, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      try {
        return await blob(sha);
      } finally {
        inFlight--;
      }
    };
    const a = new Device(remote, 'dev-a');
    // Six is the default.
    await a.sync('full', limit === 6 ? {} : { concurrency: limit });
    expect(most).toBe(limit);
    await expectConverged(remote, a);
  });

  it('decides a write made on the device while it was fetching, instead of overwriting it', async () => {
    const { remote, a, b } = await synced();
    await b.write(BODYWEIGHT, bodyweight({ ...ROWS, '2026-09-01': 79 }));
    await b.sync();
    const blob = remote.blob.bind(remote);
    remote.blob = async (sha) => {
      remote.blob = blob;
      // The lifter logs a weigh-in while the sync waits on the network.
      await a.weigh('2026-09-04', 83);
      return blob(sha);
    };

    const result = await a.sync();
    expect(result).toMatchObject({ pushed: [BODYWEIGHT], taken: [BODYWEIGHT], conflicts: [] });
    expect(remote.files().get(BODYWEIGHT)).toBe(
      bodyweight({ ...ROWS, '2026-09-01': 79, '2026-09-04': 83 }),
    );
    await b.sync();
    await expectConverged(remote, a, b);
  });

  it('leaves for the next sync a path written while fetching, whose remote version it had no reason to fetch', async () => {
    const { remote, a, b } = await synced();
    // Both devices log the same weigh-in; B's reaches the log first, with a new session.
    const both = bodyweight({ ...ROWS, '2026-09-04': 83 });
    await a.write(BODYWEIGHT, both);
    await b.write(BODYWEIGHT, both);
    const S3 = session('2026-09-20-cccc', 'b');
    await b.put(sessionFile(S3));
    await b.sync();
    // A holds the log's table exactly, so it fetches only the session; meanwhile it logs again.
    const blob = remote.blob.bind(remote);
    remote.blob = async (sha) => {
      remote.blob = blob;
      await a.weigh('2026-09-05', 84);
      return blob(sha);
    };

    const result = await a.sync();
    expect(result).toMatchObject({ committed: null, taken: [sessionPath(S3.id)], conflicts: [] });
    expect(remote.files().get(BODYWEIGHT)).toBe(both);
    expect((await a.disk.meta()).last_synced_head).not.toBe(await remote.head());

    expect(await a.sync()).toMatchObject({ pushed: [BODYWEIGHT], conflicts: [] });
    expect(remote.files().get(BODYWEIGHT)).toBe(
      bodyweight({ ...ROWS, '2026-09-04': 83, '2026-09-05': 84 }),
    );
    await b.sync();
    await expectConverged(remote, a, b);
  });
});

describe('errors', () => {
  it('an empty repository is a repo error that sends the lifter to setup', async () => {
    const a = new Device(new MemoryRemote({ empty: true }), 'dev-a');
    expect(await rejection(a.sync())).toMatchObject({
      kind: 'repo',
      message: expect.stringMatching(/setting it up/),
    });
  });

  it('passes the remote’s own errors through unchanged', async () => {
    const { remote, a } = await synced();
    await a.put(sessionFile(session(S1.id, 'a')));
    const limited = new SyncError('rate_limit', 'Slow down', { retryAt: new Date(T0) });
    remote.failNext('commit', limited);
    expect(await rejection(a.sync())).toBe(limited);
  });

  it('turns anything else the remote throws into a bug', async () => {
    const { remote, a, b } = await synced();
    await b.put(sessionFile(session(S1.id, 'b')));
    await b.sync();
    remote.failNext('tree', new TypeError('Cannot read properties of undefined'));
    expect(await failure(a.sync())).toBe('bug');
  });

  it('turns a failing store into a retryable error, with the device as it was', async () => {
    const { remote, a, b } = await synced();
    await b.put(sessionFile(session(S1.id, 'b')));
    await b.sync();
    const files = await a.files();
    vi.spyOn(a.disk, 'exclusive').mockRejectedValueOnce(new Error('QuotaExceededError'));
    expect(await failure(a.sync())).toBe('retryable');
    expect(await a.files()).toEqual(files);

    await a.sync();
    await expectConverged(remote, a, b);
  });

  it('stops with a bug when a table’s recorded base does not match its hash', async () => {
    const { a } = await synced();
    await a.disk.exclusive((s) =>
      s.apply([{ op: 'base', path: BODYWEIGHT, sha: blobSha('x'), body: 'y' }]),
    );
    await a.weigh('2026-09-04', 83);
    const files = await a.files();
    expect(await failure(a.sync())).toBe('bug');
    expect(await a.files()).toEqual(files);
  });

  it('stops with a bug when the device’s own version of a conflict does not parse', async () => {
    const { remote, a, b } = await synced();
    await b.put(sessionFile(session(S1.id, 'b')));
    await b.sync();
    await a.write(sessionPath(S1.id), '{ "not": "a session" }\n');
    const head = await remote.head();
    expect(await failure(a.sync())).toBe('bug');
    expect(await remote.head()).toBe(head);
  });
});
