import type { IsoDate } from '../model';
import { addMonths, daysBetween, MONTH_NAMES } from '../metrics/dates';

/**
 * The geometry of the Strength hill: scales, ticks, the smoothed line and the
 * strata cut into the ground beneath it. Pure numbers and path strings, so the
 * chart can be tested; `progress/HillChart.svelte` only paints them.
 *
 * Units are the drawing's own (viewBox 0 0 343 204), which the card scales.
 */

export const CHART = {
  width: 343,
  height: 204,
  /** The plot, inside the room the right-hand figures and the month names need. */
  left: 8,
  right: 296,
  top: 14,
  bottom: 176,
  /** Figures at the right are right-aligned here. */
  labelX: 341,
  /** The baseline of the month names. */
  monthY: 196,
} as const;

/** How far below the line each incised stratum runs. */
export const STRATA_OFFSETS = [12, 24, 36, 48] as const;

export interface Point {
  x: number;
  y: number;
}

export function scaleLinear(
  d0: number,
  d1: number,
  r0: number,
  r1: number,
): (value: number) => number {
  // A collapsed domain (one point, a flat line) sits in the middle rather than dividing by zero.
  if (d1 === d0) return () => (r0 + r1) / 2;
  return (value) => r0 + ((value - d0) / (d1 - d0)) * (r1 - r0);
}

/** Steps a lifter would read off a plate: 1, 2, 2.5, 5, 10, and so on. */
const STEPS = [1, 2, 2.5, 5, 10];

/**
 * Round figures covering [min, max], about `count` of them (never more than one
 * extra). The first is at or below `min` and the last at or above `max`, so the
 * line never leaves the plot. A flat series gets a step either side to stand in.
 */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  const build = (step: number) => {
    let lo = Math.floor(min / step + 1e-9) * step;
    let hi = Math.ceil(max / step - 1e-9) * step;
    if (lo === hi) {
      lo -= step;
      hi += step;
    }
    const ticks: number[] = [];
    for (let t = lo; t <= hi + step / 1e6; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
    return ticks;
  };
  if (max === min) return build(Math.abs(min) >= 50 ? 2.5 : 1);

  const base = 10 ** Math.floor(Math.log10((max - min) / count));
  for (let magnitude = base; ; magnitude *= 10) {
    for (const step of STEPS.map((s) => s * magnitude)) {
      const ticks = build(step);
      if (ticks.length <= count + 1) return ticks;
    }
  }
}

/** The vertical scale for a set of values: its ticks and where a value lands. */
export function valueScale(values: readonly number[]): {
  ticks: number[];
  y: (v: number) => number;
} {
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  return { ticks, y: scaleLinear(ticks[0], ticks[ticks.length - 1], CHART.bottom, CHART.top) };
}

/**
 * The horizontal scale: days across the plot, so a gap in training shows as a
 * gap. A range of no length puts everything in the middle.
 */
export function dateScale(from: IsoDate, to: IsoDate): (date: IsoDate) => number {
  const days = daysBetween(from, to);
  const x = scaleLinear(0, days, CHART.left, CHART.right);
  return (date) => x(daysBetween(from, date));
}

/**
 * A smooth line through the points that never overshoots them: a monotone
 * cubic (Fritsch and Carlson), so a strong day is a peak and not a bulge that
 * climbs past the number. Points must run left to right.
 */
export function monotonePath(points: readonly Point[]): string {
  const n = points.length;
  if (n === 0) return '';
  const f = (v: number) => Math.round(v * 100) / 100;
  const start = `M${f(points[0].x)},${f(points[0].y)}`;
  if (n === 1) return start;
  if (n === 2) return `${start} L${f(points[1].x)},${f(points[1].y)}`;

  const dx = points.slice(1).map((p, i) => p.x - points[i].x);
  const slope = points.slice(1).map((p, i) => (dx[i] === 0 ? 0 : (p.y - points[i].y) / dx[i]));
  const tangent = new Array<number>(n);
  tangent[0] = slope[0];
  tangent[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    // A turning point is flat; elsewhere the mean of the two slopes, harmonically.
    tangent[i] =
      slope[i - 1] * slope[i] <= 0
        ? 0
        : (3 * (dx[i - 1] + dx[i])) /
          ((2 * dx[i] + dx[i - 1]) / slope[i - 1] + (dx[i] + 2 * dx[i - 1]) / slope[i]);
  }
  let d = start;
  for (let i = 0; i < n - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const h = dx[i] / 3;
    d += ` C${f(a.x + h)},${f(a.y + tangent[i] * h)} ${f(b.x - h)},${f(b.y - tangent[i + 1] * h)} ${f(b.x)},${f(b.y)}`;
  }
  return d;
}

