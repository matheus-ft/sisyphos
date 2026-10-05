import type { Session } from '../model';

/**
 * The hill and the boulder: where the stone sits for a session's progress, and
 * how far up that progress is. The drawing is `kit/Boulder.svelte`; the
 * numbers are here, so they are tested and the component only paints.
 *
 * Geometry is in the header drawing's units (viewBox 0 0 200 72), which the
 * frieze and the empty state reuse at other widths.
 */

/** The ridge the stone rolls up: two cubics from the foot to the summit. */
const RIDGE: [number, number][][] = [
  [
    [6, 66],
    [50, 62],
    [86, 52],
    [116, 38],
  ],
  [
    [116, 38],
    [138, 28],
    [160, 22],
    [186, 21],
  ],
];

export const RIDGE_PATH = 'M6,66 C50,62 86,52 116,38 C138,28 160,22 186,21';
/** The ridge on to the plateau, which the incised strata follow. */
export const RIDGE_LINE = `${RIDGE_PATH} L200,21`;
/** The hill: the ridge closed to the bottom, filled with the figure colour. */
export const HILL_PATH = `M0,72 L0,67 L6,66 C50,62 86,52 116,38 C138,28 160,22 186,21 L200,21 L200,72 Z`;
/** The flag on the summit while the stone is still climbing. */
export const SUMMIT_PATH = 'M193,21 V11.5 L200,14 L193,16.5';

/** The nine-sided stone, radius 1 about its centre, scaled by its radius. */
export const STONE_PATH =
  'M-.95,.2 L-.8,-.5 L-.35,-.95 L.3,-1 L.85,-.6 L1,.1 L.8,.7 L.2,1 L-.5,.9 Z';
/** The stone's incisions: a highlight arc and three cracks. */
export const STONE_INCISIONS = [
  'M-.62,-.42 Q-.25,-.72 .28,-.72',
  'M-.3,.12 L.1,.38 L.52,.22',
  'M.38,-.3 L.56,.02',
  'M-.6,.45 L-.38,.6',
];

/** Sisyphos pushing, in the stone's frame: origin at its centre, x along the slope. */
export const PUSHER_PATH = 'M-15,1 L-10.5,-4 L-6.6,-1.6 M-15,1 L-21.5,7 M-15,1 L-11.5,3 L-12.5,7';
export const PUSHER_HEAD = { cx: -8.6, cy: -7.2, r: 2.3 };
/** Sisyphos standing at the top, one hand on the stone. */
export const STANDING_PATH =
  'M-13.2,-0.5 L-13.2,-7.5 M-13.2,-6.5 L-7,-3 M-13.2,-6.5 L-16.5,-1.5 M-13.2,-0.5 L-15,7 M-13.2,-0.5 L-11.4,7';
export const STANDING_HEAD = { cx: -13.2, cy: -10.6, r: 2.3 };

export const BOULDER_RADIUS = 7;
/** Arc length kept behind the stone at the foot, so the figure fits at p = 0. */
export const START_LENGTH = 24;

/** The five strokes of glory around the arrived stone, as separate paths. */
export function gloryStrokes(radius = BOULDER_RADIUS): string[] {
  return [-150, -118, -90, -62, -30].map((deg) => {
    const a = (deg * Math.PI) / 180;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    const p = (r: number) => `${round(c * r)},${round(s * r)}`;
    return `M${p(radius + 3)} L${p(radius + 6.5)}`;
  });
}

interface Sample {
  /** Arc length from the foot. */
  s: number;
  x: number;
  y: number;
  /** Unit tangent, pointing uphill. */
  tx: number;
  ty: number;
}

const STEPS = 400;

/** The ridge sampled densely by arc length, once: a lookup is a search, not a solve. */
const SAMPLES: Sample[] = (() => {
  const out: Sample[] = [];
  let s = 0;
  let prev: [number, number] | null = null;
  for (const curve of RIDGE) {
    for (let i = out.length === 0 ? 0 : 1; i <= STEPS; i++) {
      const t = i / STEPS;
      const [x, y] = cubic(curve, t);
      const [dx, dy] = cubicDerivative(curve, t);
      const len = Math.hypot(dx, dy) || 1;
      if (prev) s += Math.hypot(x - prev[0], y - prev[1]);
      out.push({ s, x, y, tx: dx / len, ty: dy / len });
      prev = [x, y];
    }
  }
  return out;
})();

