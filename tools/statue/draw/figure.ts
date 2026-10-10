import type { PaintedMuscle, PaintedPart } from '../../../src/ui/progress/statue-art';
import { STATUE_REGIONS, type StatueView } from '../../../src/ui/statue';

/**
 * Drawing a figure by its anatomy rather than by hand-written curves: each
 * outline is a list of points along the form, and a smooth curve is fitted
 * through them (Catmull-Rom, as cubic Béziers). A shape is one or more runs of
 * points; within a run the curve is smooth, and runs meet at a corner, as a
 * muscle's border meets the centre line.
 *
 * Shapes are authored for the viewer's left half, x < 60 in a 120 wide view,
 * and mirrored, as the app's statue is (`src/ui/progress/statue-art.ts`); what
 * comes out has that drawing's shape, so the app's `Statue.svelte` paints it.
 */

export type Pt = [number, number];
/** A shape: runs of points, each smooth, joined at corners. */
export type Runs = Pt[][];

const LAYERS = ['fill', 'wash', 'dilute', 'relief', 'contour', 'fine', 'hair', 'locks'] as const;
type Layer = (typeof LAYERS)[number];

export interface Part<V extends StatueView> {
  /** The viewer's left half, drawn again mirrored. */
  half?: Partial<Record<Layer, Shape[]>> & {
    regions?: [keyof (typeof STATUE_REGIONS)[V] & string, Shape][];
  };
  /** On the centre line, drawn once. */
  whole?: Partial<Record<Layer, Shape[]>>;
}

/** A closed area or an open line, as runs of points. */
export interface Shape {
  runs: Runs;
  closed: boolean;
}

export const area = (...runs: Runs): Shape => ({ runs, closed: true });
export const line = (...runs: Runs): Shape => ({ runs, closed: false });

const num = (n: number) => String(Math.round(n * 100) / 100);
const xy = ([x, y]: Pt) => `${num(x)} ${num(y)}`;

/** Cubic segments through `pts`, smooth at every inner point; the ends take their own direction. */
function smooth(pts: Pt[]): string {
  let d = '';
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${xy(c1)} ${xy(c2)} ${xy(p2)}`;
  }
  return d;
}

function path(shape: Shape, f: (p: Pt) => Pt): string {
  const runs = shape.runs.map((run) => run.map(f));
  let d = `M ${xy(runs[0][0])}`;
  runs.forEach((run, i) => {
    if (i > 0) d += ` L ${xy(run[0])}`;
    d += smooth(run);
  });
  return shape.closed ? `${d} Z` : d;
}

const same = (p: Pt): Pt => p;
const mirror = ([x, y]: Pt): Pt => [120 - x, y];

/** Each part's layers as path data, the half drawn twice; regions grouped by the muscle they show. */
export function paint<V extends StatueView>(view: V, parts: Part<V>[]): PaintedPart[] {
  const muscleOf = STATUE_REGIONS[view] as Record<string, string>;
  return parts.map(({ half = {}, whole = {} }) => {
    const both = (s: Shape) => `${path(s, same)} ${path(s, mirror)}`;
    const layers = Object.fromEntries(
      LAYERS.map((layer) => [
        layer,
        [...(half[layer] ?? []).map(both), ...(whole[layer] ?? []).map((s) => path(s, same))],
      ]),
    ) as Record<Layer, string[]>;
    const muscles: PaintedMuscle[] = [];
    for (const [region, shape] of half.regions ?? []) {
      const muscle = muscleOf[region];
      let entry = muscles.find((m) => m.muscle === muscle);
      if (!entry) muscles.push((entry = { muscle, regions: [] }));
      entry.regions.push({ region, d: both(shape) });
    }
    return { ...layers, muscles };
  });
}

/** A circle as a closed shape, for a nipple or a navel. */
export function ring(cx: number, cy: number, r: number): Shape {
  const pts: Pt[] = Array.from({ length: 9 }, (_, i) => {
    const a = (i / 8) * 2 * Math.PI;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
  return area(pts);
}
