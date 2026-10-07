/**
 * The statue, drawn: Sisyphos as a Greek bronze or marble would show a mature
 * hero, front and back, on a plinth. Each figure is a 120 x 302 viewBox. Paths
 * are authored for the viewer's left half of a body standing square, mirrored
 * about x = 60, given the hero's build (`build`) and then posed (`pose`): a
 * firm contrapposto, the weight on one leg.
 *
 * After the Riace warriors and the Artemision god rather than an archaic
 * kouros, which reads as Egyptian (the stride, the clenched fists, the beaded
 * wig, the staring eyes, the fixed smile), or a slender youth, which reads
 * soft: a beard, curls, eyes left blank as a statue's are, broad shoulders and
 * a heavy neck, hands loosely closed. The modelling that makes it read as
 * carved is the component's lighting (`Statue.svelte`).
 *
 * Which muscle group each region shows is `src/ui/statue.ts`.
 */
import { STATUE_REGIONS, type RegionOf, type StatueView } from '../statue';

/** The strokes and fills a part is painted in, in painting order. */
const LAYERS = ['fill', 'wash', 'dilute', 'relief', 'contour', 'fine', 'hair', 'locks'] as const;
type Layer = (typeof LAYERS)[number];
type Pieces = Partial<Record<Layer, string[]>>;

interface PartSource<V extends StatueView> {
  /** What the part moves with in the pose: the body, unless it hangs from a shoulder, turns on the neck or is the ground. */
  bone?: Bone;
  /** The viewer's left half; drawn again mirrored. */
  half: Pieces & { regions?: [RegionOf<V>, string][] };
  /** On the centre line; drawn once. */
  whole?: Pieces;
}

export interface PaintedMuscle {
  muscle: string;
  regions: { region: string; d: string }[];
}

/** Each layer is a list of path data, one element per piece. */
export type PaintedPart = Record<Layer, string[]> & { muscles: PaintedMuscle[] };

// ---------------------------------------------------------------------------
// Path plumbing. Only absolute M, L, C and Z are used, so every number pair is
// a point and a path can be reversed segment by segment.

type Pt = [number, number];
type Point = (x: number, y: number) => Pt;
interface Segment {
  /** Control points then the end point: one for L, three for C. */
  pts: Pt[];
}
interface Subpath {
  start: Pt;
  segments: Segment[];
  closed: boolean;
}

function parse(d: string): Subpath[] {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+/g) ?? [];
  const subpaths: Subpath[] = [];
  let i = 0;
  const point = (): Pt => [Number(tokens[i++]), Number(tokens[i++])];
  while (i < tokens.length) {
    const command = tokens[i++];
    const current = subpaths[subpaths.length - 1];
    if (command === 'M') subpaths.push({ start: point(), segments: [], closed: false });
    else if (command === 'L') current.segments.push({ pts: [point()] });
    else if (command === 'C') current.segments.push({ pts: [point(), point(), point()] });
    else if (command === 'Z') current.closed = true;
    else throw new Error(`statue path uses ${command}; only M L C Z can be mirrored`);
  }
  return subpaths;
}

/** The same outline traced the other way, so a mirrored copy keeps the original's winding. */
function reverse({ start, segments, closed }: Subpath): Subpath {
  const ends = [start, ...segments.map((s) => s.pts[s.pts.length - 1])];
  const reversed = segments
    .map((s, k) => ({ pts: [...s.pts.slice(0, -1).reverse(), ends[k]] }))
    .reverse();
  return { start: ends[ends.length - 1], segments: reversed, closed };
}

const round = (n: number) => String(Math.round(n * 100) / 100);

function serialize(subpaths: Subpath[]): string {
  const xy = ([x, y]: Pt) => `${round(x)} ${round(y)}`;
  return subpaths
    .map(
      (p) =>
        `M ${xy(p.start)} ` +
        p.segments
          .map((s) => `${s.pts.length === 1 ? 'L' : 'C'} ${s.pts.map(xy).join(' ')}`)
          .join(' ') +
        (p.closed ? ' Z' : ''),
    )
    .join(' ');
}

function transform(d: string, f: Point, flip: boolean): string {
  const moved = parse(d).map(({ start, segments, closed }) => ({
    start: f(...start),
    segments: segments.map((s) => ({ pts: s.pts.map((p) => f(...p)) })),
    closed,
  }));
  return serialize(flip ? moved.map(reverse) : moved);
}

function circle(cx: number, cy: number, r: number): string {
  const k = 0.5523 * r;
  return [
    `M ${cx - r} ${cy}`,
    `C ${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r}`,
    `C ${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy}`,
    `C ${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r}`,
    `C ${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy} Z`,
  ].join(' ');
}

// ---------------------------------------------------------------------------
// The pose. Contrapposto: the weight on one leg, whose hip rises and juts out,
// the shoulders tilting the other way, the free knee bent and its foot set
// back and out. Seen from the front the weight is on the viewer's left (the
// figure's right leg, as the Doryphoros stands); from the back that leg is on
// the viewer's right. One continuous bend of the plane for the body, so every
// outline moves with the shapes beside it; an arm moves with its shoulder and
// the head turns on the neck.

type Bone = 'body' | 'arm' | 'head' | 'ground';

