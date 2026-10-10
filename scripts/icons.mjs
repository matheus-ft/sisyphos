// Renders the app icons (public/icon-192.png, icon-512.png, apple-touch-icon.png)
// from public/favicon.svg, which is the source of truth. Run: node scripts/icons.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const pub = fileURLToPath(new URL('../public/', import.meta.url));
const svg = readFileSync(pub + 'favicon.svg', 'utf8');
const outputs = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
];

/** Undefined for the bundled Chromium; else the newest /opt/pw-browsers/chromium-* build. */
function executablePath() {
  if (existsSync(chromium.executablePath())) return undefined;
  const root = '/opt/pw-browsers';
  const dirs = existsSync(root) ? readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)) : [];
  const dir = dirs.sort().pop();
  if (!dir) throw new Error('No Chromium found: run `npx playwright install chromium`.');
  return `${root}/${dir}/chrome-linux/chrome`;
}

const browser = await chromium.launch({ executablePath: executablePath() });
try {
  for (const [name, size] of outputs) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<style>html,body{margin:0;background:#15100c}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    writeFileSync(pub + name, await page.screenshot({ type: 'png' }));
    await page.close();
    console.log(`public/${name} ${size}x${size}`);
  }
} finally {
  await browser.close();
}
