import type { Exercise, Id, IsoDate, Session } from '../model';
import { finishStats, type FinishStats, type TopSet } from './finish';
import { longDate, programLabel } from './format';
import {
  RIDGE_PATH,
  STANDING_HEAD,
  STANDING_PATH,
  STONE_INCISIONS,
  STONE_PATH,
  gloryStrokes,
  poseAt,
} from './hill';

/**
 * The finish, as the screen and the share card both say it. `summarise` is the
 * one place that decides what the session reports; `cardMetrics` and
 * `renderShareCard` put it on a 1080 x 1350 canvas, in the colours the page
 * wears, so the card matches the phone's mode (clay by day, glaze by night).
 */

// --- what the session reports ------------------------------------------------------

export interface TopRow {
  exercise_id: string;
  name: string;
  /** "142.5 × 5": the set without its RPE, which is set apart in the accent. */
  figures: string;
  /** "8.5" or null. */
  rpe: string | null;
  record: boolean;
}

export interface Stat {
  /** What the figure is under, said to agree with it: "1 SET", "2 RECORDS". */
  label: 'MIN' | 'SET' | 'SETS' | 'KG' | 'RECORD' | 'RECORDS';
  value: string;
  /** The record column carries the laurel. */
  laurel: boolean;
}

export interface Summary {
  stats: Stat[];
  /** One per exercise, in the order the session first had it. */
  rows: TopRow[];
}

/** 8450 as "8,450", whatever the phone's locale. */
export function groupThousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** A top set's text split at its RPE: "142.5 × 5 @ 8.5" into "142.5 × 5" and "8.5". */
export function splitRpe(text: string): { figures: string; rpe: string | null } {
  const at = text.lastIndexOf(' @ ');
  return at < 0
    ? { figures: text, rpe: null }
    : { figures: text.slice(0, at), rpe: text.slice(at + 3) };
}

export function summarise(
  session: Session,
  library: readonly Exercise[],
  recordSetIds: ReadonlySet<Id>,
  now: Date = new Date(),
): Summary {
  const stats: FinishStats = finishStats(session, {
    exercise: (id) => library.find((e) => e.id === id),
    now,
    isRecord: (_instance, set) => recordSetIds.has(set.id),
  });
  const columns: Stat[] = [];
  if (stats.durationMin !== null)
    columns.push({ label: 'MIN', value: String(stats.durationMin), laurel: false });
  columns.push({
    label: stats.sets === 1 ? 'SET' : 'SETS',
    value: String(stats.sets),
    laurel: false,
  });
  // A session of pins and holds moves no kilograms, and a zero would be a claim.
  if (stats.tonnageKg > 0)
    columns.push({ label: 'KG', value: groupThousands(stats.tonnageKg), laurel: false });
  if (stats.records > 0)
    columns.push({
      label: stats.records === 1 ? 'RECORD' : 'RECORDS',
      value: String(stats.records),
      laurel: true,
    });
  return {
    stats: columns,
    rows: stats.topSets.map((t: TopSet) => ({
      exercise_id: t.exercise_id,
      name: t.name,
      ...splitRpe(t.text),
      record: recordSetIds.has(t.set.id),
    })),
  };
}

/** The name a template saved from this session starts with: its programme, else the day. */
export function defaultTemplateName(session: Session): string {
  const { name } = session.label;
  return name?.trim() || programLabel(session.label) || longDate(session.date);
}

// --- the card's words --------------------------------------------------------------

export const CARD_W = 1080;
export const CARD_H = 1350;
export const CARD_TOP_SETS = 4;

export interface CardContent {
  /** "SUNDAY 4 OCTOBER 2026" */
  date: string;
  /** "Rebuild · week 3 · day 1", or null. */
  label: string | null;
  title: [string, string];
  stats: Stat[];
  rows: TopRow[];
  footer: string;
}

/**
 * Up to four top sets: the records win a place when there are more exercises
 * than room, and the card keeps the session's own order.
 */
export function cardRows(rows: readonly TopRow[]): TopRow[] {
  if (rows.length <= CARD_TOP_SETS) return [...rows];
  const keep = new Set(
    rows
      .map((row, i) => ({ row, i }))
      .sort((a, b) => Number(b.row.record) - Number(a.row.record) || a.i - b.i)
      .slice(0, CARD_TOP_SETS)
      .map((x) => x.i),
  );
  return rows.filter((_, i) => keep.has(i));
}

