import { describe, expect, it } from 'vitest';
import { cubicBezier, parseDuration } from '../src/ui/kit/motion';
import { RIDGE_LENGTH, gloryStrokes, poseAt, ridgeAt } from '../src/ui/hill';

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
