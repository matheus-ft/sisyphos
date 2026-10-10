// Generates public/favicon.svg for draft 2. Usage: node gen.mjs <out.svg>
import { writeFileSync } from 'node:fs';

const r = (n) => Math.round(n * 10) / 10;
const pt = (p) => `${r(p[0])},${r(p[1])}`;

/** Tapered capsule between circles a=[x,y,rad] and b=[x,y,rad]. */
function capsule(a, b) {
  const [ax, ay, ra] = a;
  const [bx, by, rb] = b;
  const d = Math.hypot(bx - ax, by - ay);
  const th = Math.atan2(by - ay, bx - ax);
  const ph = Math.acos(Math.max(-1, Math.min(1, (ra - rb) / d)));
  const u = (t) => [Math.cos(t), Math.sin(t)];
  const p1 = [ax + ra * u(th + ph)[0], ay + ra * u(th + ph)[1]];
  const p2 = [bx + rb * u(th + ph)[0], by + rb * u(th + ph)[1]];
  const p3 = [bx + rb * u(th - ph)[0], by + rb * u(th - ph)[1]];
  const p4 = [ax + ra * u(th - ph)[0], ay + ra * u(th - ph)[1]];
  const largeB = 2 * ph > Math.PI ? 1 : 0;
  const largeA = 2 * Math.PI - 2 * ph > Math.PI ? 1 : 0;
  return `M${pt(p1)}L${pt(p2)}A${r(rb)},${r(rb)} 0 ${largeB} 0 ${pt(p3)}L${pt(p4)}A${r(ra)},${r(ra)} 0 ${largeA} 0 ${pt(p1)}Z`;
}
const chain = (...cs) =>
  cs
    .slice(1)
    .map((c, i) => capsule(cs[i], c))
    .join('');
const circ = ([x, y, rad]) =>
  `M${r(x - rad)},${r(y)}a${r(rad)},${r(rad)} 0 1 0 ${r(2 * rad)},0a${r(rad)},${r(rad)} 0 1 0 ${r(-2 * rad)},0Z`;

/** Closed smooth path through points (Catmull-Rom → cubic Bézier). */
function smooth(ps, t = 1) {
  const n = ps.length;
  let d = `M${pt(ps[0])}`;
  for (let i = 0; i < n; i++) {
    const p0 = ps[(i - 1 + n) % n],
      p1 = ps[i],
      p2 = ps[(i + 1) % n],
      p3 = ps[(i + 2) % n];
    const c1 = [p1[0] + ((p2[0] - p0[0]) / 6) * t, p1[1] + ((p2[1] - p0[1]) / 6) * t];
    const c2 = [p2[0] - ((p3[0] - p1[0]) / 6) * t, p2[1] - ((p3[1] - p1[1]) / 6) * t];
    d += `C${pt(c1)} ${pt(c2)} ${pt(p2)}`;
  }
  return d + 'Z';
}

export { capsule, chain, circ, smooth, r, pt };

const out = process.argv[2];
if (out) {
  const { build } = await import('./scene.mjs?' + Date.now());
  writeFileSync(out, build({ capsule, chain, circ, smooth, r, pt }));
}
