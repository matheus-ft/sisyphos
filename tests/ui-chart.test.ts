import { describe, expect, it } from 'vitest';
import {
  areaPath,
  CHART,
  dateScale,
  monotonePath,
  monthMarks,
  nearestIndex,
  niceTicks,
  scaleLinear,
  strataPaths,
  STRATA_OFFSETS,
  toChartX,
  tooltipLeft,
  valueScale,
} from '../src/ui/chart';

describe('scaleLinear', () => {
  it('maps the domain onto the range, inverted when asked', () => {
    expect(scaleLinear(0, 10, 0, 100)(5)).toBe(50);
    expect(scaleLinear(100, 200, 176, 14)(200)).toBe(14);
  });

  it('puts a collapsed domain in the middle', () => {
    expect(scaleLinear(5, 5, 0, 100)(5)).toBe(50);
  });
});

describe('niceTicks', () => {
  it('rounds to figures a lifter reads off a plate, covering the data', () => {
    expect(niceTicks(148, 163)).toEqual([145, 150, 155, 160, 165]);
    expect(niceTicks(102.5, 140, 4)).toEqual([100, 110, 120, 130, 140]);
  });

  it('gives a flat series a step either side', () => {
    expect(niceTicks(100, 100)).toEqual([97.5, 100, 102.5]);
  });

  it('never leaves the data outside its first and last tick', () => {
    for (const [min, max] of [
      [60, 61],
      [87.3, 91.9],
      [0.4, 3.2],
      [180, 400],
    ]) {
      const t = niceTicks(min, max);
      expect(t[0]).toBeLessThanOrEqual(min);
      expect(t[t.length - 1]).toBeGreaterThanOrEqual(max);
      expect(t.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('is empty for what is not a number', () => {
    expect(niceTicks(NaN, 3)).toEqual([]);
  });
});

describe('valueScale', () => {
  it('puts the lowest tick on the baseline and the highest on the top', () => {
    const { ticks, y } = valueScale([148, 163]);
    expect(y(ticks[0])).toBe(CHART.bottom);
    expect(y(ticks[ticks.length - 1])).toBe(CHART.top);
  });
});

describe('dateScale', () => {
  it('runs by days, so a gap in training shows', () => {
    const x = dateScale('2026-04-01', '2026-04-11');
    expect(x('2026-04-01')).toBe(CHART.left);
    expect(x('2026-04-11')).toBe(CHART.right);
    expect(x('2026-04-02')).toBeCloseTo(CHART.left + (CHART.right - CHART.left) / 10);
  });

  it('centres a range of no length', () => {
    expect(dateScale('2026-04-01', '2026-04-01')('2026-04-01')).toBe(
      (CHART.left + CHART.right) / 2,
    );
  });
});

describe('monotonePath', () => {
  it('is empty, a move, or a line for fewer than three points', () => {
    expect(monotonePath([])).toBe('');
    expect(monotonePath([{ x: 1, y: 2 }])).toBe('M1,2');
    expect(
      monotonePath([
        { x: 1, y: 2 },
        { x: 5, y: 6 },
      ]),
    ).toBe('M1,2 L5,6');
  });

  it('passes through every point', () => {
    const d = monotonePath([
      { x: 0, y: 10 },
      { x: 10, y: 4 },
      { x: 20, y: 8 },
    ]);
    expect(d.startsWith('M0,10 C')).toBe(true);
    expect(d).toContain(' 10,4 C');
    expect(d.endsWith(' 20,8')).toBe(true);
  });

  it('never overshoots: every control point stays inside the data', () => {
    const pts = [
      { x: 0, y: 100 },
      { x: 10, y: 20 },
      { x: 20, y: 22 },
      { x: 30, y: 100 },
    ];
    const nums = [...monotonePath(pts).matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
    const ys = nums.filter((_, i) => i % 2 === 1);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(20);
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
  });

  it('is flat across a turning point', () => {
    const d = monotonePath([
      { x: 0, y: 10 },
      { x: 10, y: 0 },
      { x: 20, y: 10 },
    ]);
    expect(d).toMatch(/,0 10,0 C/);
  });
});

describe('areaPath and strata', () => {
  const pts = [
    { x: 8, y: 100 },
    { x: 100, y: 60 },
    { x: 200, y: 50 },
  ];

  it('closes the line down to the baseline', () => {
    expect(areaPath(pts)).toMatch(/L200,176 L8,176 Z$/);
    expect(areaPath([pts[0]])).toBe('');
  });

  it('repeats the line lower down, once for each stratum', () => {
    const strata = strataPaths(pts);
    expect(strata).toHaveLength(STRATA_OFFSETS.length);
    expect(strata[0]).toBe(monotonePath(pts.map((p) => ({ ...p, y: p.y + 12 }))));
    expect(strataPaths([pts[0]])).toEqual([]);
  });
});

describe('nearestIndex', () => {
  it('finds the closest x, the left one on a tie', () => {
    expect(nearestIndex([10, 50, 90], 60)).toBe(1);
    expect(nearestIndex([10, 50, 90], 70)).toBe(1);
    expect(nearestIndex([10, 50, 90], 71)).toBe(2);
    expect(nearestIndex([], 5)).toBe(-1);
  });
});

describe('toChartX', () => {
  it('turns a pointer position into the drawing own units', () => {
    expect(toChartX(200, 100, 343)).toBe(100);
    expect(toChartX(300, 0, 686)).toBeCloseTo(150);
    expect(toChartX(5, 0, 0)).toBe(0);
  });
});

describe('monthMarks', () => {
  it('marks the first of each month inside the range', () => {
    const marks = monthMarks('2026-04-10', '2026-10-05');
    expect(marks.map((m) => m.label)).toEqual(['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']);
    expect(marks[0].x).toBeGreaterThan(CHART.left);
  });

  it('thins a long range and names the year at January', () => {
    const marks = monthMarks('2024-01-01', '2026-10-05');
    expect(marks.length).toBeLessThanOrEqual(7);
    expect(marks[0].label).toBe('Jan');
    expect(marks[0].year).toBe(2024);
  });

  it('has none inside a range shorter than a month with no first in it', () => {
    expect(monthMarks('2026-04-10', '2026-04-20')).toEqual([]);
  });
});

describe('tooltipLeft', () => {
  it('sits left of the crosshair when it fits', () => {
    expect(tooltipLeft(300, 150, 343)).toBe(140);
  });

  it('goes right when there is no room on the left', () => {
    expect(tooltipLeft(40, 150, 343)).toBe(50);
  });

  it('stays inside the card', () => {
    expect(tooltipLeft(100, 150, 200)).toBe(46);
  });
});
