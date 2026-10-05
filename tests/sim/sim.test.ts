import { describe, expect, it } from 'vitest';
import { describeSchedule, generate } from './schedule';
import { breaks, shrink } from './shrink';
import { failureOf, play, type Sabotage } from './world';

/**
 * The sync, simulated. Each seed generates a
 * schedule of writes, conflicting edits, resolutions, syncs and pulls on two or
 * three devices, with the network dropping and devices killed at every await of
 * a sync; then the network heals, every device syncs until nothing changes, and
 * every invariant is checked:
 *
 *   1. Convergence. Every device and the remote hold identical content.
 *   2. Nothing lost. Every version a device wrote survives, in the data or in a
 *      conflict record, unless a write made by a device that had seen it
 *      replaced or deleted it. A deletion is a version too, with one exception:
 *      a deletion may be undone by a write made without seeing it, when the
 *      deleting side's content returned to its base in between (docs/DECISIONS.md,
 *      Storage). Those cases are counted, and any other fails.
 *   3. Nothing comes back. A record deleted on a device that had seen all its
 *      versions stays deleted.
 *   4. Conflicts only when concurrent. A conflict record appears only where two
 *      devices changed the same unit without either having seen the other's.
 *   5. Quiet when idle. A sync with nothing to do makes no commit.
 *   6. Crash-safe. None of the above depends on where a device was killed; a
 *      device killed between moving the branch and recording it never sees its
 *      own commit as a conflict.
 *
 * `oracle.ts` keeps its own record of which device had seen which version, which
 * is what 2 to 4 are checked against.
 *
 * `npm test` runs a few thousand seeds. For a soak run:
 *
 *   SIM_SEEDS=20000 npx vitest run tests/sim --reporter=verbose
 *
 * with `SIM_FIRST_SEED` to start elsewhere. A soak run prints what the schedules
 * exercised, including how often a deletion was undone by a concurrent write,
 * the one limit invariant 2 allows. A failing seed is
 * shrunk to the shortest schedule that still breaks the same invariant, and
 * reported with it, ready to keep in regressions.test.ts.
 */

const SOAK = import.meta.env.SIM_SEEDS !== undefined;
const SEEDS = Number(import.meta.env.SIM_SEEDS ?? 5000);
const FIRST = Number(import.meta.env.SIM_FIRST_SEED ?? 1);

describe('the sync, simulated', () => {
  it(
    `keeps every invariant over ${SEEDS} seeded schedules`,
    async () => {
      const started = Date.now();
      const reports: string[] = [];
      const shrunk = new Set<string>();
      const exercised = new Map<string, number>();
      for (let seed = FIRST; seed < FIRST + SEEDS; seed++) {
        const schedule = generate(seed);
        const { world, failure } = await play(schedule);
        for (const [what, n] of world.stats) exercised.set(what, (exercised.get(what) ?? 0) + n);
        if (failure === null) continue;
        // Each broken invariant is shrunk once; later seeds breaking it are listed.
        if (shrunk.has(failure.invariant)) {
          reports.push(`seed ${seed}: ${failure.message}`);
          continue;
        }
        shrunk.add(failure.invariant);
        const small = await shrink(schedule, breaks(failure.invariant));
        reports.push(
          [
            `seed ${seed}: ${(await failureOf(small))?.message}`,
            describeSchedule(small),
            JSON.stringify(small),
          ].join('\n'),
        );
      }
      if (SOAK) {
        const seconds = ((Date.now() - started) / 1000).toFixed(1);
        console.log(
          `${SEEDS} seeds from ${FIRST} in ${seconds}s:`,
          Object.fromEntries([...exercised].sort()),
        );
      }
      expect(reports.join('\n\n')).toBe('');

      // The schedules do what they claim: every kind of trouble happens, often.
      for (const what of [
        'full completed',
        'pull completed',
        'offline',
        'killed',
        'killed after the branch moved',
        'lost a race',
        'conflicts found',
        'clashed',
        'resolved',
        'resolved on two devices',
        'edited on github.com',
      ]) {
        expect(exercised.get(what) ?? 0, what).toBeGreaterThan(SEEDS / 50);
      }
    },
    Math.max(60_000, SEEDS * 200),
  );
});

describe('the simulation catches a sync that', () => {
  // Bugs planted in the store or the remote the sync sees, each of which a
  // correct sync would never show: the oracle must find every one.
  const PLANTED: Array<[string, Sabotage, string]> = [
    [
      'never records the commit it is landing',
      { forgetInflight: true },
      'conflicts only when concurrent',
    ],
    [
      'never finds a recorded commit landed',
      { denyLanding: true },
      'conflicts only when concurrent',
    ],
    [
      'loses the conflict records it saves',
      { dropConflicts: true },
      'sync takes only the log’s versions',
    ],
    ['never deletes what the log deleted', { dropDeletions: true }, 'nothing comes back'],
    ['commits less than it settles', { dropPushes: true }, 'nothing lost'],
    ['never records the head it agrees with', { forgetHead: true }, 'convergence'],
  ];

  it.each(PLANTED)('%s', async (_, sabotage, invariant) => {
    const broken: string[] = [];
    for (let seed = 1; seed <= 400; seed++) {
      const failure = await failureOf(generate(seed), sabotage);
      if (failure?.invariant === invariant) return;
      if (failure) broken.push(failure.invariant);
    }
    expect.fail(`no seed broke "${invariant}" (broke: ${[...new Set(broken)].join(', ')})`);
  });
});
