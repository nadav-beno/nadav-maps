// iPhone app images, drawn from the same pin as the site's icon (apps/web/public/favicon.svg):
// - the App Store-size app icon (1024x1024, opaque: iOS rounds the corners itself)
// - the launch screen image (2732x2732, white, a small rounded icon in the middle)
// Run from the repo root: node scripts/gen-ios-images.mjs (uses the Playwright Chromium).
import { chromium } from '@playwright/test';

const ASSETS = 'apps/mobile/ios/App/App/Assets.xcassets';
const PIN = 'M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z';
const BLUE = '#1a73e8';

// The pin is 14x20 units of a 24 box; on the site's icon it is 42% of the icon's width.
const icon = (size, radius = 0) => {
  const s = (size * 0.42) / 14;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${radius}" fill="${BLUE}"/>
    <g transform="translate(${size / 2 - 12 * s} ${size / 2 - 12 * s}) scale(${s})"><path fill="#fff" d="${PIN}"/></g></svg>`;
};

// PW_CHROMIUM lets a sandbox point at a preinstalled Chromium.
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage();
async function shot(html, size, path) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:#fff;display:grid;place-items:center;height:100vh">${html}</body>`);
  await page.screenshot({ path, omitBackground: false });
  console.log('wrote', path);
}
await shot(icon(1024), 1024, `${ASSETS}/AppIcon.appiconset/AppIcon-512@2x.png`);
// Same look as the PWA launch screens (scripts/gen-pwa-images.py): a 288 px icon at 3x on white.
for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'])
  await shot(icon(288, 288 * 0.225), 2732, `${ASSETS}/Splash.imageset/${name}`);
await browser.close();