/** The ground under the line, down to the baseline. */
export function areaPath(points: readonly Point[], baseline: number = CHART.bottom): string {
  if (points.length < 2) return '';
  const first = points[0];
  const last = points[points.length - 1];
  return `${monotonePath(points)} L${last.x},${baseline} L${first.x},${baseline} Z`;
}

/** The line repeated lower down, once per offset: the strata, clipped to the area by the caller. */
export function strataPaths(
  points: readonly Point[],
  offsets: readonly number[] = STRATA_OFFSETS,
): string[] {
  if (points.length < 2) return [];
  return offsets.map((dy) => monotonePath(points.map((p) => ({ x: p.x, y: p.y + dy }))));
}

/**
 * The index of the point nearest `x` across the plot, and among the points of
 * that same x (several sets on one day) the one nearest `y`; -1 when there are
 * none. Ties go left.
 */
export function nearestPoint(points: readonly Point[], x: number, y: number): number {
  let best = -1;
  let gap = Infinity;
  let rise = Infinity;
  points.forEach((p, i) => {
    const dx = Math.abs(p.x - x);
    const dy = Math.abs(p.y - y);
    if (dx < gap || (dx === gap && dy < rise)) {
      best = i;
      gap = dx;
      rise = dy;
    }
  });
  return best;
}

/** Where a pointer at `clientX` falls in the drawing's own units. */
export function toChartX(clientX: number, boxLeft: number, boxWidth: number): number {
  return boxWidth === 0 ? 0 : ((clientX - boxLeft) / boxWidth) * CHART.width;
}

/** Where a pointer at `clientY` falls in the drawing's own units. */
export function toChartY(clientY: number, boxTop: number, boxHeight: number): number {
  return boxHeight === 0 ? 0 : ((clientY - boxTop) / boxHeight) * CHART.height;
}

const SHORT_MONTHS = MONTH_NAMES.map((m) => m.slice(0, 3));

export interface MonthMark {
  x: number;
  /** "Apr" (the drawing sets it in caps). */
  label: string;
  /** January also names the year, so a long range stays legible. */
  year: number | null;
}

/**
 * The first of each month inside [from, to]: where a month name goes. Over
 * more than a year the names would crowd, so every `step`th month is kept,
 * chosen so no more than `max` show.
 */
export function monthMarks(from: IsoDate, to: IsoDate, max = 7): MonthMark[] {
  const x = dateScale(from, to);
  const firsts: IsoDate[] = [];
  const [fy, fm] = from.split('-').map(Number);
  let cursor: IsoDate = `${fy}-${String(fm).padStart(2, '0')}-01`;
  if (cursor < from) cursor = addMonths(cursor, 1);
  for (; cursor <= to; cursor = addMonths(cursor, 1)) firsts.push(cursor);
  const step = Math.max(1, Math.ceil(firsts.length / max));
  return firsts
    .filter((_, i) => i % step === 0)
    .map((date) => {
      const [y, m] = date.split('-').map(Number);
      return { x: x(date), label: SHORT_MONTHS[m - 1], year: m === 1 ? y : null };
    });
}

/**
 * Where a tooltip's left edge goes, in px of a card `container` wide: left of
 * the crosshair when it fits, else right of it, and always inside the card.
 */
export function tooltipLeft(crossX: number, tip: number, container: number, gap = 10): number {
  const left = crossX - gap - tip;
  const place = left >= 4 ? left : crossX + gap;
  return Math.max(4, Math.min(place, container - tip - 4));
}
