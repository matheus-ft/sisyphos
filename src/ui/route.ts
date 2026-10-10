/**
 * Where the app is, as a value, and the hash that names it. GitHub Pages
 * serves only the files it has, so a deep path such as /history would be a
 * 404 on reload; a hash never reaches the server, so every screen keeps its
 * own address, reloadable and shareable, from one index.html.
 */

/** The four tabs, by their English names. */
export type Tab = 'train' | 'history' | 'progress' | 'more';

export const PROGRESS_VIEWS = ['body', 'strength', 'labours'] as const;
export type ProgressView = (typeof PROGRESS_VIEWS)[number];

export const AGORA_PAGES = [
  'bodyweight',
  'maxes',
  'meets',
  'records',
  'templates',
  'library',
  'settings',
  'sync',
  'conflicts',
] as const;
export type AgoraPage = (typeof AGORA_PAGES)[number];

export type Route =
  | { name: 'train' }
  | { name: 'history' }
  /** `exercise` opens Strength or Labours on that exercise, as from its history's records. */
  | { name: 'progress'; view: ProgressView; exercise?: string }
  /** Agora: its list of pages when `page` is null. */
  | { name: 'more'; page: AgoraPage | null }
  | { name: 'session'; id: string }
  /** The finish screen of a session just finished. */
  | { name: 'finish'; id: string }
  | { name: 'template'; id: string }
  /** One exercise's history. */
  | { name: 'exercise'; id: string };

export const HOME: Route = { name: 'train' };

/**
 * The route a location hash names. Anything it does not recognise is the
 * Train tab, so a stale or mistyped link still lands somewhere useful.
 */
export function parseRoute(hash: string): Route {
  const parts = hash
    .replace(/^#?\/?/, '')
    .split('/')
    .filter((p) => p !== '')
    .map(decode);
  if (parts.some((p) => p === null)) return HOME;
  const [head, second, third] = parts as string[];
  switch (head) {
    case undefined:
    case 'train':
      return HOME;
    case 'history':
      return { name: 'history' };
    case 'progress': {
      const view = oneOf(PROGRESS_VIEWS, second) ?? 'body';
      // The body view is of every muscle, so it takes no exercise.
      return third && view !== 'body'
        ? { name: 'progress', view, exercise: third }
        : { name: 'progress', view };
    }
    case 'more':
      return { name: 'more', page: oneOf(AGORA_PAGES, second) ?? null };
    case 'session':
      if (!second) return HOME;
      return third === 'finish' ? { name: 'finish', id: second } : { name: 'session', id: second };
    case 'template':
    case 'exercise':
      return second ? { name: head, id: second } : HOME;
    default:
      return HOME;
  }
}

/** The hash for a route, `#/...`, which `parseRoute` reads back as the same route. */
export function routeHash(route: Route): string {
  switch (route.name) {
    case 'train':
    case 'history':
      return `#/${route.name}`;
    case 'progress':
      if (route.view === 'body') return '#/progress';
      return route.exercise
        ? `#/progress/${route.view}/${encodeURIComponent(route.exercise)}`
        : `#/progress/${route.view}`;
    case 'more':
      return route.page === null ? '#/more' : `#/more/${route.page}`;
    case 'session':
      return `#/session/${encodeURIComponent(route.id)}`;
    case 'finish':
      return `#/session/${encodeURIComponent(route.id)}/finish`;
    case 'template':
    case 'exercise':
      return `#/${route.name}/${encodeURIComponent(route.id)}`;
  }
}

/**
 * The tab a route belongs to, which the tab bar marks as current. A session
 * and its finish belong to Train; a template is opened from Train or Agora,
 * and is shown under Train, where it starts sessions.
 */
export function tabOf(route: Route): Tab {
  switch (route.name) {
    case 'history':
    case 'exercise':
      return 'history';
    case 'progress':
      return 'progress';
    case 'more':
      return 'more';
    default:
      return 'train';
  }
}

/** Whether two routes name the same screen. */
export function sameRoute(a: Route, b: Route): boolean {
  return routeHash(a) === routeHash(b);
}

function oneOf<T extends string>(values: readonly T[], value: string | undefined): T | undefined {
  return values.find((v) => v === value);
}

/** A hash part decoded, or null when it is not valid percent-encoding. */
function decode(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}