const DEG = Math.PI / 180;
const POSE = {
  /** The shoulders: down on the weight side. */
  chest: -5 * DEG,
  /** The hips: up on the weight side. */
  pelvis: 7 * DEG,
  /** Sideways, the chest a little toward the free side, the pelvis out over the weight leg. */
  chestShift: 1,
  pelvisShift: -2.5,
  /** The head inclines toward the weight leg. */
  head: -3 * DEG,
  /** The weight leg slants in, its foot under the body. */
  standing: -1.5 * DEG,
  /** The free leg: knee in from the hip, the shin out from the knee. */
  thigh: 3 * DEG,
  shin: -9 * DEG,
};
/** The free foot is set back: farther from the viewer in front, so shorter; nearer from behind. */
const FREE_SHIN: Record<StatueView, number> = { front: 0.93, back: 0.99 };

const NECK_PIVOT: Pt = [60, 47];
const HIPS: Record<'weight' | 'free', Pt> = { weight: [47, 154], free: [73, 154] };
const KNEE: Pt = [70, 212];

/** 0 before `a`, 1 after `b`, easing in and out between. */
function smooth(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mixPt = (a: Pt, b: Pt, t: number): Pt => [mix(a[0], b[0], t), mix(a[1], b[1], t)];

function rotate([x, y]: Pt, [cx, cy]: Pt, angle: number): Pt {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
}

/**
 * The trunk, row by row: each row tilts about the centre line, at the
 * shoulders' angle above the ribs and the hips' below the waist, so the weight
 * side's flank shortens and the free side's lengthens.
 */
function trunk([x, y]: Pt): Pt {
  const t = smooth(100, 140, y);
  const angle = mix(POSE.chest, POSE.pelvis, t);
  const d = x - 60;
  return [
    60 + mix(POSE.chestShift, POSE.pelvisShift, t) + d * Math.cos(angle),
    y + d * Math.sin(angle),
  ];
}

/** A leg moves whole with its hip, then turns there; the free one bends at the knee too. */
function leg(p: Pt, free: boolean, shin: number): Pt {
  const hip = free ? HIPS.free : HIPS.weight;
  const turn = smooth(154, 176, p[1]);
  let q = p;
  if (free) {
    const bend = smooth(204, 220, p[1]);
    q = [q[0], KNEE[1] + (q[1] - KNEE[1]) * mix(1, shin, bend)];
    q = rotate(q, KNEE, POSE.shin * bend);
    q = rotate(q, hip, POSE.thigh * turn);
  } else {
    q = rotate(q, hip, POSE.standing * turn);
  }
  const at = trunk(hip);
  return [q[0] + at[0] - hip[0], q[1] + at[1] - hip[1]];
}

/**
 * The body: the trunk, giving way below the groin to the legs. Which leg a
 * point belongs to is its side of the centre line, softened at the crotch so
 * the two halves still meet there.
 */
function body(p: Pt, shin: number): Pt {
  const [x, y] = p;
  const t = trunk(p);
  const w = smooth(141, 168, y);
  if (w === 0) return t;
  const reach = mix(3, 0.001, smooth(150, 165, y));
  const side = smooth(60 - reach, 60 + reach, x);
  const legs = mixPt(leg(p, false, shin), leg(p, true, shin), side);
  return mixPt(t, legs, w);
}

/**
 * The hero's build, on the square-standing drawing (viewer's left half, the
 * other mirrored): shoulders and chest broader than the waist, a heavy neck,
 * thicker arms, and thighs and calves that fill outward from the inner line.
 */
const BUILD = { chest: 1.07, neck: 1.18, arm: 1.14, leg: 1.08 };

function build(bone: Bone, [x, y]: Pt): Pt {
  if (bone === 'ground' || bone === 'head') return [x, y];
  if (x > 60) {
    const [mx, my] = build(bone, [120 - x, y]);
    return [120 - mx, my];
  }
  if (bone === 'arm') {
    // Thicker about its own axis down to the wrist, the hand as it is, and all
    // of it carried out by the broader shoulder.
    const axis = 26;
    const out = (60 - 33.8) * (BUILD.chest - 1);
    const thick = mix(BUILD.arm, 1, smooth(146, 158, y));
    return [axis + (x - axis) * thick - out, y];
  }
  // Broad above the ribs, narrowing to the waist; the neck broader still.
  const chest = mix(BUILD.chest, 1, smooth(95, 132, y));
  const trunk = y < 58 ? mix(BUILD.neck, BUILD.chest, smooth(48, 58, y)) : chest;
  let nx = 60 + (x - 60) * trunk;
  // The legs fill out from their inner edge, so the thighs do not cross.
  const leg = smooth(150, 172, y) * (BUILD.leg - 1);
  nx = 59 + (nx - 59) * (1 + leg);
  return [nx, y];
}

/** Where a point of the front view goes: on `bone`, the viewer's left the weight side. */
function posed(bone: Bone, p: Pt, shin: number): Pt {
  if (bone === 'ground') return p;
  if (bone === 'arm') {
    // The shoulder's cap goes with the trunk; below it the arm hangs straight
    // from the front of the shoulder, wherever the trunk has carried that.
    const shoulder: Pt = p[0] < 60 ? [33.8, 59] : [86.2, 59];
    const at = trunk(shoulder);
    const hanging: Pt = [p[0] + at[0] - shoulder[0], p[1] + at[1] - shoulder[1]];
    return mixPt(trunk(p), hanging, smooth(62, 90, p[1]));
  }
  if (bone === 'head') {
    const at = trunk(NECK_PIVOT);
    const q = rotate(p, NECK_PIVOT, POSE.head);
    return [q[0] + at[0] - NECK_PIVOT[0], q[1] + at[1] - NECK_PIVOT[1]];
  }
  return body(p, shin);
}

/** The pose for a view: from the back, the front's, mirrored, so the weight is on the same leg. */
function pose(view: StatueView, bone: Bone): Point {
  const shin = FREE_SHIN[view];
  if (view === 'front') return (x, y) => posed(bone, build(bone, [x, y]), shin);
  return (x, y) => {
    const [px, py] = posed(bone, build(bone, [120 - x, y]), shin);
    return [120 - px, py];
  };
}

// ---------------------------------------------------------------------------
// Shared outlines (viewer's left half). Landmarks: C0 the front of the
// shoulder, D the deltoid's insertion, A the armpit, EO / EI the outer and
// inner elbow, WO / WI the outer and inner wrist.

const C0 = '33.8 59';
const TO_D = 'C 26 58.6 19.6 63.5 18.6 71.5 C 17.9 78.5 19.6 88 21.6 95.4';
const D_TO_EO = 'C 20.6 101.5 19.9 109.5 20.2 117.5';
const EO_TO_D = 'C 19.9 109.5 20.6 101.5 21.6 95.4';
// The forearm swells just below the elbow and tapers to the wrist.
const EO_TO_WO =
  'C 19 122.8 18.8 127.8 19.6 133 C 20.8 140.4 22.8 147 24.2 152 C 24.7 155 25 158 25.1 160.5';
const WO_TO_EO =
  'C 25 158 24.7 155 24.2 152 C 22.8 147 20.8 140.4 19.6 133 C 18.8 127.8 19 122.8 20.2 117.5';
/** A hand hanging at rest, loosely closed: the fingers curled in, the thumb along them. */
const HAND =
  'C 24.4 165 24.6 170 25.6 174.4 C 26.6 178.2 28.6 180.6 30.9 180.6 C 33.2 180.6 34.7 178.6 34.9 175.6 ' +
  'C 35.1 172 34.6 167.8 34.1 164.4 C 33.8 162.2 33.6 160.2 33.3 158.5';
const WI_TO_EI = 'C 32.9 149 32.3 136 31.7 126 C 31.5 122.6 31.3 119.6 31.1 116.5';
const EI_TO_WI = 'C 31.3 119.6 31.5 122.6 31.7 126 C 32.3 136 32.9 149 33.3 158.5';
const EI_TO_A = 'C 31.4 108 31.9 97 31.8 90 C 31.8 87 31.8 84.6 31.8 82.6';
const A_TO_EI = 'C 31.8 84.6 31.8 87 31.8 90 C 31.9 97 31.4 108 31.1 116.5';
/** The underside of the upper arm, in shadow against the body. */
const ARM_SHADOW =
  'M 31.8 90 C 31.9 97 31.4 108 31.1 116.5 C 29.8 110 29.6 100 30.2 93 C 30.5 91.6 31.1 90.6 31.8 90 Z';
/** The deltoid's front edge, from the pectoral's corner up to C0: a rounded cap, not a pad. */
const DELT_FRONT = `C 32.4 71.4 34.8 65.4 ${C0}`;
const WRIST = 'C 27.6 160.8 30.6 160 33.3 158.5';
const WRIST_BACK = 'C 30.6 160 27.6 160.8 25.1 160.5';
const ARM = `M ${C0} ${TO_D} ${D_TO_EO} ${EO_TO_WO} ${HAND} ${WI_TO_EI} ${EI_TO_A}`;

const TORSO_SIDE =
  'M 31.8 82.6 C 33.5 92 35.8 104 39.5 115 C 40.8 119 41.6 123 41.6 127 C 41.4 132 39.8 136.6 38.2 141';
const NECK = 'M 50.8 38 C 50.8 44 50.4 48 48.6 51.4';
const SHOULDER = `C 44 54.6 38.6 56.8 ${C0}`;
const INGUINAL = 'M 38.2 141 C 44 145.6 50.5 151 56 154.4 C 57.6 155.4 58.8 156.4 60 157';

const LEG =
  'M 38.2 141 C 36.2 147 34.8 153 34.4 161 C 33.8 171 34.6 180 36 189 C 37.2 197 39.4 204.4 40.8 210.4 ' +
  'C 41.4 213.4 41.4 216.2 40.8 219.4 C 39.2 225 38.4 231 38.6 237.4 C 38.9 246 41 256 43.6 264.6 ' +
  'C 44.6 268.6 45.2 272.4 45.4 275.4 C 44.6 277.8 43.2 280.4 42.4 283.2 C 41.6 286.2 41.2 289 41.8 291.2 ' +
  'C 44 292.6 53 292.8 56.4 291.8 C 57 289.6 56.9 286.5 56.2 283.5 C 55.6 280.6 54.4 278 53.9 275.6 ' +
  'C 54.2 271.4 55.4 266.8 56.6 261.4 C 58 254 58.9 246 58.8 238.4 C 58.6 230 57.6 223.4 57.5 218.4 ' +
  'C 57.5 215 58.2 212 58.2 208.4 C 57.9 199 57.7 190 58.2 180 C 58.6 173 59.2 168 59.7 165';
const LEG_FILL = `${LEG} L 60 165 L 60 150 L 48 143 Z`;

/** The head's outline, front or back: broad cheeks, a firm chin, a rounded skull. */
const HEAD =
  'M 60 46.4 C 56.2 46.4 52.6 44.2 50.6 40.6 C 49 37.6 48.3 33 48.4 28.4 C 48.5 21.6 52.4 14.5 60 14.5 C 67.6 14.5 71.5 21.6 71.6 28.4 C 71.7 33 71 37.6 69.4 40.6 C 67.4 44.2 63.8 46.4 60 46.4 Z';

/**
 * The beard: from the sideburns along the jaw to below the chin, leaving the
 * cheeks and the mouth. Its curls are drawn over it (`curls`).
 */
const BEARD =
  'M 48.8 30.6 C 48.2 37 49.4 43.4 52.4 48.2 C 54.6 51.8 57.4 54.2 60 54.4 C 62.6 54.2 65.4 51.8 67.6 48.2 ' +
  'C 70.6 43.4 71.8 37 71.2 30.6 C 70.4 34.2 68.8 36.8 66.6 38.4 C 65.2 39.4 64.4 40.2 63.8 41.2 ' +
  'C 63.2 43.4 61.8 44.6 60 44.6 C 58.2 44.6 56.8 43.4 56.2 41.2 C 55.6 40.2 54.8 39.4 53.4 38.4 ' +
  'C 51.2 36.8 49.6 34.2 48.8 30.6 Z';

/** Over the upper lip, parted under the nose. */
const MOUSTACHE =
  'M 55.6 40.8 C 56.8 38.8 58.6 38.2 60 38.9 C 61.4 38.2 63.2 38.8 64.4 40.8 ' +
  'C 62.8 40.2 61.4 40.2 60 40.7 C 58.6 40.2 57.2 40.2 55.6 40.8 Z';

const ANKLES = [
  'M 53.9 275 C 55.4 275.6 56 277.8 55 279.6',
  'M 45.4 274.2 C 44 275.2 43.6 277.2 44.4 279',
];

// ---------------------------------------------------------------------------
// Front

/** The plinth the statue stands on: a block with a moulding along its top. */
const PLINTH: PartSource<StatueView> = {
  bone: 'ground',
  half: {},
  whole: {
    fill: ['M 25 288.6 L 95 288.6 L 98 291.8 L 98 301.4 L 22 301.4 L 22 291.8 Z'],
    dilute: ['M 22.2 291.8 L 97.8 291.8'],
    contour: ['M 25 288.6 L 95 288.6 L 98 291.8 L 98 301.4 L 22 301.4 L 22 291.8 Z'],
  },
};

const FRONT: PartSource<'front'>[] = [
  PLINTH as PartSource<'front'>,
  {
    half: {
      fill: [LEG_FILL],
      regions: [
        [
          'rectusFemoris',
          'M 39.6 140 C 44.5 144.5 49.5 148.6 54.6 152.2 C 52.8 160 51.6 170 51.2 180 C 50.8 190 50.2 198 49.6 205 C 48 199 46.4 190 44.9 180 C 43.2 168 41.4 154 39.6 140 Z',
        ],
        [
          'vastusLateralis',
          'M 38.2 141 L 39.6 140 C 41.4 154 43.2 168 44.9 180 C 46.4 190 48 199 49.6 205 C 46.8 206.8 43.8 208.6 41 210.8 C 39.4 204.4 37.2 197 36 189 C 34.6 180 33.8 171 34.4 161 C 34.8 153 36.2 147 38.2 141 Z',
        ],
        [
          'vastusMedialis',
          'M 51.2 180 C 53.8 182.4 56 186 57.8 190 C 57.9 194 57.9 197 57.8 200 C 57.9 205 56 209 53.4 209.8 C 51.6 208.6 50.3 206.8 49.6 205 C 50.2 198 50.8 190 51.2 180 Z',
        ],
        [
          'adductor',
          'M 54.6 152.2 C 56.6 154.6 58.6 157.6 60 161.4 C 59.4 166 58.6 172 58.2 180 C 58 184 57.8 187 57.8 190 C 56 186 53.8 182.4 51.2 180 C 51.6 170 52.8 160 54.6 152.2 Z',
        ],
        [
          'tibialis',
          'M 46 223 C 45.4 232 45.8 243 47.2 252 C 48 258 49 263 50 267 L 50.8 266.4 C 50.5 258 50.2 248 50.1 238 C 50 231 49.8 226 49.2 221.6 C 48 221.8 46.9 222.3 46 223 Z',
        ],
        [
          'calfOuter',
          'M 41 219.6 C 39.4 225 38.6 231 38.8 237.4 C 39.1 246 41 255 43.4 263.4 C 44.4 259.6 45.6 256 47.2 252 C 45.8 243 45.4 232 46 223 C 44.4 221.4 42.8 220.2 41 219.6 Z',
        ],
        [
          'calfInner',
          'M 57.4 219 C 58.4 226 59 233 58.9 240 C 58.8 249 57.6 257 55.8 264 C 54.6 258 53.8 250 53.8 242 C 53.8 234 55 225.6 57.4 219 Z',
        ],
      ],
      wash: [
        // the inner thigh in shadow
        'M 59.6 166 C 58.6 172 58 180 58.1 190 C 58 198 58.1 204 58.2 208 C 56.9 202 56.7 194 56.8 186 C 57 178 58 171 59.6 166 Z',
      ],
      dilute: [
        'M 46.2 206.4 C 45.8 211 47.6 214.4 50 214.4 C 52.4 214.4 54 211.4 53.8 207.6', // kneecap
        'M 44.4 217.8 C 47 219.6 52.6 219.6 55.6 217.4', // the ridge below it
        ...ANKLES,
        // toes
        'M 44.6 287.6 L 44.8 291.8',
        'M 47.3 287.2 L 47.4 292.2',
        'M 50 287 L 50 292.4',
        'M 52.8 286.8 L 52.8 292.3',
      ],
      contour: [LEG],
    },
  },
  {
    half: {
      fill: [
        `M 60 38 L 50.8 38 C 50.8 44 50.4 48 48.6 51.4 ${SHOULDER} C 32 66 31.2 75 31.8 82.6 ` +
          'C 33.5 92 35.8 104 39.5 115 C 40.8 119 41.6 123 41.6 127 C 41.4 132 39.8 136.6 38.2 141 ' +
          'C 44 145.6 50.5 151 56 154.4 C 57.6 155.4 58.8 156.4 60 157 Z',
      ],
      regions: [
        [
          'abdomen',
          // Meets its mirror on the centre line, where its edge is the linea alba.
          'M 31.8 82.6 C 34.4 88.6 38.4 93.6 44.6 95.4 C 50.2 96.8 55.4 96.2 59 93.4 L 60 93.6 L 60 157 C 58.8 156.4 57.6 155.4 56 154.4 C 50.5 151 44 145.6 38.2 141 C 39.8 136.6 41.4 132 41.6 127 C 41.6 125 41.5 123 41.2 121.2 C 39.6 114.6 38.4 106 37.6 98.4 C 37 93 35.4 88.2 31.8 82.6 Z',
        ],
        [
          'flank',
          'M 31.8 82.6 C 33.5 92 35.8 104 39.5 115 C 40.2 117 40.8 119.2 41.2 121.2 C 39.6 114.6 38.4 106 37.6 98.4 C 37 93 35.4 88.2 31.8 82.6 Z',
        ],
        [
          'pectoral',
          `M 59.2 62.6 C 55.6 60.8 47 60.4 40 60.6 C 37.4 60.6 35.4 60.4 33.6 60.2 C 32.2 64.6 30.6 70 29.6 75.4 C 30.4 78 31.1 80.4 31.8 82.6 C 34.4 88.6 38.4 93.6 44.6 95.4 C 50.2 96.8 55.4 96.2 59 93.4 C 59.3 92 59.4 90.4 59.4 88.6 L 59.4 66 C 59.4 64.6 59.4 63.4 59.2 62.6 Z`,
        ],
      ],
      wash: [
        // shade under the chest and down the flank
        'M 33.6 86 C 37 91.6 41 94.8 46 96.2 C 51 97.4 55.6 96.8 59.6 94.4 C 55.8 99.2 50.4 99.8 45.4 98.8 C 40 97.6 36 93 33.6 86 Z',
        'M 37.6 99 C 38.6 107 40 115 41.4 121.6 C 41.8 124 41.9 126.4 41.6 128.6 C 40.6 124 39.4 118 38.6 112 C 38 107 37.6 103 37.6 99 Z',
      ],
      dilute: [
        'M 58.8 58.6 C 54.6 57.2 47.6 58.6 41 59.2 C 38.4 59.5 36 59.8 34 60', // clavicle
        'M 50.8 42.4 C 52.6 47.2 55.2 52.4 58 56', // sternomastoid, from behind the ear to the pit
        circle(45.4, 86.2, 0.95),
        // the rectus: three bands above the navel
        'M 60 106 C 58 105.5 56 105.8 54.2 107',
        'M 60 113.8 C 58 113.3 56 113.6 54.4 114.8',
        'M 60 121.4 C 58.2 121 56.4 121.4 54.8 122.4',
      ],
      relief: [
        'M 31.8 82.6 C 34.4 88.6 38.4 93.6 44.6 95.4 C 50.2 96.8 55.4 96.2 59.2 93.2', // chest
        'M 60 97.4 C 55.4 98.4 50.4 101.8 46.8 107.8 C 44.6 111.8 43 116.6 42.2 121', // thoracic arch
        INGUINAL,
      ],
      contour: [TORSO_SIDE, `${NECK} ${SHOULDER}`],
    },
    whole: {
      dilute: ['M 58.2 56.6 C 58.8 58.6 61.2 58.6 61.8 56.6'], // the pit of the neck
      fine: [circle(60, 129.2, 1)], // navel
    },
  },
  {
    bone: 'arm',
    half: {
      fill: [`${ARM} C 31.1 80.4 30.4 78 29.6 75.4 ${DELT_FRONT} Z`],
      regions: [
        ['deltoid', `M ${C0} ${TO_D} C 25.4 89.6 28.4 82 29.6 75.4 ${DELT_FRONT} Z`],
        [
          'biceps',
          `M 21.6 95.4 ${D_TO_EO} C 23.6 119.4 27.6 119.4 31.1 116.5 ${EI_TO_A} C 31.1 80.4 30.4 78 29.6 75.4 C 28.4 82 25.4 89.6 21.6 95.4 Z`,
        ],
        [
          'forearm',
          `M 20.2 117.5 ${EO_TO_WO} ${WRIST} ${WI_TO_EI} C 27.6 119.4 23.6 119.4 20.2 117.5 Z`,
        ],
      ],
      wash: [ARM_SHADOW],
      dilute: [
        'M 23.4 120 C 25.8 121.4 28.4 121.2 30.6 119.4', // elbow
        'M 21.6 124.4 C 22.8 133 24.6 143.6 26.6 153.6', // brachioradialis, the thumb side
        'M 33.8 161.8 C 32 163.6 31 166.4 31.2 169.8 C 31.3 171.2 31.8 172.4 32.6 173', // thumb
        'M 26.2 174 C 28.4 175.4 31.2 175.8 33.8 175', // the curled fingers
        'M 27.2 177.6 C 29.2 178.6 31.6 178.8 33.6 178.2',
      ],
      relief: [`M 31.8 82.6 C 31.1 80.4 30.4 78 29.6 75.4 ${DELT_FRONT}`],
      contour: [ARM],
    },
  },
  {
    bone: 'head',
    half: {
      // The jaw: broad cheeks narrowing to a firm chin.
      relief: ['M 48.4 28.4 C 48.3 33 49 37.6 50.6 40.6 C 52.6 44.2 56.2 46.4 60 46.4'],
      fine: [
        // a low, level brow, running on into the nose
        'M 50.8 27.6 C 52.6 26.2 55.8 25.9 58.1 26.9 C 58.6 27.2 58.9 27.6 59.1 28.1',
        // the eye: deep-set under a heavy lid, and blank, as a statue's is
        'M 52.2 30.4 C 53.5 29.2 55.9 29.1 57.3 30.4 C 55.9 31.3 53.6 31.4 52.2 30.4 Z',
        'M 51.9 30 C 53.4 28.4 56.2 28.3 57.7 30',
      ],
    },
    whole: {
      fill: [HEAD],
      dilute: [
        // the nose's ridge, and its base with the nostrils' wings
        'M 59.2 27.8 C 59 30.8 58.6 33.4 57.9 35.3 C 57.4 36.3 58 37.1 59 36.9 C 59.6 37.3 60.4 37.3 61 36.9 C 62 37.1 62.6 36.3 62.1 35.3',
        'M 58.2 42.7 C 59.3 43.3 60.7 43.3 61.8 42.7', // lower lip
      ],
      // The lips at rest, under the moustache.
      fine: ['M 57.4 41 C 58.4 41.1 59.4 40.9 60 41.1 C 60.6 40.9 61.6 41.1 62.6 41'],
      hair: [frontCap(), BEARD, MOUSTACHE],
      locks: [
        ...curls([
          [13.6, [56.4, 60, 63.6]],
          [16.6, [52.4, 56.2, 60, 63.8, 67.6]],
          [19.4, [50.4, 54, 57.8, 61.6, 65.4, 69]],
          [44.6, [52.8, 56.4, 63.6, 67.2]],
          [48, [54.6, 58.2, 61.8, 65.4]],
          [51.2, [57.4, 61]],
        ]),
        // the moustache's two sweeps
        'M 59.4 39.4 C 58.4 39.2 57.4 39.6 56.8 40.2',
        'M 60.6 39.4 C 61.6 39.2 62.6 39.6 63.2 40.2',
      ],
    },
  },
  // The ears, the curls over their tops.
  {
    bone: 'head',
    half: {
      fill: ['M 49 26.6 C 47.2 25.4 45.6 26.8 45.8 29.4 C 46 32.4 47.2 35 49.4 35.8 Z'],
      dilute: ['M 48.2 28.8 C 47.2 29.6 47.4 32 48.6 33'],
      fine: ['M 49 26.6 C 47.2 25.4 45.6 26.8 45.8 29.4 C 46 32.4 47.2 35 49.4 35.8'],
    },
  },
];

/**
 * A row of short locks along a hairline from `x0` to `x1`, each a comma hanging
 * `drop` below the line and curling the same way, as the Doryphoros wears them.
 */
function locksAlong(x0: number, x1: number, line: (x: number) => number, n: number, drop: number) {
  const w = (x1 - x0) / n;
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = x0 + i * w;
    const b = a + w;
    d += ` C ${a + w * 0.15} ${line(a) + drop} ${b - w * 0.35} ${line(b) + drop * 1.1} ${b} ${line(b)}`;
  }
  return d;
}

