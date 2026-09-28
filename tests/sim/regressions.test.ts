import { describe, expect, it } from 'vitest';
import type { Session } from '../../src/model';
import { parseConflict, parseSession } from '../../src/storage/formats';
import { classify } from '../../src/storage/paths';
import type { Schedule } from './schedule';
import { play, type World } from './world';

/**
 * Schedules the simulation found, shrunk, and kept with what they showed. The
 * steps are the simulation's own (schedule.ts): a pick names "the nth record the
 * device holds, wrapping round", resolved when the step runs. Each is played
 * exactly as `npm test` plays a seed, healing and every invariant included.
 */

/** Plays a schedule, failing on any broken invariant: the world as it ended. */
async function played(schedule: Schedule): Promise<World> {
  const { world, failure } = await play(schedule);
  if (failure) throw failure;
  return world;
}

function conflictRecords(world: World) {
  return [...world.remote.files()]
    .filter(([path]) => classify(path).kind === 'conflict')
    .map(([, text]) => parseConflict(text));
}

const WEIGH_INS = 'lifter/bodyweight.csv';
const SESSION = 'sessions/2026/2026-09-27-0001.json';

describe('a deletion undone by a concurrent write (STORAGE.md 4.3, the known limit)', () => {
  it('on the log’s side: a weigh-in synced and deleted, while another device logged the same date unseen (seed 164)', async () => {
    // A logs 2026-09-22 (51) and syncs; while it syncs, B logs the same date (52),
    // never having seen A's. B edits its weigh-in (53) and A deletes its own. A
    // pushes the deletion. B has never agreed with the log on that date, and the
    // log holds no row for it either, so to B the date is new: its 53 goes in.
    const world = await played({
      devices: 2,
      seeds: [1312, 1313],
      steps: [
        // A creates a weigh-in (2)
        { do: 'write', device: 0, write: { op: 'create', kind: 'bodyweight', pick: 2 } },
        // A syncs, before its 2nd request: B creates a weigh-in (8)
        {
          do: 'sync',
          device: 0,
          mode: 'full',
          faults: [
            {
              kind: 'race',
              at: 2,
              steps: [
                { do: 'write', device: 1, write: { op: 'create', kind: 'bodyweight', pick: 8 } },
              ],
            },
          ],
        },
        // B edits and A deletes the same record (4)
        { do: 'clash', devices: [1, 0], pick: 4, deletes: [false, true] },
      ],
    });

    // The deletion is undone: B's weigh-in stands, on every device, and no
    // conflict record says so. Every other version is accounted for (`played`).
    const table = 'date,weight_kg,source\n2026-09-22,53,manual\n';
    expect(world.remote.files().get(WEIGH_INS)).toBe(table);
    for (const device of world.devices) expect(await device.disk.content(WEIGH_INS)).toBe(table);
    expect(conflictRecords(world)).toEqual([]);
    expect(world.oracle.undone).toEqual([
      'dev-a deleted lifter/bodyweight.csv#2026-09-22 (event 3, step 3)',
    ]);
  });

  it('on the deleting device: a saved version used on two devices, then deleted on one (seed 7893)', async () => {
    // A deletes a session B is editing; B and C edit it too. The deletion
    // reaches the log first, so C's version (v5) and B's (v4) are saved as
    // conflict records. B and C both use C's saved v5. Then C deletes the
    // session: C synced when the log had none, so its content is back at its
    // base. When B pushes v5, C has no change to offer, and takes it.
    const world = await played({
      devices: 3,
      seeds: [63144, 63145, 63146],
      steps: [
        // B creates a session (3)
        { do: 'write', device: 1, write: { op: 'create', kind: 'session', pick: 3 } },
        // B syncs
        { do: 'sync', device: 1, mode: 'full', faults: [] },
        // A syncs
        { do: 'sync', device: 0, mode: 'full', faults: [] },
        // A deletes and B edits the same record (7)
        { do: 'clash', devices: [0, 1], pick: 7, deletes: [true, false] },
        // C syncs
        { do: 'sync', device: 2, mode: 'full', faults: [] },
        // B edits and C edits the same record (10)
        { do: 'clash', devices: [1, 2], pick: 10, deletes: [false, false] },
        // A syncs
        { do: 'sync', device: 0, mode: 'full', faults: [] },
        // C syncs
        { do: 'sync', device: 2, mode: 'full', faults: [] },
        // B syncs
        { do: 'sync', device: 1, mode: 'full', faults: [] },
        // B uses the saved one and C uses the saved one for the same conflict (8)
        { do: 'resolve', devices: [1, 2], pick: 8, choices: ['use_saved', 'use_saved'] },
        // C deletes a session (10)
        { do: 'write', device: 2, write: { op: 'delete', kind: 'session', pick: 10 } },
      ],
    });

    // The deletion is undone: the v5 both chose stands, on every device.
    const session = world.remote.files().get(SESSION)!;
    expect(parseSession(session).notes).toBe('v5');
    for (const device of world.devices) expect(await device.disk.content(SESSION)).toBe(session);
    // No conflict record keeps C's deletion: the one left is B's v4, from before.
    expect(
      conflictRecords(world).map((c) => [c.device_id, (c.version as Session | null)?.notes]),
    ).toEqual([['dev-b', 'v4']]);
    expect(world.oracle.undone).toEqual([
      'dev-c deleted sessions/2026/2026-09-27-0001.json (event 11, step 11)',
    ]);
  });

  it('a saved deletion used again, then undone by a device that had only pulled (seed 88190)', async () => {
    // A logs 2026-09-21 (52) and pulls, keeping it local; meanwhile B logs the
    // same date (53) and syncs, and the lifter edits B's weigh-in on github.com
    // (54). B deletes it while A edits its own (56). B's deletion meets the
    // lifter's edit: the edit stands and the deletion is saved, and B uses the
    // saved deletion, deleting the weigh-in again. A never agreed with the log on
    // that date, and the log now holds no row for it either, so A's 56 goes in.
    const world = await played({
      devices: 2,
      seeds: [705520, 705521],
      steps: [
        // B creates a manual record (2)
        { do: 'write', device: 1, write: { op: 'create', kind: 'manualRecords', pick: 2 } },
        // A creates a weigh-in (7)
        { do: 'write', device: 0, write: { op: 'create', kind: 'bodyweight', pick: 7 } },
        // B syncs
        { do: 'sync', device: 1, mode: 'full', faults: [] },
        // B creates a weigh-in (4)
        { do: 'write', device: 1, write: { op: 'create', kind: 'bodyweight', pick: 4 } },
        // A pulls, before its 4th request: B syncs; the lifter edits a record on github.com (1)
        {
          do: 'sync',
          device: 0,
          mode: 'pull',
          faults: [
            {
              kind: 'race',
              at: 4,
              steps: [
                { do: 'sync', device: 1, mode: 'full', faults: [] },
                { do: 'web', op: 'edit', pick: 1, hand: false },
              ],
            },
          ],
        },
        // B deletes and A edits the same record (0)
        { do: 'clash', devices: [1, 0], pick: 0, deletes: [true, false] },
        // B syncs
        { do: 'sync', device: 1, mode: 'full', faults: [] },
        // B uses the saved one for the same conflict (7)
        { do: 'resolve', devices: [1], pick: 7, choices: ['use_saved'] },
        // B syncs
        { do: 'sync', device: 1, mode: 'full', faults: [] },
      ],
    });

    // The deletion, saved and used again, is undone: A's weigh-in stands.
    const table = 'date,weight_kg,source\n2026-09-21,56,manual\n';
    expect(world.remote.files().get(WEIGH_INS)).toBe(table);
    for (const device of world.devices) expect(await device.disk.content(WEIGH_INS)).toBe(table);
    expect(conflictRecords(world)).toEqual([]);
    // Once as B first deleted it, and once as B chose the saved deletion.
    expect(world.oracle.undone).toEqual([
      'dev-b deleted lifter/bodyweight.csv#2026-09-21 (event 4, step 6)',
      'dev-b deleted lifter/bodyweight.csv#2026-09-21 (event 8, step 8)',
    ]);
  });
});

