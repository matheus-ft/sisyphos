import { describe, expect, it } from 'vitest';

/**
 * Every file and every name in the code that a doc mentions exists. Docs point
 * at code rather than restate it (CLAUDE.md), so a pointer outliving what it
 * points at is how they go stale. Only `code spans` are checked, outside fenced
 * blocks, and only ones that look like a path or a name from the code.
 */

// Each glob names its exclusions itself: Vite only accepts literal patterns.

/** Every file in the repository, as a path from its root. */
const files = Object.keys(
  import.meta.glob([
    '/**/*',
    '/.github/**/*',
    '/.githooks/*',
    '!/node_modules/**',
    '!/dist/**',
    '!/.claude/**',
  ]),
).map((path) => path.slice(1));

const docTexts = import.meta.glob<string>(
  ['/**/*.md', '/.github/**/*.md', '!/node_modules/**', '!/dist/**', '!/.claude/**'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
);

const code = Object.values(
  import.meta.glob<string>(
    [
      '/**/*.{ts,js,mjs,svelte,json,yml,csv}',
      '/.github/**/*.{yml,json}',
      '!/package-lock.json',
      '!/tests/docs.test.ts',
      '!/node_modules/**',
      '!/dist/**',
      '!/.claude/**',
    ],
    { query: '?raw', import: 'default', eager: true },
  ),
).join('\n');

const fileSet = new Set(files);
const dirSet = new Set(
  files.flatMap((f) =>
    f
      .split('/')
      .slice(0, -1)
      .map((_, i, parts) => parts.slice(0, i + 1).join('/')),
  ),
);
const basenames = new Set(files.map((f) => f.split('/').pop()));

/** Paths in the lifter's log repo, which is not this repository. */
const LOG_REPO =
  /^(sessions|templates|lifter|conflicts)\/|^(library\/)?additions\.csv$|^sisyphos\.json$/;
/** Named in a doc, not built yet: the exports (DATA.md, Exports). */
const PLANNED = new Set(['sets.csv', 'sessions.csv']);
/** Names the design removed, kept in DECISIONS.md's account of why. */
const REMOVED = new Set(['include_warmups', 'duration_s', 'distance_m']);

const TOP_LEVEL = /^(src|tests|scripts|docs|public|\.github|\.githooks)\//;
const FILE = /\.(ts|js|mjs|svelte|json|ya?ml|csv|md|html|png)$/;
const NAME = /^([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?(?:\(.*\))?$/;

function spans(text: string): string[] {
  const prose = text.replace(/^```[\s\S]*?^```/gm, '');
  return [...prose.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
}

function pathExists(span: string, doc: string): boolean {
  const path = span.replace(/\/$/, '');
  if (!path.includes('/')) return basenames.has(path) || dirSet.has(path);
  const docDir = doc.split('/').slice(0, -1).join('/');
  return ['', 'src/', docDir ? `${docDir}/` : ''].some(
    (base) => fileSet.has(base + path) || dirSet.has(base + path),
  );
}

function nameExists(name: string): boolean {
  if (name in globalThis) return true;
  const escaped = name.replace(/\$/g, '\\$');
  return new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`).test(code);
}

/** Looks like a name from the code: camelCase, PascalCase, snake_case, or called. */
const codeLike = (name: string, called: boolean) =>
  called || /[a-z][A-Z]|^[A-Z][a-z]+[A-Z]|_/.test(name);

function deadReferences(doc: string, text: string): string[] {
  const dead: string[] = [];
  for (const span of spans(text)) {
    if (/\s|[{}<>*]|^https?:|^\//.test(span)) continue;
    if (LOG_REPO.test(span) || PLANNED.has(span) || REMOVED.has(span)) continue;

    if (TOP_LEVEL.test(span) || (FILE.test(span) && /^[\w./-]+$/.test(span))) {
      if (!pathExists(span, doc)) dead.push(span);
      continue;
    }
    const name = NAME.exec(span);
    if (!name) continue;
    const called = span.endsWith(')');
    for (const part of [name[1], name[2]]) {
      if (part && codeLike(part, called) && !nameExists(part)) dead.push(span);
    }
  }
  return dead;
}

describe('the docs', () => {
  it('are found', () => {
    expect(Object.keys(docTexts)).toContain('/README.md');
    expect(files).toContain('.github/workflows/ci.yml');
  });

  it.each(Object.entries(docTexts))('%s names only files and code that exist', (doc, text) => {
    expect(deadReferences(doc.slice(1), text)).toEqual([]);
  });
});
