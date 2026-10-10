import { describe, it, expect } from 'vitest';
import {
  ID_ALPHABET,
  newConflictId,
  newMeetId,
  newSessionId,
  newTemplateId,
  slug,
} from '../src/storage/ids';
import { classify, meetPath, sessionPath, templatePath } from '../src/storage/paths';

/** Mulberry32: a small seeded PRNG, so every generated case is reproducible. */
function prng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A `random` that returns these values in turn, then repeats them. */
function sequence(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

const none = () => false;
const SUFFIX = `[${ID_ALPHABET}]{4}`;

describe('the alphabet', () => {
  it('is lowercase Crockford base 32', () => {
    expect(ID_ALPHABET).toHaveLength(32);
    expect(new Set(ID_ALPHABET).size).toBe(32);
    expect(ID_ALPHABET).toMatch(/^[0-9a-z]+$/);
    for (const c of 'ilou') expect(ID_ALPHABET).not.toContain(c);
  });

  it('is used whole, and nothing outside it is', () => {
    const random = prng(1);
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const id = newSessionId('2026-09-14', none, random);
      for (const c of id.slice(-4)) seen.add(c);
    }
    expect([...seen].sort().join('')).toBe(ID_ALPHABET);
  });

  it('maps the edges of [0, 1) to its first and last characters', () => {
    expect(newSessionId('2026-09-14', none, () => 0)).toBe('2026-09-14-0000');
    expect(newSessionId('2026-09-14', none, () => 0.999999)).toBe('2026-09-14-zzzz');
  });
});

describe('session ids', () => {
  it('are the date, then four random characters', () => {
    const random = prng(2);
    for (let i = 0; i < 100; i++) {
      expect(newSessionId('2026-09-14', none, random)).toMatch(
        new RegExp(`^2026-09-14-${SUFFIX}$`),
      );
    }
  });

  it('name a file sync recognises as a session', () => {
    const id = newSessionId('2026-09-14', none, prng(3));
    expect(classify(sessionPath(id))).toEqual({ kind: 'session', id });
  });

  it('work with the default random', () => {
    expect(newSessionId('2026-09-14', none)).toMatch(new RegExp(`^2026-09-14-${SUFFIX}$`));
  });

  it('refuse a date that is not YYYY-MM-DD', () => {
    for (const date of ['14Sep26', '2026-9-14', '', '2026-09-14T10:00']) {
      expect(() => newSessionId(date, none)).toThrow(/YYYY-MM-DD/);
    }
  });
});

describe('conflict ids', () => {
  it('are the date found, then four random characters', () => {
    expect(newConflictId('2026-09-27', none, prng(4))).toMatch(
      new RegExp(`^2026-09-27-${SUFFIX}$`),
    );
    expect(() => newConflictId('27/09/2026', none)).toThrow(/YYYY-MM-DD/);
  });
});

describe('meet ids', () => {
  it('are the meet’s date when created, then four random characters', () => {
    const random = prng(10);
    for (let i = 0; i < 100; i++) {
      expect(newMeetId('2026-05-16', none, random)).toMatch(new RegExp(`^2026-05-16-${SUFFIX}$`));
    }
    expect(newMeetId('2026-05-16', none, () => 0)).toBe('2026-05-16-0000');
  });

  it('name a file sync recognises as a meet', () => {
    const id = newMeetId('2026-05-16', none, prng(11));
    expect(classify(meetPath(id))).toEqual({ kind: 'meet', id });
  });

  it('refuse a date that is not YYYY-MM-DD, and never return one already held', () => {
    expect(() => newMeetId('16 May 2026', none)).toThrow(/YYYY-MM-DD/);
    const taken = new Set(['2026-05-16-0000']);
    expect(
      newMeetId('2026-05-16', (id) => taken.has(id), sequence(0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5)),
    ).toBe('2026-05-16-gggg');
  });
});