describe('a value is seen as its content, whichever write put it there', () => {
  it('two devices use the same saved weigh-in; one replaces it, having seen its own copy (seed 114887)', async () => {
    // B and A change a weigh-in (B 52, A deletes); A's deletion reaches the log,
    // and B's 52 is saved. B and C both use it. Later A deletes the weigh-in
    // again, and C, whose base is from when the log had none, pushes its 52 over
    // that deletion (the known limit). In healing, B replaces 52 with its 54:
    // B had seen 52, its own copy of the same saved version, so C's is not lost.
    const world = await played({
      devices: 3,
      seeds: [919096, 919097, 919098],
      steps: [
        // B creates a weigh-in (10)
        { do: 'write', device: 1, write: { op: 'create', kind: 'bodyweight', pick: 10 } },
        // B syncs
        { do: 'sync', device: 1, mode: 'full', faults: [] },
        // A syncs
        { do: 'sync', device: 0, mode: 'full', faults: [] },
        // B edits and A deletes the same record (11)
        { do: 'clash', devices: [1, 0], pick: 11, deletes: [false, true] },
        // A syncs
        { do: 'sync', device: 0, mode: 'full', faults: [] },
        // B syncs
        { do: 'sync', device: 1, mode: 'full', faults: [] },
        // C syncs
        { do: 'sync', device: 2, mode: 'full', faults: [] },
        // C uses the saved one and B uses the saved one for the same conflict (7)
        { do: 'resolve', devices: [2, 1], pick: 7, choices: ['use_saved', 'use_saved'] },
        // B syncs
        { do: 'sync', device: 1, mode: 'full', faults: [] },
        // A syncs
        { do: 'sync', device: 0, mode: 'full', faults: [] },
        // B edits and A edits the same record (10)
        { do: 'clash', devices: [1, 0], pick: 10, deletes: [false, false] },
        // A deletes a weigh-in (4)
        { do: 'write', device: 0, write: { op: 'delete', kind: 'bodyweight', pick: 4 } },
        // A syncs
        { do: 'sync', device: 0, mode: 'full', faults: [] },
        // C syncs
        { do: 'sync', device: 2, mode: 'full', faults: [] },
      ],
    });

    expect(world.remote.files().get(WEIGH_INS)).toBe(
      'date,weight_kg,source\n2026-09-21,54,manual\n',
    );
    expect(conflictRecords(world)).toEqual([]);
    expect(world.oracle.undone).toEqual([
      'dev-a deleted lifter/bodyweight.csv#2026-09-21 (event 10, step 12)',
    ]);
  });

  it('a device puts back the version it last synced, while another, having seen it, changes it (seed 21500)', async () => {
    // A and B edit one session over and over, saving and using each other's
    // versions. At the end A's base is v3; A edits it (v11), then uses a saved
    // v3, so its content is back at its base, while B, which had seen v3, writes
    // v12. A has no change to offer, and B's v12 stands: B replaced v3 knowing it.
    const world = await played({
      devices: 2,
      seeds: [172000, 172001],
      steps: [
        // B creates a session (5)
        { do: 'write', device: 1, write: { op: 'create', kind: 'session', pick: 5 } },
        // B creates a session (8)
        { do: 'write', device: 1, write: { op: 'create', kind: 'session', pick: 8 } },
        // B syncs
        { do: 'sync', device: 1, mode: 'full', faults: [] },
        // A syncs
        { do: 'sync', device: 0, mode: 'full', faults: [] },
        // B edits and A edits the same record (0)
        { do: 'clash', devices: [1, 0], pick: 0, deletes: [false, false] },
        // B creates a weigh-in (7)
        { do: 'write', device: 1, write: { op: 'create', kind: 'bodyweight', pick: 7 } },
        // B creates a session (5)
        { do: 'write', device: 1, write: { op: 'create', kind: 'session', pick: 5 } },
        // A syncs
        { do: 'sync', device: 0, mode: 'full', faults: [] },
        // B creates an exercise (6)
        { do: 'write', device: 1, write: { op: 'create', kind: 'additions', pick: 6 } },
        // B syncs
        { do: 'sync', device: 1, mode: 'full', faults: [] },
        // A syncs
        { do: 'sync', device: 0, mode: 'full', faults: [] },
        // A edits and B edits the same record (7)
        { do: 'clash', devices: [0, 1], pick: 7, deletes: [false, false] },
        // A syncs
        { do: 'sync', device: 0, mode: 'full', faults: [] },
        // A creates a 1RM (7)
        { do: 'write', device: 0, write: { op: 'create', kind: 'oneRm', pick: 7 } },
        // B uses the saved one and A uses the saved one for the same conflict (0)
        { do: 'resolve', devices: [1, 0], pick: 0, choices: ['use_saved', 'use_saved'] },
        // B syncs
        { do: 'sync', device: 1, mode: 'full', faults: [] },
        // A syncs
        { do: 'sync', device: 0, mode: 'full', faults: [] },
        // B syncs
        { do: 'sync', device: 1, mode: 'full', faults: [] },
        // A edits and B edits the same record (3)
        { do: 'clash', devices: [0, 1], pick: 3, deletes: [false, false] },
        // A uses the saved one for the same conflict (6)
        { do: 'resolve', devices: [0], pick: 6, choices: ['use_saved'] },
      ],
    });

    expect(parseSession(world.remote.files().get(SESSION)!).notes).toBe('v12');
    expect(conflictRecords(world)).toEqual([]);
    expect(world.oracle.undone).toEqual([]);
  });
});