/** The cap of curls from the front: close to the skull, a fringe of locks over the brow. */
function frontCap(): string {
  const hairline = (x: number) => 21.6 + 0.04 * (x - 60) ** 2;
  return (
    'M 48.7 30.6 C 47.1 25.6 47.4 18.6 51.2 14.4 C 53.8 11.6 56.9 10.6 60 10.6 ' +
    'C 63.1 10.6 66.2 11.6 68.8 14.4 C 72.6 18.6 72.9 25.6 71.3 30.6 C 70.9 28.4 70.3 26.6 69.6 25.2' +
    locksAlong(69.6, 50.4, hairline, 7, 1.8) +
    ' C 49.7 26.6 49.1 28.4 48.7 30.6 Z'
  );
}

/** From behind, the curls cover the skull and end in a row of locks on the nape. */
function backCap(): string {
  const nape = (x: number) => 41 - 0.02 * (x - 60) ** 2;
  return (
    'M 60 8.6 C 52 8.6 46.9 14.8 46.8 23.6 C 46.7 29 47.2 34.2 48.2 38.1' +
    locksAlong(48.2, 71.8, nape, 8, 1.8) +
    ' C 72.8 34.2 73.3 29 73.2 23.6 C 73.1 14.8 68 8.6 60 8.6 Z'
  );
}