describe('template ids', () => {
  it('are a slug of the name, then four random characters', () => {
    expect(newTemplateId('Squat Day A', none, prng(5))).toMatch(
      new RegExp(`^squat-day-a-${SUFFIX}$`),
    );
    expect(newTemplateId('', none, prng(6))).toMatch(new RegExp(`^template-${SUFFIX}$`));
  });

  it('name a file sync recognises as a template, even where the slug needed its extra rules', () => {
    // The cut at 40 ends on a hyphen; a name with nothing left; an ordinary name.
    for (const name of [`${'a'.repeat(39)} b`, '💪💪', 'Squat Day A']) {
      const id = newTemplateId(name, none, prng(9));
      expect(classify(templatePath(id)), name).toEqual({ kind: 'template', id });
    }
  });
});

describe('never returning an id already held', () => {
  it('draws again past every taken id', () => {
    // Four draws of 0 make `0000`, of 0.5 `gggg`, of 0.999999 `zzzz`.
    const random = sequence(...[0, 0.5, 0.999999].flatMap((r) => [r, r, r, r]));
    const taken = new Set(['2026-09-14-0000', '2026-09-14-gggg']);
    expect(newSessionId('2026-09-14', (id) => taken.has(id), random)).toBe('2026-09-14-zzzz');
  });

  it('finds every free id in a crowded space, and never a held one', () => {
    // Each character drawn from `0` and `1` only: 16 possible ids.
    const random = prng(7);
    const crowded = () => Math.floor(random() * 2) / 32;
    const held = new Set<string>();
    for (let i = 0; i < 16; i++) {
      const id = newTemplateId('Bench', (x) => held.has(x), crowded);
      expect(id).toMatch(/^bench-[01]{4}$/);
      expect(held.has(id)).toBe(false);
      held.add(id);
    }
    expect(held.size).toBe(16);
    expect(() => newTemplateId('Bench', (x) => held.has(x), crowded)).toThrow(/no free id/);
  });

  it('fails loudly rather than hang when random keeps drawing a taken id', () => {
    expect(() =>
      newSessionId(
        '2026-09-14',
        () => true,
        () => 0,
      ),
    ).toThrow(/no free id/);
  });
});

describe('slugs', () => {
  it.each([
    ['Squat Day A', 'squat-day-a'],
    ['Week 10 — Day 2', 'week-10-day-2'],
    ['  --Hello,   World!!  ', 'hello-world'],
    ['ALL CAPS', 'all-caps'],
    ['snake_case_name', 'snake-case-name'],
    ['Café Crème', 'caf-cr-me'],
    ['Übung 1', 'bung-1'],
    ['日本語 Day', 'day'],
    ['💪 Push 💪', 'push'],
    ['a/b\\c', 'a-b-c'],
    ['tab\tand\nnewline', 'tab-and-newline'],
  ])('%j is %j', (name, expected) => {
    expect(slug(name)).toBe(expected);
  });

  it.each(['', '   ', '!!!', '---', '日本語', '💪💪', 'ÀÉÎ'])(
    '%j has nothing left, so is "template"',
    (name) => {
      expect(slug(name)).toBe('template');
    },
  );

  it('is cut to 40 characters', () => {
    expect(slug('a'.repeat(100))).toBe('a'.repeat(40));
    expect(slug('Very long template name that goes on and on and on forever')).toBe(
      'very-long-template-name-that-goes-on-and',
    );
  });

  it('never ends in a hyphen after the cut', () => {
    expect(slug(`${'a'.repeat(39)} b`)).toBe('a'.repeat(39));
    const random = prng(8);
    for (let i = 0; i < 500; i++) {
      const words = Array.from({ length: 12 }, () =>
        'abc'.repeat(1 + Math.floor(random() * 3)).slice(0, 1 + Math.floor(random() * 7)),
      );
      const s = slug(words.join(' !'));
      expect(s.length).toBeLessThanOrEqual(40);
      expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});