export function cardContent(session: Session, summary: Summary): CardContent {
  return {
    date: `${longDate(session.date)} ${session.date.slice(0, 4)}`.toUpperCase(),
    label: programLabel(session.label),
    title: ['THE BOULDER', 'IS AT THE TOP.'],
    stats: summary.stats,
    rows: cardRows(summary.rows),
    footer: 'SISYPHOS',
  };
}

/** `sisyphos-2026-10-04.png`. */
export function shareFileName(date: IsoDate): string {
  return `sisyphos-${date}.png`;
}

// --- where it goes -----------------------------------------------------------------

/** Card px. The spec's measures, with the vertical rhythm worked out once. */
const PAD_X = 80;
const PAD_TOP = 64;
const PAD_BOTTOM = 56;
const BAND_UNIT = 6;
const BAND_H = BAND_UNIT * 7;
const SCENE_W = 920;
/** Header-drawing units to card px: the hill's two slopes fill the scene's width at this size. */
const SCENE_SCALE = 4.4;
/** Where the ridge tops out; the hill is mirrored about it so the summit sits mid-card. */
const SUMMIT_X = 186;
const ROW_H = 68;

export interface CardMetrics {
  bandTop: number;
  dateBase: number;
  labelBase: number | null;
  sceneTop: number;
  /** Header-drawing units to card px. */
  sceneScale: number;
  titleBase: [number, number];
  statFigureBase: number;
  statLabelBase: number;
  rowsTop: number;
  rowHeight: number;
  footBandTop: number;
  footerBase: number;
}

/** Cap heights as a share of the em, for placing baselines. */
const CINZEL_CAP = 0.7;
const GARAMOND_FIG = 0.66;

/** The space between the top band and the date: the least a body stands off either band. */
const BODY_GAP = 44;

/**
 * Where everything goes. A card of fewer than the four top sets it has room
 * for sits its body midway between the two bands, rather than leaving the
 * whole of the spare room as a hole above the foot.
 */
export function cardMetrics(hasLabel: boolean, rows: number = CARD_TOP_SETS): CardMetrics {
  const bandTop = PAD_TOP;
  const top = bandTop + BAND_H + BODY_GAP;
  const placed = bodyMetrics(top, hasLabel);
  const footerBase = CARD_H - PAD_BOTTOM;
  const footBandTop = footerBase - Math.round(28 * CINZEL_CAP) - 22 - BAND_H;
  const bodyBottom = rows > 0 ? placed.rowsTop + rows * ROW_H - 6 : placed.statLabelBase;
  const shift = Math.max(0, Math.round((footBandTop - bodyBottom - BODY_GAP) / 2));
  return {
    bandTop,
    ...(shift > 0 ? bodyMetrics(top + shift, hasLabel) : placed),
    sceneScale: SCENE_SCALE,
    rowHeight: ROW_H,
    footBandTop,
    footerBase,
  };
}

/** The body's baselines from the top of its first line, the date. */
function bodyMetrics(top: number, hasLabel: boolean) {
  const dateBase = top + Math.round(40 * CINZEL_CAP);
  const labelBase = hasLabel ? dateBase + 10 + 36 : null;
  const sceneTop = (labelBase ?? dateBase) + 26;
  const sceneBottom = sceneTop + Math.round(72 * SCENE_SCALE);
  const title1 = sceneBottom + 40 + Math.round(58 * CINZEL_CAP);
  const title2 = title1 + 70;
  const statFigureBase = title2 + 52 + Math.round(104 * GARAMOND_FIG);
  const statLabelBase = statFigureBase + 14 + Math.round(26 * CINZEL_CAP);
  const rowsTop = statLabelBase + 46;
  return {
    dateBase,
    labelBase,
    sceneTop,
    titleBase: [title1, title2] as [number, number],
    statFigureBase,
    statLabelBase,
    rowsTop,
  };
}

/** Whether `rows` rows fit between the stats and the foot: the card never overflows. */
export function rowsFit(hasLabel: boolean, rows: number): boolean {
  const m = cardMetrics(hasLabel);
  return m.rowsTop + rows * m.rowHeight <= m.footBandTop - 20;
}

// --- the colours the page wears ----------------------------------------------------

export interface CardTheme {
  ground: string;
  sheen: string;
  ink: string;
  ink2: string;
  muted: string;
  line: string;
  figure: string;
  accent: string;
  laurelFill: string;
}

