// Photographs the statue workbench (tools/statue/): each panel as a PNG, large
// enough to judge a drawing by, into statue-shots/ (ignored by git).
//
//   npm run statue:shots            every panel, 360 px wide at 3x
//   npm run statue:shots -- 600     every panel, 600 px wide
//
// It starts its own Vite dev server and drives the installed Chrome, as the
// e2e tests do locally.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { createServer } from 'vite';

const width = Number(process.argv[2] ?? 360);
const out = 'statue-shots';
mkdirSync(out, { recursive: true });

const server = await createServer({ server: { port: 4174, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ deviceScaleFactor: 3, colorScheme: scheme });
    await page.setViewportSize({ width: width * 3 + 120, height: 1200 });
    await page.goto(`http://localhost:4174/tools/statue/?width=${width}`);
    await page.locator('[data-panel] svg').first().waitFor();
    await page.waitForTimeout(800);
    for (const panel of await page.locator('[data-panel]').all()) {
      const name = await panel.getAttribute('data-panel');
      const path = `${out}/${name}-${scheme}.png`;
      await panel.screenshot({ path });
      console.log(path);
    }
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
