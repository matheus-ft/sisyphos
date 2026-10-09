// Draws a labelled grid over an image, to read coordinates off it: node grid.mjs <in.png> <out.png> [step]
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const [, , input, output, stepArg] = process.argv;
const step = Number(stepArg ?? 50);
const data = readFileSync(input).toString('base64');
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.setContent(`<body style="margin:0;background:#222">
<div style="position:relative;display:inline-block"><img id="i" src="data:image/png;base64,${data}">
<svg id="g" style="position:absolute;inset:0" width="100%" height="100%"></svg></div></body>`);
await page.waitForFunction(() => document.getElementById('i').complete);
await page.evaluate((step) => {
  const img = document.getElementById('i');
  const svg = document.getElementById('g');
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  let out = '';
  for (let x = 0; x <= w; x += step)
    out += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="${x % (step * 2) ? '#0ff8' : '#f0f'}" stroke-width="1"/><text x="${x + 2}" y="12" fill="#ff0" font-size="11">${x}</text>`;
  for (let y = 0; y <= h; y += step)
    out += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${y % (step * 2) ? '#0ff8' : '#f0f'}" stroke-width="1"/><text x="2" y="${y - 2}" fill="#ff0" font-size="11">${y}</text>`;
  svg.innerHTML = out;
}, step);
await page.setViewportSize({ width: 800, height: 1500 });
await page.locator('div').screenshot({ path: output });
await browser.close();
