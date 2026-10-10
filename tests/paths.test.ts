import { describe, it, expect } from 'vitest';
import {
  classify,
  conflictPath,
  FORMAT_PATH,
  meetPath,
  RETIRED_PATHS,
  sessionPath,
  TABLE_PATHS,
  templatePath,
} from '../src/storage/paths';
import { newConflictId, newMeetId, newSessionId, newTemplateId } from '../src/storage/ids';

/** A small seeded PRNG, so the generated ids are the same every run. */
function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const none = () => false;

describe('a retired kind', () => {
  it('is foreign: sync neither reads nor writes what an earlier build kept there', () => {
    expect(RETIRED_PATHS).toContain('lifter/competition-bests.csv');
    for (const path of RETIRED_PATHS) expect(classify(path), path).toEqual({ kind: 'foreign' });
    for (const path of Object.values(TABLE_PATHS)) expect(RETIRED_PATHS).not.toContain(path);
  });
});

describe('classify', () => {
  it('recognises every path the builders produce, as the same record', () => {
    const random = mulberry32(7);
    const names = ['Squat Day A', 'Bench — Volume', 'x', '   ', 'Ünïcödé ✓', 'a'.repeat(80)];
    for (let i = 0; i < 500; i++) {
      const session = newSessionId('2026-09-14', none, random);
      expect(classify(sessionPath(session))).toEqual({ kind: 'session', id: session });
      const conflict = newConflictId('2026-09-27', none, random);
      expect(classify(conflictPath(conflict))).toEqual({ kind: 'conflict', id: conflict });
      const meet = newMeetId('2026-05-16', none, random);
      expect(classify(meetPath(meet))).toEqual({ kind: 'meet', id: meet });
      const template = newTemplateId(names[i % names.length], none, random);
      expect(classify(templatePath(template))).toEqual({ kind: 'template', id: template });
    }
  });

  it('recognises the format marker and every table', () => {
    expect(classify(FORMAT_PATH)).toEqual({ kind: 'format' });
    for (const [table, path] of Object.entries(TABLE_PATHS)) {
      expect(classify(path)).toEqual({ kind: 'table', table });
    }
  });

  it('leaves the lifter’s own files alone, however close to ours they are', () => {
    for (const path of [
      'README.md',
      'notes.json',
      'templates/notes.json',
      'templates/My Backup.json',
      'templates/squat-day-a.json',
      'templates/Squat-Day-A-k3f9.json',
      'conflicts/README.json',
      'conflicts/2026-09-27.json',
      'sessions/2026/2026.json',
      'sessions/2026/2026 my notes.json',
      'sessions/2026/2026-01-01-ABCD.json',
      'sessions/2026/2026-01-01-k3fi.json', // i is not in the alphabet
      'sessions/2025/2026-01-01-k3f9.json', // filed under the wrong year
      'sessions/2026-01-01-k3f9.json',
      'lifter/bodyweight.csv.bak',
      'lifter/notes.csv',
      'meets/notes.json',
      'meets/2026-05-16.json',
      'meets/2026-05-16-ABCD.json',
      'meets/2026-05-16-8mzi.json', // i is not in the alphabet
      'meets/2026-5-16-8mzt.json',
      'meets/2026/2026-05-16-8mzt.json', // meets are a flat folder
      'meets/2026-05-16-8mzt.json.bak',
      'meets/2026-05-16-8mzt.csv',
      'meets/ nationals 2026-05-16-8mzt.json',
    ]) {
      expect(classify(path), path).toEqual({ kind: 'foreign' });
    }
  });
});
