/**
 * Motion for what CSS cannot animate itself (a tween along the hill, Svelte
 * transitions), taken from the same tokens so the timing has one home. Under
 * prefers-reduced-motion the tokens go to 0, and so does everything here.
 */

/** A duration token (`--dur-base`) in milliseconds, as the page currently resolves it. */
export function durationOf(token: `--${string}`, fallback = 0): number {
  if (typeof document === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return parseDuration(raw) ?? fallback;
}

/** `240ms` or `1.8s` in milliseconds; null for anything else. */
export function parseDuration(raw: string): number | null {
  const match = /^(-?[\d.]+)(ms|s)$/.exec(raw.trim());
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, match[2] === 's' ? n * 1000 : n);
}

/**
 * The easing of a CSS `cubic-bezier(x1, y1, x2, y2)`, for tweens that must
 * move like the CSS around them (`--ease-roll` is 0.33, 0, 0.15, 1).
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const bez = (a: number, b: number, t: number) =>
    3 * a * (1 - t) * (1 - t) * t + 3 * b * (1 - t) * t * t + t * t * t;
  const slope = (a: number, b: number, t: number) =>
    3 * a * (1 - t) * (1 - t) + 6 * (b - a) * (1 - t) * t + 3 * (1 - b) * t * t;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    // Newton's method on x(t) = x, falling back to bisection where the slope is flat.
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = bez(x1, x2, t) - x;
      if (Math.abs(err) < 1e-6) return bez(y1, y2, t);
      const d = slope(x1, x2, t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let [lo, hi] = [0, 1];
    t = x;
    for (let i = 0; i < 30; i++) {
      const v = bez(x1, x2, t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return bez(y1, y2, t);
  };
}

/** `--ease-roll`: the stone rolling one set further. */
export const easeRoll = cubicBezier(0.33, 0, 0.15, 1);
/** `--ease-out`: sheets and panels arriving. */
export const easeOut = cubicBezier(0.2, 0.8, 0.2, 1);