const THEME_TOKENS: Record<keyof CardTheme, string> = {
  ground: '--ground',
  sheen: '--sheen',
  ink: '--ink',
  ink2: '--ink-2',
  muted: '--muted',
  line: '--line',
  figure: '--figure',
  accent: '--accent',
  laurelFill: '--laurel-fill',
};

/** The tokens as the page resolves them now, so the card follows light and dark. */
export function readTheme(get: (token: string) => string): CardTheme {
  const out = {} as CardTheme;
  for (const [key, token] of Object.entries(THEME_TOKENS) as [keyof CardTheme, string][])
    out[key] = get(token).trim();
  return out;
}

/** `colour` with its alpha replaced: canvas gradients blend towards transparent black otherwise. */
export function withAlpha(colour: string, alpha: number): string | null {
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(colour);
  if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour);
  if (!hex) return null;
  const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// --- sharing -----------------------------------------------------------------------

export type ShareOutcome = 'shared' | 'cancelled' | 'unsupported';

interface Sharer {
  canShare?: (data: { files: File[] }) => boolean;
  share?: (data: { files: File[]; title: string }) => Promise<void>;
}

/**
 * The share sheet with the image, where the browser has one for files. It must
 * run inside the tap that asked for it, so the caller renders the blob first.
 * "unsupported" means show the image to press and hold instead.
 */
export async function shareImage(
  blob: Blob,
  fileName: string,
  title: string,
  nav: Sharer = navigator,
): Promise<ShareOutcome> {
  if (typeof File === 'undefined') return 'unsupported';
  const file = new File([blob], fileName, { type: 'image/png' });
  if (!nav.share || !nav.canShare?.({ files: [file] })) return 'unsupported';
  try {
    await nav.share({ files: [file], title });
    return 'shared';
  } catch (error) {
    return error instanceof DOMException && error.name === 'AbortError'
      ? 'cancelled'
      : 'unsupported';
  }
}

// --- drawing -----------------------------------------------------------------------

/** The Greek-key tile (an 8 x 7 grid), the same path as the page's mask. */
const KEY_PATH = 'M0 0h1v7H0zM1 0h6v1H1zM6 1h1v6H6zM7 6h1v1H7zM2 4h4v1H2zM2 2h1v2H2zM3 2h2v1H3z';

/** The laurel's leaves (x, y, degrees), as `kit/Laurel.svelte` draws them in a 16 box. */
const LAUREL_LEAVES: [number, number, number][] = [
  [4.4, 12.6, -100],
  [6.4, 10.6, -5],
  [8.2, 8.2, -100],
  [10, 5.8, -5],
  [11.2, 3.6, -52],
];

type Align = 'left' | 'center' | 'right';

/** Letter-spaced text, drawn glyph by glyph: canvas `letterSpacing` is missing on older iOS. */
function spaced(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
  align: Align,
): number {
  const widths = [...text].map((c) => ctx.measureText(c).width + tracking);
  const total = widths.reduce((a, b) => a + b, 0) - tracking;
  let at = align === 'left' ? x : align === 'center' ? x - total / 2 : x - total;
  ctx.textAlign = 'left';
  [...text].forEach((c, i) => {
    ctx.fillText(c, at, y);
    at += widths[i];
  });
  return total;
}

function band(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, w: number): void {
  const tile = new Path2D(KEY_PATH);
  const unit = BAND_UNIT;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, BAND_H);
  ctx.clip();
  ctx.fillStyle = color;
  // Centred like the page's mask, so the ends are cut evenly.
  const first = x + ((w % (8 * unit)) / 2 - 8 * unit);
  for (let tx = first; tx < x + w; tx += 8 * unit) {
    ctx.setTransform(unit, 0, 0, unit, tx, y);
    ctx.fill(tile);
  }
  ctx.restore();
}

