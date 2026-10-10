import { describe, expect, it } from 'vitest';
import {
  canCreate,
  filterLibrary,
  fold,
  isFiltered,
  muscleLine,
  NO_FILTER,
  TIER_DETAIL,
  TIER_FILTERS,
  TIER_LABEL,
} from '../src/ui/librarySearch';
import { byId, library, muscles } from './analysis-fixtures';

const names = new Map(muscles.map((m) => [m.id, m.name]));
const found = (filter: Partial<typeof NO_FILTER>) =>
  filterLibrary(library, { ...NO_FILTER, ...filter }).map((e) => e.id);

describe('searching the library', () => {
  it('ignores case and accents', () => {
    expect(fold('Romênian')).toBe('romenian');
    expect(found({ query: 'ROMANIAN' })).toContain('romanian_deadlift');
  });

  it('needs every word, in any order', () => {
    expect(found({ query: 'squat low' })).toContain('low_bar_squat');
    expect(found({ query: 'squat zzz' })).toEqual([]);
  });

  it('lists by name when nothing narrows it', () => {
    const all = filterLibrary(library, NO_FILTER).map((e) => e.name);
    expect(all).toEqual([...all].sort((a, b) => a.localeCompare(b)));
    expect(all).toHaveLength(library.length);
  });
});

describe('filtering the library', () => {
  it('by base lift, including exercises that serve none', () => {
    const squats = filterLibrary(library, { ...NO_FILTER, lift: 'squat' });
    expect(squats.length).toBeGreaterThan(0);
    expect(squats.every((e) => e.base_lift === 'squat')).toBe(true);
    const none = filterLibrary(library, { ...NO_FILTER, lift: 'none' });
    expect(none.every((e) => e.base_lift === null)).toBe(true);
    expect(none.length + squats.length).toBeLessThan(library.length);
  });

  it('by tier', () => {
    const comp = filterLibrary(library, { ...NO_FILTER, tier: 'comp' });
    expect(comp.map((e) => e.id)).toContain('bench');
    expect(comp.every((e) => e.tier === 'comp')).toBe(true);
  });

  it('by variation, which is both close and distant', () => {
    const variations = filterLibrary(library, { ...NO_FILTER, tier: 'variation' });
    expect(variations.length).toBeGreaterThan(0);
    expect(variations.every((e) => e.tier === 'high_spec' || e.tier === 'low_spec')).toBe(true);
    const close = library.filter((e) => e.tier === 'high_spec').length;
    const distant = library.filter((e) => e.tier === 'low_spec').length;
    expect(variations).toHaveLength(close + distant);
  });

  it('by muscle, whether primary or aux', () => {
    const glutes = filterLibrary(library, { ...NO_FILTER, muscle: 'glutes' });
    expect(glutes.some((e) => e.muscles.primary.includes('glutes'))).toBe(true);
    expect(glutes.some((e) => e.muscles.aux.includes('glutes'))).toBe(true);
    expect(glutes.every((e) => [...e.muscles.primary, ...e.muscles.aux].includes('glutes'))).toBe(
      true,
    );
  });

  it('by all of them at once', () => {
    expect(found({ lift: 'squat', tier: 'comp', query: 'low' })).toEqual(['low_bar_squat']);
  });

  it('knows when something narrows it', () => {
    expect(isFiltered(NO_FILTER)).toBe(false);
    expect(isFiltered({ ...NO_FILTER, query: '  ' })).toBe(false);
    expect(isFiltered({ ...NO_FILTER, tier: 'acc' })).toBe(true);
  });
});

describe('what a row says', () => {
  it('names the primary muscles in lower case', () => {
    expect(muscleLine(byId('low_bar_squat'), names)).toBe('quads, adductors');
  });

  it('labels the tiers in the lifter’s words', () => {
    expect(TIER_LABEL).toEqual({
      comp: 'Competition',
      high_spec: 'Variation',
      low_spec: 'Variation',
      acc: 'Accessory',
    });
  });

  it('offers three tier choices, with variation covering both', () => {
    expect(TIER_FILTERS.map((o) => o.label)).toEqual(['Competition', 'Variation', 'Accessory']);
  });

  it('names the precise tier in the detail', () => {
    expect(TIER_DETAIL).toEqual({
      comp: 'Competition',
      high_spec: 'Close variation',
      low_spec: 'Distant variation',
      acc: 'Accessory',
    });
  });
});

describe('creating from the search', () => {
  it('is offered for a name nothing has exactly', () => {
    expect(canCreate(library, 'Zercher Squat Wide')).toBe(true);
  });

  it('is not offered for nothing typed, or for a name already there', () => {
    expect(canCreate(library, '  ')).toBe(false);
    expect(canCreate(library, 'bench press')).toBe(false);
  });
});