/** The ridge's arc length, foot to summit. */
export const RIDGE_LENGTH = SAMPLES[SAMPLES.length - 1].s;

/** Where on the ridge, and which way it runs, at arc length `s`. */
export function ridgeAt(s: number): Sample {
  const clamped = Math.min(Math.max(s, 0), RIDGE_LENGTH);
  let lo = 0;
  let hi = SAMPLES.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (SAMPLES[mid].s <= clamped) lo = mid;
    else hi = mid;
  }
  const a = SAMPLES[lo];
  const b = SAMPLES[hi];
  const f = b.s === a.s ? 0 : (clamped - a.s) / (b.s - a.s);
  const tx = a.tx + (b.tx - a.tx) * f;
  const ty = a.ty + (b.ty - a.ty) * f;
  const len = Math.hypot(tx, ty) || 1;
  return {
    s: clamped,
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    tx: tx / len,
    ty: ty / len,
  };
}

export interface Pose {
  /** The stone's centre. */
  x: number;
  y: number;
  /** The slope, in degrees: the frame Sisyphos pushes in. */
  angle: number;
  /** How far the stone has rolled, in degrees, without slipping. */
  roll: number;
}

/**
 * The stone at progress `p` (0 to 1): resting on the ridge, a radius above it
 * along the upward normal, rolled by the distance it travelled.
 */
export function poseAt(p: number, radius = BOULDER_RADIUS): Pose {
  const progress = Math.min(Math.max(Number.isFinite(p) ? p : 0, 0), 1);
  const s = START_LENGTH + progress * (RIDGE_LENGTH - START_LENGTH);
  const at = ridgeAt(s);
  // The upward normal: the tangent turned a quarter towards the sky (y grows down).
  const [nx, ny] = [at.ty, -at.tx];
  return {
    x: at.x + radius * nx,
    y: at.y + radius * ny,
    angle: (Math.atan2(at.ty, at.tx) * 180) / Math.PI,
    roll: ((s / radius) * 180) / Math.PI,
  };
}

/**
 * A session's sets, as the header's readout counts them ("9 of 15"): done
 * working sets over the working sets planned and not skipped. Warm-ups never
 * count. A session with nothing prescribed has no plan to measure against, so
 * it borrows the median working-set count of the last four finished sessions,
 * and always one more than is done, so the stone reaches the top only at
 * Finish.
 */
export function sessionTally(session: Session, recent: Session[]): { done: number; total: number } {
  const working = session.exercises.flatMap((e) => e.performed.filter((s) => !s.is_warmup));
  const done = working.filter((s) => s.state === 'done').length;
  if (session.exercises.some((e) => e.prescribed.length > 0)) {
    return { done, total: working.filter((s) => s.state !== 'skipped').length };
  }
  const counts = [...recent]
    .filter((s) => s.id !== session.id && s.ended_at !== null)
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) || (b.started_at ?? '').localeCompare(a.started_at ?? ''),
    )
    .slice(0, 4)
    .map(
      (s) =>
        s.exercises.flatMap((e) => e.performed.filter((p) => !p.is_warmup && p.state === 'done'))
          .length,
    );
  return { done, total: Math.max(Math.ceil(median(counts)), done + 1) };
}

/** How far up the hill a session is, 0 to 1: its tally as a fraction. */
export function sessionProgress(session: Session, recent: Session[]): number {
  const { done, total } = sessionTally(session, recent);
  return total > 0 ? Math.min(done / total, 1) : 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function cubic(c: [number, number][], t: number): [number, number] {
  const u = 1 - t;
  const [a, b, d, e] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [
    a * c[0][0] + b * c[1][0] + d * c[2][0] + e * c[3][0],
    a * c[0][1] + b * c[1][1] + d * c[2][1] + e * c[3][1],
  ];
}

function cubicDerivative(c: [number, number][], t: number): [number, number] {
  const u = 1 - t;
  const [a, b, d] = [3 * u * u, 6 * u * t, 3 * t * t];
  return [
    a * (c[1][0] - c[0][0]) + b * (c[2][0] - c[1][0]) + d * (c[3][0] - c[2][0]),
    a * (c[1][1] - c[0][1]) + b * (c[2][1] - c[1][1]) + d * (c[3][1] - c[2][1]),
  ];
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
