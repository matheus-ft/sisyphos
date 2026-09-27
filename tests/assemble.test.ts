import { describe, expect, it } from 'vitest';
import { assembleLibrary, type AdditionFix, type AssembledLibrary } from '../src/library/assemble';
import type { Exercise, ExerciseAddition } from '../src/model';
import { sha1Hex } from '../src/storage/hash';

const encoder = new TextEncoder();

/**
 * Stands in for `exerciseRowHash`: 12 hex characters over the shipped columns.
 * It refuses an addition, because `based_on` is not part of the row: every test
 * below fails if the rule ever hashes one with it.
 */
function rowHash(e: Exercise): string {
  if ('based_on' in e) throw new Error(`${e.id} was hashed with its based_on`);
  const cells = [
    e.id,
    e.name,
    e.base_lift,
    e.tier,
    e.unilateral,
    e.load_type,
    e.default_unit,
    e.muscles.primary,
    e.muscles.aux,
  ];
  return sha1Hex(encoder.encode(JSON.stringify(cells))).slice(0, 12);
}

function exercise(id: string, changes: Partial<Exercise> = {}): Exercise {
  return {
    id,
    name: id,
    base_lift: null,
    tier: 'acc',
    unilateral: false,
    load_type: 'external',
    default_unit: 'kg',
    muscles: { primary: ['lats'], aux: [] },
    ...changes,
  };
}

const addition = (e: Exercise, based_on: string | null): ExerciseAddition => ({ ...e, based_on });

const assemble = (shipped: Exercise[], additions: ExerciseAddition[]) =>
  assembleLibrary(shipped, additions, rowHash);

/** The additions after the caller applies the fixes through the log. */
function applyFixes(additions: ExerciseAddition[], fixes: AdditionFix[]): ExerciseAddition[] {
  return additions.flatMap((a) => {
    const fix = fixes.find((f) => f.id === a.id);
    if (!fix) return [a];
    return fix.op === 'drop' ? [] : [{ ...a, based_on: fix.based_on }];
  });
}

const squat = exercise('low_bar_squat', {
  base_lift: 'squat',
  tier: 'comp',
  muscles: { primary: ['quads', 'glutes'], aux: ['adductors'] },
});
const pulldown = exercise('lat_pulldown', {
  name: 'Lat pulldown',
  default_unit: 'pins',
  muscles: { primary: ['lats'], aux: ['biceps'] },
});
/** The lifter's change to the pulldown: they log it in kilograms. */
const myPulldown: Exercise = { ...pulldown, default_unit: 'kg' };
const sealRow = exercise('seal_row', {
  name: 'Seal row',
  muscles: { primary: ['upper_back'], aux: [] },
});