/** A curl at each point, row by row: a short hook scratched through the glaze. */
function curls(rows: [number, number[]][]): string[] {
  return rows.flatMap(([y, xs]) =>
    xs.map(
      (x) =>
        `M ${x - 1} ${y + 0.6} C ${x - 1.8} ${y - 1} ${x + 0.6} ${y - 2} ${x + 1.4} ${y - 0.6}`,
    ),
  );
}

// ---------------------------------------------------------------------------
// Back

const S = '30.4 62.4'; // where the shoulder blade's spine meets the shoulder
const R = '46.4 72.6'; // the root of that spine
const I = '44.2 100.2'; // the blade's lowest point
const SCAPULA_EDGE = `C 46 82 45.4 92 ${I}`; // R down to I
const J = '55 114.8'; // where the lat leaves the trapezius
const TRAP_LOW = `C 47.4 104.6 51 110 ${J}`; // I to J
const TRAP_TIP = `C 56.8 117 58.4 119.4 60 121.2`; // J to the spine
const K = '39.6 137.6'; // the iliac crest at the flank
const Q = '52 141.6'; // the dimple over the sacrum
const CREST = `C 48.2 136.6 43.4 135.6 ${K}`; // Q out to K
const ERECTOR_EDGE = `C 53.4 118.4 51.6 123.6 51.2 129 C 50.9 133.6 51.2 138 ${Q}`; // J to Q
const SACRUM = `C 57 154 54.2 148.6 ${Q}`; // the top of the cleft up to Q
const GLUTE_EDGE = 'C 34.8 166 36.6 174 42 177.8 C 46.8 180.8 53 181.6 57.2 180.2';

