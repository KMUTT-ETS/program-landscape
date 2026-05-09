// Pad the portrait KKU logo into a square favicon. Source aspect is
// 695:1235; the favicon spec wants square. Solution: render the logo
// centred in a 256×256 transparent canvas — browsers can scale that
// down to 32×32 / 16×16 without distortion.
//
// Run: pnpm tsx scripts/build-favicon.ts

import { createCanvas, loadImage } from '@napi-rs/canvas';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SIZE = 256;
const MARGIN = 24;

async function buildSquareFavicon(srcPath: string, dstPath: string) {
  const img = await loadImage(srcPath);
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  // Transparent background.
  ctx.clearRect(0, 0, SIZE, SIZE);
  // Scale logo to fit inside SIZE × SIZE, preserving aspect, with a
  // small margin so the logo isn't flush with the edge.
  const innerW = SIZE - 2 * MARGIN;
  const innerH = SIZE - 2 * MARGIN;
  const scale = Math.min(innerW / img.width, innerH / img.height);
  const drawW = img.width * scale;
  const drawH = img.height * scale;
  const x = (SIZE - drawW) / 2;
  const y = (SIZE - drawH) / 2;
  ctx.drawImage(img, x, y, drawW, drawH);
  fs.writeFileSync(dstPath, canvas.toBuffer('image/png'));
  console.log(
    `Wrote ${dstPath} (${SIZE}x${SIZE}, logo at ${drawW.toFixed(0)}x${drawH.toFixed(0)})`,
  );
}

async function main() {
  const root = path.resolve(__dirname, '..');
  // Default favicon — the BLACK logo on transparent. Renders well on
  // both light and dark browser tab backgrounds (most browsers tint
  // tab strips so neither pure-black nor pure-white reads ideally;
  // the black logo on transparent is the broadest fit).
  await buildSquareFavicon(
    path.join(root, 'apps/web/public/brand/kku-logo-light.png'),
    path.join(root, 'apps/web/app/icon.png'),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