describe('assembleLibrary', () => {
  it('uses a shipped exercise nobody changed', () => {
    expect(assemble([squat, pulldown], [])).toStrictEqual({
      exercises: [pulldown, squat],
      conflicts: [],
      fixes: [],
    });
  });

  it('uses a brand-new exercise: no shipped row and no base', () => {
    expect(assemble([squat], [addition(sealRow, null)])).toStrictEqual({
      exercises: [squat, sealRow],
      conflicts: [],
      fixes: [],
    });
  });

  it('uses the lifter’s change to a shipped exercise while the shipped row stays as it was', () => {
    const mine = addition(myPulldown, rowHash(pulldown));
    expect(assemble([squat, pulldown], [mine])).toStrictEqual({
      exercises: [myPulldown, squat],
      conflicts: [],
      fixes: [],
    });
  });

  it('uses the shipped row once the submission is merged as sent, and moves based_on to it', () => {
    const merged = { ...myPulldown };
    const library = assemble([merged], [addition(myPulldown, rowHash(pulldown))]);
    expect(library).toStrictEqual({
      exercises: [merged],
      conflicts: [],
      fixes: [{ op: 'rebase', id: 'lat_pulldown', based_on: rowHash(merged) }],
    });
    expect(library.exercises[0]).toBe(merged);
  });

  it('rebases a brand-new exercise once its submission is merged as sent', () => {
    const merged = { ...sealRow };
    expect(assemble([merged], [addition(sealRow, null)])).toStrictEqual({
      exercises: [merged],
      conflicts: [],
      fixes: [{ op: 'rebase', id: 'seal_row', based_on: rowHash(merged) }],
    });
  });

  it('flags a conflict when the submission was merged with corrections, and uses the shipped row', () => {
    const corrected: Exercise = {
      ...myPulldown,
      muscles: { primary: ['lats'], aux: ['rear_delts'] },
    };
    const mine = addition(myPulldown, rowHash(pulldown));
    expect(assemble([corrected], [mine])).toStrictEqual({
      exercises: [corrected],
      conflicts: [{ id: 'lat_pulldown', addition: mine, shipped: corrected }],
      fixes: [],
    });
  });

  it('flags a conflict when someone else changed the shipped row after the lifter did', () => {
    const theirs: Exercise = { ...pulldown, name: 'Lat pulldown (wide grip)' };
    const mine = addition(myPulldown, rowHash(pulldown));
    expect(assemble([theirs], [mine])).toStrictEqual({
      exercises: [theirs],
      conflicts: [{ id: 'lat_pulldown', addition: mine, shipped: theirs }],
      fixes: [],
    });
  });

  it('flags a conflict when a brand-new exercise is merged with corrections', () => {
    const corrected: Exercise = {
      ...sealRow,
      muscles: { primary: ['upper_back', 'lats'], aux: [] },
    };
    const mine = addition(sealRow, null);
    expect(assemble([corrected], [mine])).toStrictEqual({
      exercises: [corrected],
      conflicts: [{ id: 'seal_row', addition: mine, shipped: corrected }],
      fixes: [],
    });
  });

  it('drops an addition that carries no change of its own once the shipped row moves', () => {
    const moved: Exercise = { ...pulldown, name: 'Lat pulldown (cable)' };
    expect(assemble([moved], [addition(pulldown, rowHash(pulldown))])).toStrictEqual({
      exercises: [moved],
      conflicts: [],
      fixes: [{ op: 'drop', id: 'lat_pulldown' }],
    });
  });

  it('asks for nothing when based_on already names the shipped row the addition equals', () => {
    // What a rebase leaves behind, or saving an exercise unchanged.
    expect(assemble([pulldown], [addition(pulldown, rowHash(pulldown))])).toStrictEqual({
      exercises: [pulldown],
      conflicts: [],
      fixes: [],
    });
  });

  it('uses an addition based on a shipped row this app does not have yet, and writes nothing', () => {
    // Made by a newer app, whose shipped library has the exercise.
    const shippedElsewhere = exercise('pendlay_row');
    const mine = addition({ ...shippedElsewhere, name: 'Pendlay row' }, rowHash(shippedElsewhere));
    expect(assemble([squat], [mine])).toStrictEqual({
      exercises: [squat, { ...shippedElsewhere, name: 'Pendlay row' }],
      conflicts: [],
      fixes: [],
    });
  });

  it('settles a conflict either way it is resolved', () => {
    const theirs: Exercise = { ...pulldown, name: 'Lat pulldown (wide grip)' };
    const mine = addition(myPulldown, rowHash(pulldown));

    // Use the official one: the addition is deleted.
    expect(assemble([theirs], [])).toStrictEqual({ exercises: [theirs], conflicts: [], fixes: [] });

    // Keep mine: based_on moves to the current shipped row, and the addition wins from now on.
    expect(assemble([theirs], [{ ...mine, based_on: rowHash(theirs) }])).toStrictEqual({
      exercises: [myPulldown],
      conflicts: [],
      fixes: [],
    });
  });

  it('sorts by id, gives the same output whatever order its inputs come in, and changes neither', () => {
    const shipped = [squat, pulldown, exercise('plank', { load_type: 'none' }), exercise('dips')];
    const additions = [
      addition(sealRow, null), // used
      addition(exercise('dips', { name: 'Ring dips' }), rowHash(exercise('dips'))), // used
      addition(myPulldown, rowHash({ ...pulldown, name: 'Old name' })), // conflict
      addition({ ...squat, name: 'Squat' }, rowHash(squat)), // used
      addition(exercise('plank', { name: 'Old plank' }), null), // conflict
      addition(exercise('ab_wheel'), null), // used
    ];
    const before = structuredClone({ shipped, additions });
    const forward = assemble(shipped, additions);
    const backward = assemble([...shipped].reverse(), [...additions].reverse());

    expect({ shipped, additions }).toStrictEqual(before);
    expect(backward).toStrictEqual(forward);
    expect(forward.exercises.map((e) => e.id)).toEqual([
      'ab_wheel',
      'dips',
      'lat_pulldown',
      'low_bar_squat',
      'plank',
      'seal_row',
    ]);
    expect(forward.conflicts.map((c) => c.id)).toEqual(['lat_pulldown', 'plank']);
  });

  it('lists fixes in id order', () => {
    const b = exercise('b');
    const a = exercise('a');
    const c = exercise('c');
    const library = assemble(
      [c, { ...b, name: 'B moved' }, a],
      [addition(c, null), addition(b, rowHash(b)), addition(a, null)],
    );
    expect(library.fixes).toStrictEqual([
      { op: 'rebase', id: 'a', based_on: rowHash(a) },
      { op: 'drop', id: 'b' },
      { op: 'rebase', id: 'c', based_on: rowHash(c) },
    ]);
  });
});