const BACK: PartSource<'back'>[] = [
  PLINTH as PartSource<'back'>,
  {
    half: {
      fill: [LEG_FILL],
      regions: [
        [
          'hamstring',
          `M 34.4 161 ${GLUTE_EDGE} L 56.6 180.4 C 56 187 55.8 193 57.6 200.6 C 57.9 204 58.2 206 58.2 208.4 C 58.1 210.4 57.8 212.2 57.6 213.8 L 55.4 214.2 C 54.2 211 52.4 208.4 49.8 207 C 47.2 208.4 45.4 211 44.2 214.2 L 41.6 213.8 C 41.4 212.4 41.2 211.4 40.8 210.4 C 39.4 204.4 37.2 197 36 189 C 34.6 180 33.8 171 34.4 161 Z`,
        ],
        [
          'adductor',
          'M 56.6 180.4 C 57.8 180 58.8 179.6 59.8 179 C 59.2 186 58.6 193 57.6 200.6 C 55.8 193 56 187 56.6 180.4 Z',
        ],
        [
          'calf',
          // Two heads rising into the knee's hollow; the inner one is the larger and ends lower.
          'M 44.2 216 C 41.4 221.4 39.4 228 39 236 C 38.8 243 40 249 42 254.4 C 44 254.6 46.2 252.6 48.4 251 L 49.8 252.4 C 51.4 254 53.4 257.6 55.4 261.6 C 57.4 255 58.8 247 58.8 239 C 58.7 230 57.8 222 55.6 215.8 C 54 217.6 51.6 219.8 49.8 221 C 48 219.8 45.6 217.6 44.2 216 Z',
        ],
      ],
      wash: [
        'M 42 178 C 47 181 53 182 57.4 180.6 C 53.4 184 47.6 183.6 42 178 Z', // under the buttock
      ],
      dilute: [
        'M 49.8 207 C 49.4 199 48.6 191 47.2 183', // between the hamstrings
        'M 44.8 214.8 C 47.4 216.2 52.2 216.2 55 214.6', // back of the knee
        'M 49.8 222 C 50 232 50 242 49.8 251.6', // the calf's two heads
        'M 48.2 253.4 C 48.4 262 48.2 269 47.4 275', // Achilles
        'M 51.8 256.8 C 51.6 264 51.8 270 52.4 275',
        ...ANKLES,
      ],
      contour: [LEG],
    },
  },
  {
    half: {
      fill: [
        `M 60 40 L 50.8 40 C 50.8 44 50.4 48 48.6 51.4 ${SHOULDER} C 32 66 31.2 75 31.8 82.6 ` +
          'C 33.5 92 35.8 104 39.5 115 C 40.8 119 41.6 123 41.6 127 C 41.4 132 39.8 136.6 38.2 141 ' +
          `C 36.6 146.6 35.6 152 35.2 157 ${GLUTE_EDGE} C 58.2 179.8 59.2 179.2 60 178.6 Z`,
      ],
      regions: [
        [
          'erector',
          `M ${J} ${TRAP_TIP} L 60 158 ${SACRUM} C 51.2 138 50.9 133.6 51.2 129 C 51.6 123.6 53.4 118.4 ${J} Z`,
        ],
        [
          'lat',
          `M 31.8 82.6 C 35.8 88.6 40 94.6 ${I} ${TRAP_LOW} ${ERECTOR_EDGE} ${CREST} C 40.6 134.6 41.5 131 41.6 127 C 41.6 123 40.8 119 39.5 115 C 35.8 104 33.5 92 31.8 82.6 Z`,
        ],
        [
          'glute',
          `M 60 158 ${SACRUM} ${CREST} C 39 139 38.6 140 38.2 141 C 36.6 146.6 35.6 152 35.2 157 ${GLUTE_EDGE} C 58.2 179.8 59.2 179.2 60 178.6 Z`,
        ],
        [
          // with the rhomboids, inside the shoulder blade
          'trapezius',
          `M 60 40 L 50.8 40 C 50.8 44 50.4 48 48.6 51.4 ${SHOULDER} C 32.6 60 31.4 61.2 ${S} C 35.6 66 41 69.4 ${R} ${SCAPULA_EDGE} ${TRAP_LOW} ${TRAP_TIP} Z`,
        ],
      ],
      wash: [
        'M 60 76 C 58.6 92 58.4 110 58.8 128 C 59 138 59.4 146 60 152 Z', // the spine's furrow
      ],
      dilute: [
        'M 50.8 142.2 C 51.4 143.4 52.4 144 53.4 143.8', // the dimple over the sacrum
        'M 40.6 140.2 C 43 145.4 47.6 149.6 53.8 150.4', // the upper edge of glute max, under glute med
        'M 35.4 158 C 35.6 166 37.6 173 41.8 177.4', // the buttock's outer edge
      ],
      relief: [`M 42 177.8 C 46.8 180.8 53 181.6 57.2 180.2 C 58.2 179.8 59.2 179.2 60 178.6`],
      contour: [
        `${TORSO_SIDE} C 36.6 146.6 35.6 152 35.2 157 C 34.9 159.6 34.7 161.6 34.5 163.6`,
        `M 48.6 51.4 ${SHOULDER}`,
      ],
    },
    whole: {
      dilute: ['M 60 74 L 60 148'], // the spine, in its furrow
      relief: ['M 60 157 C 60 164 60.1 171 60.2 178.4'], // the cleft
    },
  },
  {
    bone: 'arm',
    half: {
      fill: [`${ARM} L 27 72 L 29.6 62.6 L ${C0} Z`],
      regions: [
        [
          // the posterior delt, and below the blade's spine infraspinatus and teres minor
          'rearDeltoid',
          `M ${C0} ${TO_D} C 24.6 92 28 87.4 31.8 82.6 C 35.8 88.6 40 94.6 ${I} C 45.4 92 46 82 ${R} C 41 69.4 35.6 66 ${S} C 31.4 61.2 32.6 60 ${C0} Z`,
        ],
        [
          'triceps',
          `M 21.6 95.4 C 24.6 92 28 87.4 31.8 82.6 ${A_TO_EI} C 29.4 119.4 27.6 120.6 25.8 120.8 C 24 120.6 21.8 119.6 20.2 117.5 ${EO_TO_D} Z`,
        ],
        [
          'forearm',
          `M 20.2 117.5 C 21.8 119.6 24 120.6 25.8 120.8 C 27.6 120.6 29.4 119.4 31.1 116.5 ${EI_TO_WI} ${WRIST_BACK} ${WO_TO_EO} Z`,
        ],
      ],
      wash: [ARM_SHADOW],
      dilute: [
        'M 37.4 66.8 C 33.4 73 29.6 81.4 26.4 89.4', // the delt's edge on the shoulder blade
        'M 23.4 124.6 C 24.8 134 26.8 146 28.4 156.4', // the forearm's extensors
        'M 25.6 169.4 C 28.2 170.6 31.6 170.8 34.6 169.6', // knuckles
        'M 26.4 174 C 28.6 175.4 31.4 175.8 34 175', // the curled fingers
      ],
      contour: [ARM],
    },
  },
  {
    bone: 'head',
    half: {
      fill: ['M 47.2 26.4 C 45.6 26.6 44.8 28.6 45.2 31 C 45.6 33.6 46.4 35.4 47.4 36.2 Z'],
      fine: ['M 47.2 26.4 C 45.6 26.6 44.8 28.6 45.2 31 C 45.6 33.6 46.4 35.4 47.4 36.2'],
    },
    whole: {
      hair: [backCap()],
      locks: curls([
        [13, [55, 60, 65]],
        [17, [51, 55.5, 60, 64.5, 69]],
        [21.5, [49.5, 54, 58.5, 63, 67.5, 71]],
        [26, [49, 53.5, 58, 62.5, 67, 71]],
        [30.5, [50, 54.5, 59, 63.5, 68]],
      ]),
    },
  },
];

