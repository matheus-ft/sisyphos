import { describe, expect, it } from 'vitest';
import {
  AGORA_PAGES,
  PROGRESS_VIEWS,
  parseRoute,
  routeHash,
  sameRoute,
  tabOf,
  type Route,
} from '../src/ui/route';

const every: Route[] = [
  { name: 'train' },
  { name: 'history' },
  ...PROGRESS_VIEWS.map((view) => ({ name: 'progress' as const, view })),
  { name: 'progress', view: 'labours', exercise: 'bench' },
  { name: 'progress', view: 'strength', exercise: 'low_bar_squat' },
  { name: 'more', page: null },
  ...AGORA_PAGES.map((page) => ({ name: 'more' as const, page })),
  { name: 'session', id: '2026-10-04-k3f9' },
  { name: 'finish', id: '2026-10-04-k3f9' },
  { name: 'template', id: 'squat-day-k3f9' },
  { name: 'exercise', id: 'low_bar_squat' },
];

describe('a route and its hash', () => {
  it.each(every.map((r) => [routeHash(r), r]))(
    '%s reads back as the route it came from',
    (hash, route) => {
      expect(parseRoute(hash as string)).toEqual(route);
    },
  );

  it('writes the tabs as their English names', () => {
    expect(routeHash({ name: 'train' })).toBe('#/train');
    expect(routeHash({ name: 'history' })).toBe('#/history');
    expect(routeHash({ name: 'progress', view: 'body' })).toBe('#/progress');
    expect(routeHash({ name: 'progress', view: 'labours' })).toBe('#/progress/labours');
    expect(routeHash({ name: 'more', page: null })).toBe('#/more');
    expect(routeHash({ name: 'more', page: 'sync' })).toBe('#/more/sync');
  });

  it('gives each of the lifter’s data its own page under More', () => {
    for (const page of ['bodyweight', 'maxes', 'meets', 'records'] as const) {
      expect(AGORA_PAGES).toContain(page);
      expect(routeHash({ name: 'more', page })).toBe(`#/more/${page}`);
      expect(parseRoute(`#/more/${page}`)).toEqual({ name: 'more', page });
      expect(tabOf({ name: 'more', page })).toBe('more');
    }
  });

  it('no longer has the one Lifter page, whose old address lands on the index', () => {
    expect(AGORA_PAGES).not.toContain('lifter');
    expect(parseRoute('#/more/lifter')).toEqual({ name: 'more', page: null });
  });

  it('nests the finish screen under its session', () => {
    expect(routeHash({ name: 'finish', id: 'a' })).toBe('#/session/a/finish');
    expect(parseRoute('#/session/a/finish')).toEqual({ name: 'finish', id: 'a' });
  });

  it('encodes ids, so any id survives the trip', () => {
    const route: Route = { name: 'template', id: 'push/pull day #2' };
    expect(routeHash(route)).toBe('#/template/push%2Fpull%20day%20%232');
    expect(parseRoute(routeHash(route))).toEqual(route);
  });

  it('opens on Train with no hash, or a bare one', () => {
    for (const hash of ['', '#', '#/', '/']) expect(parseRoute(hash)).toEqual({ name: 'train' });
  });

  it('lands on Train for what it does not know', () => {
    for (const hash of [
      '#/nowhere',
      '#/session',
      '#/template/',
      '#/exercise',
      '#/session/%E0%A4%A',
    ]) {
      expect(parseRoute(hash)).toEqual({ name: 'train' });
    }
  });

  it('falls back to the first view or the page list for an unknown sub-page', () => {
    expect(parseRoute('#/progress/arms')).toEqual({ name: 'progress', view: 'body' });
    expect(parseRoute('#/more/secrets')).toEqual({ name: 'more', page: null });
  });

  it('reads a hash without its leading slash, as a hand-typed one may come', () => {
    expect(parseRoute('#history')).toEqual({ name: 'history' });
    expect(parseRoute('#more/sync/')).toEqual({ name: 'more', page: 'sync' });
  });
});

describe('the tab a route belongs to', () => {
  it('marks the tab whose screen it is', () => {
    expect(tabOf({ name: 'train' })).toBe('train');
    expect(tabOf({ name: 'session', id: 'a' })).toBe('train');
    expect(tabOf({ name: 'finish', id: 'a' })).toBe('train');
    expect(tabOf({ name: 'template', id: 'a' })).toBe('train');
    expect(tabOf({ name: 'history' })).toBe('history');
    expect(tabOf({ name: 'exercise', id: 'a' })).toBe('history');
    expect(tabOf({ name: 'progress', view: 'strength' })).toBe('progress');
    expect(tabOf({ name: 'more', page: 'conflicts' })).toBe('more');
  });
});

describe('two routes', () => {
  it('are the same screen when their hashes are', () => {
    expect(sameRoute({ name: 'progress', view: 'body' }, parseRoute('#/progress'))).toBe(true);
    expect(sameRoute({ name: 'session', id: 'a' }, { name: 'finish', id: 'a' })).toBe(false);
  });
});