function drawLaurel(
  ctx: CanvasRenderingContext2D,
  color: string,
  x: number,
  y: number,
  size: number,
): void {
  const k = size / 16;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  ctx.stroke(new Path2D('M2.5 14.5C6 11.5 9 7.5 11.6 3.4'));
  const leaf = new Path2D('M0 0C1.4-1.5 3.4-1.5 4.8 0C3.4 1.5 1.4 1.5 0 0Z');
  for (const [lx, ly, deg] of LAUREL_LEAVES) {
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.fill(leaf);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * The hill with its strata, Sisyphos standing and the stone at the summit, from
 * hill.ts. The header drawing climbs to a cliff; a card wants a mound, so the
 * ridge is mirrored about its summit and the two slopes cropped to the scene.
 */
function drawScene(
  ctx: CanvasRenderingContext2D,
  t: CardTheme,
  cx: number,
  y: number,
  k: number,
): void {
  const px = 2.4 / k; // a 2.4px line on the card, in header units
  const half = SCENE_W / 2 / k;
  ctx.save();
  ctx.translate(cx, y);
  ctx.scale(k, k);
  ctx.translate(-SUMMIT_X, 0);
  ctx.beginPath();
  ctx.rect(SUMMIT_X - half, -20, half * 2, 92);
  ctx.clip();

  const slope = new Path2D(`M0,72 L0,67 L${RIDGE_PATH.slice(1)} L${SUMMIT_X},72 Z`);
  const ridge = new Path2D(RIDGE_PATH);
  const strata: [number, number[]][] = [
    [7, []],
    [14, [5 * px, 4 * px]],
    [21, [1.5 * px, 4 * px]],
  ];
  for (const mirrored of [false, true]) {
    ctx.save();
    if (mirrored) {
      ctx.translate(SUMMIT_X * 2, 0);
      ctx.scale(-1, 1);
    }
    ctx.fillStyle = t.figure;
    ctx.fill(slope);
    ctx.save();
    ctx.clip(slope);
    ctx.strokeStyle = t.ground;
    ctx.lineWidth = px;
    ctx.lineCap = 'round';
    for (const [down, dash] of strata) {
      ctx.save();
      ctx.translate(0, down);
      ctx.setLineDash(dash);
      ctx.stroke(ridge);
      ctx.restore();
    }
    ctx.restore();
    ctx.restore();
  }

  const pose = poseAt(1);
  ctx.translate(pose.x, pose.y);
  ctx.strokeStyle = t.figure;
  ctx.fillStyle = t.figure;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(new Path2D(STANDING_PATH));
  ctx.beginPath();
  ctx.arc(STANDING_HEAD.cx, STANDING_HEAD.cy, STANDING_HEAD.r, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.rotate((pose.roll * Math.PI) / 180);
  ctx.scale(7, 7);
  ctx.fill(new Path2D(STONE_PATH));
  ctx.lineJoin = 'round';
  ctx.lineWidth = 0.06;
  ctx.stroke(new Path2D(STONE_PATH));
  ctx.strokeStyle = t.ground;
  ctx.lineWidth = px / 7;
  for (const d of STONE_INCISIONS) ctx.stroke(new Path2D(d));
  ctx.restore();

  ctx.strokeStyle = t.accent;
  ctx.lineWidth = px * 0.9;
  for (const d of gloryStrokes()) ctx.stroke(new Path2D(d));
  ctx.restore();
}

function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > width) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

/** Waits for the faces the card is set in, so the canvas never draws in a fallback. */
async function loadFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  await Promise.all([
    document.fonts.load('700 40px Cinzel'),
    document.fonts.load('600 28px Cinzel'),
    document.fonts.load('600 104px "EB Garamond"'),
    document.fonts.load('500 42px "EB Garamond"'),
    document.fonts.load('400 42px "EB Garamond"'),
    document.fonts.load('italic 400 36px "EB Garamond"'),
  ]);
}

const DISPLAY = 'Cinzel, "Trajan Pro", Optima, Georgia, serif';
const TEXT = '"EB Garamond", "Iowan Old Style", Palatino, Georgia, serif';

/** Draws the card onto `canvas` (1080 x 1350). */
export function drawShareCard(canvas: HTMLCanvasElement, content: CardContent, t: CardTheme): void {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas to draw the card on');
  const m = cardMetrics(content.label !== null, content.rows.length);
  const innerW = CARD_W - PAD_X * 2;
  const centre = CARD_W / 2;

  ctx.fillStyle = t.ground;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const clear = withAlpha(t.sheen, 0);
  if (clear) {
    ctx.save();
    ctx.translate(CARD_W * 0.18, 0);
    ctx.scale(CARD_W * 1.2, CARD_H * 0.55);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    glow.addColorStop(0, t.sheen);
    glow.addColorStop(0.6, clear);
    ctx.fillStyle = glow;
    ctx.fillRect(-1, 0, 2, 1);
    ctx.restore();
  }

  band(ctx, t.figure, PAD_X, m.bandTop, innerW);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = t.ink;
  ctx.font = `700 40px ${DISPLAY}`;
  spaced(ctx, content.date, centre, m.dateBase, 40 * 0.14, 'center');
  if (content.label && m.labelBase !== null) {
    ctx.fillStyle = t.ink2;
    ctx.font = `italic 400 36px ${TEXT}`;
    ctx.textAlign = 'center';
    ctx.fillText(fit(ctx, content.label, innerW), centre, m.labelBase);
  }

  drawScene(ctx, t, centre, m.sceneTop, m.sceneScale);

  ctx.fillStyle = t.ink;
  ctx.font = `700 58px ${DISPLAY}`;
  content.title.forEach((line, i) =>
    spaced(ctx, line, centre, m.titleBase[i], 58 * 0.12, 'center'),
  );

  // Stats: the columns sit 64 apart as one group, centred.
  const figureFont = `600 104px ${TEXT}`;
  const labelFont = `600 26px ${DISPLAY}`;
  const columns = content.stats.map((s) => {
    ctx.font = figureFont;
    const fig = ctx.measureText(s.value).width;
    const lead = s.laurel ? 40 + 12 : 0;
    ctx.font = labelFont;
    const label = [...s.label].reduce(
      (w, c) => w + ctx.measureText(c).width + 26 * 0.18,
      -26 * 0.18,
    );
    return { s, lead, fig, width: Math.max(lead + fig, label) };
  });
  const gap = 64;
  const group = columns.reduce((w, c) => w + c.width, 0) + gap * (columns.length - 1);
  let cx = centre - group / 2;
  for (const c of columns) {
    const mid = cx + c.width / 2;
    ctx.font = figureFont;
    ctx.fillStyle = t.ink;
    ctx.textAlign = 'left';
    const start = mid - (c.lead + c.fig) / 2;
    ctx.fillText(c.s.value, start + c.lead, m.statFigureBase);
    if (c.s.laurel) drawLaurel(ctx, t.laurelFill, start, m.statFigureBase - 62, 40);
    ctx.font = labelFont;
    ctx.fillStyle = t.muted;
    spaced(ctx, c.s.label, mid, m.statLabelBase, 26 * 0.18, 'center');
    cx += c.width + gap;
  }

  // Top sets, each on a dotted leader, with a rule under it.
  content.rows.forEach((row, i) => {
    const base = m.rowsTop + i * m.rowHeight + 44;
    const right = PAD_X + innerW;
    ctx.font = `600 44px ${TEXT}`;
    const rpeText = row.rpe ? ` @ ${row.rpe}` : '';
    const figW =
      ctx.measureText(row.figures).width + (rpeText ? ctx.measureText(rpeText).width : 0);
    const laurelW = row.record ? 40 + 12 : 0;
    ctx.textAlign = 'left';
    const figStart = right - figW;
    ctx.fillStyle = t.ink;
    ctx.fillText(row.figures, figStart, base);
    if (rpeText) {
      ctx.fillStyle = t.accent;
      ctx.fillText(rpeText, figStart + ctx.measureText(row.figures).width, base);
    }
    if (row.record) drawLaurel(ctx, t.laurelFill, figStart - laurelW, base - 36, 40);

    ctx.font = `500 42px ${TEXT}`;
    const nameRoom = innerW - figW - laurelW - 72;
    const name = fit(ctx, row.name, nameRoom);
    ctx.fillStyle = t.ink;
    ctx.fillText(name, PAD_X, base);
    const dotsFrom = PAD_X + ctx.measureText(name).width + 18;
    const dotsTo = figStart - laurelW - 18;
    if (dotsTo > dotsFrom) {
      ctx.fillStyle = t.muted;
      for (let dx = dotsFrom; dx < dotsTo; dx += 12) ctx.fillRect(dx, base - 4, 4, 4);
    }
    if (i < content.rows.length - 1) {
      ctx.fillStyle = t.line;
      ctx.fillRect(PAD_X, m.rowsTop + (i + 1) * m.rowHeight - 6, innerW, 2);
    }
  });

  band(ctx, t.figure, PAD_X, m.footBandTop, innerW);
  ctx.fillStyle = t.ink2;
  ctx.font = `600 28px ${DISPLAY}`;
  spaced(ctx, content.footer, centre, m.footerBase, 28 * 0.3, 'center');
}

/** The card as a PNG, drawn in the colours the page wears at this moment. */
export async function renderShareCard(content: CardContent): Promise<Blob> {
  await loadFonts();
  const style = getComputedStyle(document.documentElement);
  const canvas = document.createElement('canvas');
  drawShareCard(
    canvas,
    content,
    readTheme((token) => style.getPropertyValue(token)),
  );
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The card did not draw'))),
      'image/png',
    ),
  );
}
