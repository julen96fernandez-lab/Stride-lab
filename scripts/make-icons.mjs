// Genera los iconos PNG de la PWA a partir de un SVG (usa Playwright preinstalado).
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const svg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs><radialGradient id="g" cx="50%" cy="0%" r="90%"><stop offset="0" stop-color="#C8F23A" stop-opacity=".35"/><stop offset=".6" stop-color="#C8F23A" stop-opacity="0"/></radialGradient></defs>
<rect width="512" height="512" fill="#0A0B09"/><rect width="512" height="512" fill="url(#g)"/>
<g transform="translate(256 256) scale(${pad}) translate(-256 -256)">
<path d="M96 300h70l40-120 60 200 46-130h104" fill="none" stroke="#C8F23A" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="416" cy="250" r="22" fill="#C8F23A"/></g></svg>`;

const out = [
  ["public/icons/icon-192.png", 192, 1],
  ["public/icons/icon-512.png", 512, 1],
  ["public/icons/icon-maskable-512.png", 512, 0.72],
  ["public/icons/apple-touch-icon.png", 180, 0.9],
];
const browser = await chromium.launch();
for (const [file, size, pad] of out) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0}</style><img src="data:image/svg+xml;base64,${Buffer.from(svg(pad)).toString("base64")}" width="${size}" height="${size}" style="display:block">`);
  await page.screenshot({ path: file });
  await page.close();
}
await browser.close();
console.log("ok");
