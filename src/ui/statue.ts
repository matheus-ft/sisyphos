/**
 * The statue on the Progress tab's Body view: which painted regions of the
 * figure show each muscle group in `src/library/muscles.csv`, and the shade
 * each region takes from its group's volume. The drawing is
 * `src/ui/progress/statue-art.ts`; this is the map between it and the groups.
 */

export type StatueView = 'front' | 'back';

/**
 * Every region is painted on both sides of the body. A group shows wherever a
 * viewer would see its muscles, so some appear in both views and some twice
 * in one (the quads are vastus lateralis and the vastus medialis teardrop).
 * What each group covers is docs/MUSCLES.md.
 */
export const STATUE_REGIONS = {
  front: {
    abdomen: 'abs',
    flank: 'lats', // the lat's edge seen past the chest
    pectoral: 'pecs',
    rectusFemoris: 'hip_flexors',
    vastusLateralis: 'quads',
    vastusMedialis: 'quads',
    adductor: 'adductors',
    tibialis: 'tibialis',
    calfOuter: 'calves',
    calfInner: 'calves',
    deltoid: 'front_delts',
    biceps: 'biceps',
    forearm: 'forearms',
  },
  back: {
    erector: 'lower_back',
    lat: 'lats',
    glute: 'glutes',
    trapezius: 'upper_back',
    hamstring: 'hamstrings',
    adductor: 'adductors', // magnus and gracilis, inside the hamstrings
    calf: 'calves',
    // The posterior delt and, on the shoulder blade below its spine,
    // infraspinatus and teres minor: the whole rear_delts group in one shape.
    rearDeltoid: 'rear_delts',
    triceps: 'triceps',
    forearm: 'forearms',
  },
} as const satisfies Record<StatueView, Record<string, string>>;

export type RegionOf<V extends StatueView> = keyof (typeof STATUE_REGIONS)[V] & string;

export interface RegionRef {
  view: StatueView;
  region: string;
}

/** The five shades of the volume ramp, untrained to most trained. */
export const VOLUME_TOKENS = ['--vol-0', '--vol-1', '--vol-2', '--vol-3', '--vol-4'] as const;
export type VolumeToken = (typeof VOLUME_TOKENS)[number];

/** A level outside 0..4, or none at all, reads as the nearest shade, never as an error. */
export function volumeToken(level: number | undefined): VolumeToken {
  if (level === undefined || !Number.isFinite(level)) return VOLUME_TOKENS[0];
  return VOLUME_TOKENS[Math.min(4, Math.max(0, Math.round(level)))];
}

const VIEWS: readonly StatueView[] = ['front', 'back'];

function entries(view: StatueView): [string, string][] {
  return Object.entries(STATUE_REGIONS[view]);
}

/** Where a muscle group is painted; an id the statue does not know is painted nowhere. */
export function regionsOf(muscleId: string): RegionRef[] {
  return VIEWS.flatMap((view) =>
    entries(view)
      .filter(([, muscle]) => muscle === muscleId)
      .map(([region]) => ({ view, region })),
  );
}

export type RegionFills = { [V in StatueView]: Record<RegionOf<V>, VolumeToken> };

/**
 * The shade of every region, from a level (0..4) per muscle id. Ids the statue
 * does not draw are ignored, and a drawn group missing from `levels` is bare.
 */
export function regionFills(levels: ReadonlyMap<string, number>): RegionFills {
  const shade = (view: StatueView) =>
    Object.fromEntries(
      entries(view).map(([region, muscle]) => [region, volumeToken(levels.get(muscle))]),
    );
  return { front: shade('front'), back: shade('back') } as RegionFills;
}
