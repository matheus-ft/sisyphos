import { describe, expect, it } from 'vitest';
import type { PerformedSet, Session } from '../src/model';
import { cubicBezier, parseDuration } from '../src/ui/kit/motion';
import {
  RIDGE_LENGTH,
  gloryStrokes,
  poseAt,
  ridgeAt,
  sessionProgress,
  sessionTally,
} from '../src/ui/hill';
import { newSession } from '../src/ui/session';

/** Within a tenth of a unit of the design: a browser measures arc length a little differently. */
const near = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected)).toBeLessThan(0.15);

describe('the stone on the hill', () => {
  // The design's drawings, measured with getPointAtLength in the browser.
  it('rests at the foot at p = 0, with room behind it for the figure', () => {
    const pose = poseAt(0);
    near(pose.x, 28.88);
    near(pose.y, 56.21);
    near(pose.angle, -8.6);
    expect(pose.roll).toBeCloseTo(196.4, 0);
  });

  it('sits where the design draws it at p = 0.6', () => {
    const pose = poseAt(0.6);
    near(pose.x, 120.25);
    near(pose.y, 28.52);
    near(pose.angle, -22.5);
    expect(pose.roll).toBeCloseTo(995, -1);
  });

  it('reaches the summit at p = 1', () => {
    const pose = poseAt(1);
    near(pose.x, 185.73);
    near(pose.y, 14.01);
  });

  it('stays on the hill for progress outside 0 to 1', () => {
    expect(poseAt(-1)).toEqual(poseAt(0));
    expect(poseAt(3)).toEqual(poseAt(1));
    expect(poseAt(Number.NaN)).toEqual(poseAt(0));
  });

  it('measures the ridge from the foot to the summit', () => {
    expect(ridgeAt(0)).toMatchObject({ x: 6, y: 66 });
    expect(ridgeAt(RIDGE_LENGTH)).toMatchObject({ x: 186, y: 21 });
    expect(RIDGE_LENGTH).toBeGreaterThan(180);
    expect(RIDGE_LENGTH).toBeLessThan(200);
  });

  it('draws the glory strokes from r + 3 to r + 6.5 at the five angles', () => {
    expect(gloryStrokes()).toEqual([
      'M-8.66,-5 L-11.69,-6.75',
      'M-4.69,-8.83 L-6.34,-11.92',
      'M0,-10 L0,-13.5',
      'M4.69,-8.83 L6.34,-11.92',
      'M8.66,-5 L11.69,-6.75',
    ]);
  });
});

const set = (state: PerformedSet['state'], warmup = false): PerformedSet => ({
  id: crypto.randomUUID(),
  prescribed_id: null,
  state,
  reps: state === 'done' ? 5 : null,
  rpe: state === 'done' && !warmup ? 8 : null,
  load: state === 'done' ? { kind: 'weight', value: 100, unit: 'kg' } : null,
  is_warmup: warmup,
  notes: null,
});

let day = 1;
function session(sets: PerformedSet[], planned: boolean, ended = false): Session {
  const s = newSession({
    id: `s${day}`,
    at: new Date(2026, 8, day++, 18),
    tz: 'Europe/Lisbon',
    deviceId: 'phone',
  });
  return {
    ...s,
    ended_at: ended ? s.started_at : null,
    exercises: [
      {
        id: 'i',
        exercise_id: 'low_bar_squat',
        prescribed: planned
          ? [
              {
                reps: [5, 5],
                rpe: null,
                load: { kind: 'weight', weight: { mode: 'rpe_driven' } },
                is_warmup: false,
                notes: null,
                id: 'p',
              },
            ]
          : [],
        performed: sets,
        notes: null,
      },
    ],
  };
}

describe('how far up a session is', () => {
  it('counts done working sets over those planned and not skipped', () => {
    const s = session([set('done'), set('done'), set('pending'), set('skipped')], true);
    expect(sessionProgress(s, [])).toBeCloseTo(2 / 3);
  });

  it('never counts warm-ups', () => {
    const s = session([set('done', true), set('done', true), set('done'), set('pending')], true);
    expect(sessionProgress(s, [])).toBe(0.5);
  });

  it('arrives when every planned set is done', () => {
    expect(sessionProgress(session([set('done'), set('skipped')], true), [])).toBe(1);
  });

  it('measures a session without a plan against the median of the last four', () => {
    const past = [3, 5, 9, 4, 20].map((n) =>
      session(
        Array.from({ length: n }, () => set('done')),
        false,
        true,
      ),
    );
    // The last four by date hold 5, 9, 4 and 20 sets: a median of 7.
    const now = session([set('done'), set('done'), set('pending')], false);
    expect(sessionProgress(now, past)).toBeCloseTo(2 / 7);
  });

  it('keeps a session without a plan short of the top until Finish', () => {
    const now = session([set('done'), set('done'), set('done')], false);
    expect(sessionProgress(now, [])).toBe(3 / 4);
  });

  it('rounds a borrowed median up to whole sets, for the readout', () => {
    const past = [4, 5].map((n) =>
      session(
        Array.from({ length: n }, () => set('done')),
        false,
        true,
      ),
    );
    expect(sessionTally(session([set('done')], false), past)).toEqual({ done: 1, total: 5 });
  });

  it('is at the foot for an empty session', () => {
    expect(sessionProgress(session([], false), [])).toBe(0);
  });
});

describe('motion from the tokens', () => {
  it('reads durations in ms or s', () => {
    expect(parseDuration('240ms')).toBe(240);
    expect(parseDuration(' 1.8s ')).toBe(1800);
    expect(parseDuration('0ms')).toBe(0);
    expect(parseDuration('fast')).toBeNull();
  });

  it('eases like the CSS cubic-bezier it copies', () => {
    const linear = cubicBezier(0, 0, 1, 1);
    expect(linear(0.3)).toBeCloseTo(0.3, 4);
    const roll = cubicBezier(0.33, 0, 0.15, 1);
    expect(roll(0)).toBe(0);
    expect(roll(1)).toBe(1);
    expect(roll(0.5)).toBeGreaterThan(0.5);
    // Monotone: the stone never rolls back mid-tween.
    let last = 0;
    for (let x = 0; x <= 1; x += 0.01) {
      const y = roll(x);
      expect(y).toBeGreaterThanOrEqual(last - 1e-9);
      last = y;
    }
  });
});