describe('assembleLibrary, every combination', () => {
  // Three versions of one exercise. B is absent or the hash of one of them; L is
  // always present (an addition is a row); R is absent or one of them.
  const versions = ['One', 'Two', 'Three'].map((name) => exercise('x', { name }));
  const bases = [null, ...versions.map(rowHash)];
  const combos = bases.flatMap((base) =>
    versions.flatMap((mine) => [null, ...versions].map((shipped) => ({ base, mine, shipped }))),
  );
  type Combo = (typeof combos)[number];

  const label = ({ base, mine, shipped }: Combo) =>
    `B=${base === null ? '-' : versions.find((v) => rowHash(v) === base)!.name} ` +
    `L=${mine.name} R=${shipped?.name ?? '-'}`;

  const run = ({ base, mine, shipped }: Combo) =>
    assemble(shipped ? [shipped] : [], [addition(mine, base)]);

  /** The table of 9.1, row for row. */
  function reference({ base, mine, shipped }: Combo): AssembledLibrary {
    const L = rowHash(mine);
    const R = shipped && rowHash(shipped);
    // No shipped row for a based_on to name: the app is older than the addition.
    if (shipped === null && base !== null) return { exercises: [mine], conflicts: [], fixes: [] };
    if (L === R) {
      const fixes: AdditionFix[] = base === R ? [] : [{ op: 'rebase', id: 'x', based_on: R }];
      return { exercises: [shipped!], conflicts: [], fixes };
    }
    if (L === base) {
      return { exercises: [shipped!], conflicts: [], fixes: [{ op: 'drop', id: 'x' }] };
    }
    if (R === base) return { exercises: [mine], conflicts: [], fixes: [] };
    const conflict = { id: 'x', addition: addition(mine, base), shipped: shipped! };
    return { exercises: [shipped!], conflicts: [conflict], fixes: [] };
  }

  it('follows the table of 9.1', () => {
    expect(combos).toHaveLength(48);
    expect(combos.map((c) => ({ c: label(c), ...run(c) }))).toStrictEqual(
      combos.map((c) => ({ c: label(c), ...reference(c) })),
    );
  });

  it('reaches every outcome', () => {
    const outcome = (library: AssembledLibrary) =>
      library.conflicts.length > 0 ? 'conflict' : (library.fixes[0]?.op ?? 'no write');
    const outcomes = new Set(combos.map((c) => outcome(run(c))));
    expect(outcomes).toEqual(new Set(['conflict', 'rebase', 'drop', 'no write']));
  });

  it('asks for no further fix once its fixes are applied', () => {
    for (const c of combos) {
      const additions = [addition(c.mine, c.base)];
      const shipped = c.shipped ? [c.shipped] : [];
      const first = assemble(shipped, additions);
      const again = assemble(shipped, applyFixes(additions, first.fixes));
      expect(again, label(c)).toStrictEqual({ ...first, fixes: [] });
    }
  });
});
