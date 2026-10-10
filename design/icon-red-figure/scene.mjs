// Draft 2 scene, design space 512 (before the global fit transform).
const CLAY = '#f0cfa4';
const GLAZE = '#15100c';
const TERRA = '#ee8a52';
const DILUTE = '#9a5a35'; // dilute glaze, for hair and beard
const K = 0.488; // tan 26°
const Y0 = 470; // ground y at x = 0
const _groundY = (x) => Y0 - K * x;
const ANG = 26;

export function build({ chain, circ, smooth, pt }) {
  // ---- boulder ----
  const R = 78;
  const cx = 410;
  const cy = Y0 - K * (cx + 0.438 * R) - 0.899 * R + 13;
  const wob = [1.0, 1.04, 0.97, 1.02, 0.95, 1.03, 0.98, 1.05, 0.96, 1.01];
  const bpts = wob.map((w, i) => {
    const a = (i / wob.length) * Math.PI * 2 - 0.3;
    return [cx + Math.cos(a) * R * w, cy + Math.sin(a) * R * w];
  });
  const boulder = smooth(bpts, 1);
  const rim = (deg, k = 1) => {
    const a = (deg * Math.PI) / 180;
    return [cx + Math.cos(a) * R * k, cy + Math.sin(a) * R * k];
  };
  const add = (p, dx, dy) => [p[0] + dx, p[1] + dy];
  const c0 = rim(-40, 1.02);
  const crack1 = `M${pt(c0)}L${pt(add(c0, -14, 16))}L${pt(add(c0, -11, 33))}L${pt(add(c0, -27, 52))}M${pt(add(c0, -11, 33))}L${pt(add(c0, 6, 44))}`;
  const c1 = rim(58, 1.0);
  const crack2 = `M${pt(c1)}L${pt(add(c1, -12, -12))}L${pt(add(c1, -13, -27))}`;

  // ---- figure ----
  const HX = 270,
    HY = 170,
    HS = 1.12; // head centre and scale
  const h = ([x, y]) => [HX + x * HS, HY + y * HS];
  const head = [
    [-20, -7],
    [-7, -22],
    [13, -21],
    [21, -11], // skull, forehead
    [28, 0],
    [22, 3],
    [24, 9], // nose, lips
    [27, 20],
    [20, 35],
    [6, 29],
    [-2, 28], // beard, throat
  ].map(h);
  const torsoHead = smooth([
    [154, 306],
    [140, 285],
    [145, 264],
    [161, 245],
    [183, 221],
    [208, 193],
    [236, 176],
    ...head,
    [276, 220],
    [284, 238],
    [264, 256],
    [244, 272],
    [214, 294],
    [184, 310],
  ]);
  const backLeg = chain(
    [168, 290, 26],
    [145, 316, 21],
    [122, 340, 15],
    [104, 360, 18],
    [88, 386, 10],
    [80, 398, 8],
  );
  const backFoot = chain([72, 402, 8], [80, 398, 9], [100, 414, 7], [118, 407, 4.5]);
  const frontLeg = chain(
    [192, 288, 23],
    [230, 284, 21],
    [268, 284, 15],
    [250, 304, 17],
    [242, 326, 11],
    [236, 342, 8],
  );
  const frontFoot = chain([228, 352, 7], [236, 342, 9], [256, 341, 6], [272, 332, 4.5]);

  const farArm = chain([250, 196, 15], [288, 186, 12], [318, 166, 8]);
  const farHand = circ([326, 162, 10]);
  const nearArm = chain([255, 212, 19], [294, 238, 13], [322, 216, 9]);
  const nearHand = circ([331, 211, 11]);
  const body = [torsoHead, backLeg, backFoot, frontLeg, frontFoot, nearArm, nearHand];
  const poly = (ps) => 'M' + ps.map((p) => pt(h(p))).join('L') + 'Z';
  const hair = poly([
    [18, -30],
    [14, -19],
    [5, -12],
    [-3, -5],
    [-6, 4],
    [-12, 12],
    [-34, 14],
    [-34, -34],
  ]);
  const beard = poly([
    [-6, 0],
    [6, 5],
    [16, 5],
    [40, 4],
    [40, 50],
    [20, 37],
    [6, 31],
    [-4, 27],
    [-8, 14],
  ]);
  const armLine = 'M246,228Q266,242 286,247';
  const _ribs = 'M226,232Q236,252 258,260';

  // glaze anatomy lines
  const P = (x, y) => pt(h([x, y]));
  const eye = `M${P(7, -9)}q6,-4 11,1q-6,3 -11,-1Z`;
  const hairline = '';
  const beardLines = `M${P(4, 12)}Q${P(10, 22)} ${P(16, 30)}`;
  const shoulder = `M236,200Q260,192 270,222`;
  const knee = `M266,272q10,4 10,16`;
  const backKnee = `M116,332q4,10 14,12`;
  const glute = `M226,270Q206,282 200,300`;
  // ---- meander band, drawn in the ground's frame ----
  const u = 4.5;
  const key = 'M0 0h1v7H0zM1 0h6v1H1zM6 1h1v6H6zM7 6h1v1H7zM2 4h4v1H2zM2 2h1v2H2zM3 2h2v1H3z';

  const fit = 'translate(-6 2) scale(0.95)';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <!-- Sisyphos pushing the stone, as a red-figure vase painting. Source of the PNG icons:
       node scripts/icons.mjs. Figure and stone keep to the central 80% (iOS masks corners). -->
  <defs>
    <radialGradient id="glaze" cx="50%" cy="42%" r="70%">
      <stop offset="0" stop-color="#1e140f"/>
      <stop offset="1" stop-color="#15100c"/>
    </radialGradient>
    <radialGradient id="stone" cx="40%" cy="35%" r="70%">
      <stop offset="0" stop-color="#ecc597"/>
      <stop offset="1" stop-color="#d49c6c"/>
    </radialGradient>
    <pattern id="key" width="${8 * u}" height="${7 * u}" patternUnits="userSpaceOnUse">
      <path transform="scale(${u})" fill="${TERRA}" d="${key}"/>
    </pattern>
    <g id="body">${body.map((d, i) => `\n      <path${i === 0 ? ' id="torso"' : ''} d="${d}"/>`).join('')}
    </g>
    <g id="far"><path d="${farArm}"/><path d="${farHand}"/></g>
    <clipPath id="headclip"><use href="#torso"/></clipPath>
  </defs>
  <rect width="512" height="512" fill="url(#glaze)"/>
  <g transform="${fit}">
    <!-- The ground, rising at ${ANG}°, with a Greek-key band beneath it as on a pot. -->
    <g transform="translate(0 ${Y0}) rotate(-${ANG})">
      <path d="M-400,0H1000" stroke="${TERRA}" stroke-width="6"/>
      <rect x="-400" y="14" width="1400" height="${7 * u}" fill="url(#key)"/>
      <path d="M-400,${14 + 7 * u + 7}H1000" stroke="${TERRA}" stroke-width="2.5"/>
    </g>
    <!-- The stone, washed in dilute glaze, with two cracks. -->
    <path d="${boulder}" fill="url(#stone)" stroke="${GLAZE}" stroke-width="5"/>
    <path d="${crack1}${crack2}" fill="none" stroke="${GLAZE}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
    <!-- Sisyphos in reserved clay: far arm, then body; each outlined in glaze. -->
    <use href="#far" fill="${CLAY}" stroke="${GLAZE}" stroke-width="8"/>
    <use href="#far" fill="${CLAY}"/>
    <use href="#body" fill="${CLAY}" stroke="${GLAZE}" stroke-width="8"/>
    <use href="#body" fill="${CLAY}"/>
    <!-- Hair and beard in dilute glaze; anatomy in black glaze. -->
    <g clip-path="url(#headclip)" fill="${DILUTE}"><path d="${hair}"/><path d="${beard}"/></g>
    <g fill="none" stroke="${GLAZE}" stroke-width="4" stroke-linecap="round">
      <path d="${hairline}${beardLines}${shoulder}${armLine}${knee}${backKnee}${glute}"/>
    </g>
    <path d="${eye}" fill="${GLAZE}"/>${process.env.DEBUG ? grid() : ''}
  </g>
</svg>
`;
}

function grid() {
  let g = '<g stroke="#4af" stroke-width="0.5" opacity="0.6">';
  for (let v = 0; v <= 512; v += 20) {
    g += `<path d="M${v},0V512M0,${v}H512" stroke-width="${v % 100 === 0 ? 1.5 : 0.5}"/>`;
  }
  g += '</g><g font-size="8" fill="#4af">';
  for (let v = 0; v <= 512; v += 40)
    g += `<text x="${v + 1}" y="9">${v}</text><text x="1" y="${v + 9}">${v}</text>`;
  return g + '</g>';
}
