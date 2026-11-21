/**
 * One-shot brand-icon generator (issue #31): renders the inline SVG mark
 * to `public/icon.png` — a 512×512 PNG that serves as the site favicon
 * AND the fallback og:image (Discord floor: raster, ≥200×200, ≤8MB).
 *
 * Run: npm run icon
 * The owner can drop in a hand-made PNG any time; this script stays as
 * the documented generator, so the asset is reproducible from source.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

const SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">',
  '  <rect width="512" height="512" rx="104" fill="#18181b"/>',
  '  <circle cx="256" cy="256" r="188" fill="#0c0a09" stroke="#f59e0b" stroke-width="12"/>',
  '  <circle cx="256" cy="256" r="148" fill="none" stroke="#27272a" stroke-width="4"/>',
  '  <circle cx="256" cy="256" r="116" fill="none" stroke="#27272a" stroke-width="4"/>',
  '  <circle cx="256" cy="256" r="80" fill="#fef3c7"/>',
  '  <path d="M228 196 v116" stroke="#18181b" stroke-width="26" stroke-linecap="round" fill="none"/>',
  '  <circle cx="248" cy="298" r="46" fill="none" stroke="#18181b" stroke-width="26"/>',
  '</svg>',
].join('\n');

const out = path.resolve(process.cwd(), 'public/icon.png');
await mkdir(path.dirname(out), { recursive: true });
await sharp(Buffer.from(SVG)).png({ compressionLevel: 9 }).toFile(out);
console.log(`wrote ${out}`);
