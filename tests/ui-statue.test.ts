import { describe, expect, it } from 'vitest';
import musclesCsv from '../src/library/muscles.csv?raw';
import { parseMuscles } from '../src/library/parse';
import {
  regionFills,
  regionsOf,
  STATUE_REGIONS,
  volumeToken,
  VOLUME_TOKENS,
  type StatueView,
} from '../src/ui/statue';
import { STATUE_ART } from '../src/ui/progress/statue-art';

const muscles = parseMuscles(musclesCsv).map((m) => m.id);
const views: StatueView[] = ['front', 'back'];

describe('the statue', () => {
  it('paints every muscle group somewhere', () => {
    expect(muscles.filter((id) => regionsOf(id).length === 0)).toEqual([]);
  });

  it('paints only muscle groups that exist', () => {
    const known = new Set(muscles);
    const painted = views.flatMap((v) => Object.values(STATUE_REGIONS[v]) as string[]);
    expect(painted.filter((id) => !known.has(id))).toEqual([]);
  });

  it('has a drawing for every region, and only one', () => {
    for (const view of views) {
      const drawn = STATUE_ART[view].flatMap((part) =>
        part.muscles.flatMap((m) => m.regions.map((r) => r.region)),
      );
      expect(drawn.sort()).toEqual(Object.keys(STATUE_REGIONS[view]).sort());
    }
  });

  it('draws each muscle group as one shape per view, so it is one button', () => {
    for (const view of views) {
      const groups = STATUE_ART[view].flatMap((part) => part.muscles.map((m) => m.muscle));
      expect(new Set(groups).size).toBe(groups.length);
    }
  });

  it('paints nothing for an id it does not know, and does not throw', () => {
    expect(regionsOf('not_a_muscle')).toEqual([]);
    const fills = regionFills(new Map([['not_a_muscle', 4]]));
    for (const view of views) {
      expect(new Set(Object.values(fills[view]))).toEqual(new Set(['--vol-0']));
    }
  });

  it('shades each region from its group’s level, and leaves the rest bare', () => {
    const fills = regionFills(new Map([['quads', 4]]));
    expect(fills.front.vastusLateralis).toBe('--vol-4');
    expect(fills.front.vastusMedialis).toBe('--vol-4');
    expect(fills.front.rectusFemoris).toBe('--vol-0');
    expect(fills.back.hamstring).toBe('--vol-0');
  });

  it('shades a group the same wherever it is painted', () => {
    const fills = regionFills(new Map([['calves', 2]]));
    expect([fills.front.calfInner, fills.front.calfOuter, fills.back.calf]).toEqual([
      '--vol-2',
      '--vol-2',
      '--vol-2',
    ]);
  });

  it('maps the five levels to the five tokens', () => {
    expect([0, 1, 2, 3, 4].map(volumeToken)).toEqual([...VOLUME_TOKENS]);
    expect(VOLUME_TOKENS).toEqual(['--vol-0', '--vol-1', '--vol-2', '--vol-3', '--vol-4']);
  });

  it('reads a level out of range, or none, as the nearest shade', () => {
    expect(volumeToken(undefined)).toBe('--vol-0');
    expect(volumeToken(Number.NaN)).toBe('--vol-0');
    expect(volumeToken(-1)).toBe('--vol-0');
    expect(volumeToken(9)).toBe('--vol-4');
    expect(volumeToken(2.4)).toBe('--vol-2');
  });
});
