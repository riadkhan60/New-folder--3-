// Rasterises the kit: reads scripts/raster-manifest.json (written by build.py)
// and exports every PNG and vector PDF with headless Chromium (Playwright).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'raster-manifest.json'), 'utf8'));
const dataUri = (rel) =>
  'data:image/svg+xml;base64,' + fs.readFileSync(path.join(ROOT, rel)).toString('base64');
const ensureDir = (file) => fs.mkdirSync(path.dirname(file), { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });

  for (const job of manifest.png) {
    await page.setViewportSize({ width: job.w, height: job.h });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">` +
        `<img src="${dataUri(job.svg)}" width="${job.w}" height="${job.h}" style="display:block"></body></html>`
    );
    await page.waitForFunction(() => document.images[0].complete);
    const out = path.join(ROOT, job.png);
    ensureDir(out);
    await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: job.w, height: job.h } });
  }

  for (const job of manifest.pdf) {
    const svg = fs.readFileSync(path.join(ROOT, job.svg), 'utf8');
    const [, w, h] = svg.match(/width="([\d.]+)" height="([\d.]+)"/);
    await page.setContent(
      `<html><head><style>@page{size:${w}px ${h}px;margin:0}html,body{margin:0}</style></head>` +
        `<body>${svg.replace(/<svg /, '<svg style="display:block" ')}</body></html>`
    );
    const out = path.join(ROOT, job.pdf);
    ensureDir(out);
    await page.pdf({ path: out, width: `${w}px`, height: `${h}px`, printBackground: true, pageRanges: '1' });
  }

  await browser.close();
  console.log(`rendered ${manifest.png.length} PNG, ${manifest.pdf.length} PDF`);
})();