// ---------------------------------------------------------------------------

function paint<V extends StatueView>(view: V, parts: PartSource<V>[]): PaintedPart[] {
  const muscleOf = STATUE_REGIONS[view] as Record<string, string>;

  return parts.map(({ bone = 'body', half, whole }) => {
    const same = pose(view, bone);
    const mirrored: Point = (x, y) => same(120 - x, y);
    const both = (d: string) => `${transform(d, same, false)} ${transform(d, mirrored, true)}`;
    const part = Object.fromEntries(
      LAYERS.map((layer) => [
        layer,
        [
          ...(half[layer] ?? []).map(both),
          ...(whole?.[layer] ?? []).map((d) => transform(d, same, false)),
        ],
      ]),
    ) as Record<Layer, string[]>;

    const muscles: PaintedMuscle[] = [];
    for (const [region, d] of half.regions ?? []) {
      const muscle = muscleOf[region];
      let entry = muscles.find((m) => m.muscle === muscle);
      if (!entry) muscles.push((entry = { muscle, regions: [] }));
      entry.regions.push({ region, d: both(d) });
    }
    return { ...part, muscles };
  });
}

/** Each view's parts, back to front, each with its tappable muscle groups. */
export const STATUE_ART: Record<StatueView, PaintedPart[]> = {
  front: paint('front', FRONT),
  back: paint('back', BACK),
};
