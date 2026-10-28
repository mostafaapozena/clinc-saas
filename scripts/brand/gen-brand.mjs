// Builds web brand assets from the vector pages of "raclinic logo .pdf" (exported with pdftocairo).
// The original <path> elements are copied verbatim (geometry, fills, opacity); only the viewBox
// changes (crop to the artwork plus padding). Nothing is redrawn or recolored.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const out = process.argv[2];
mkdirSync(out, { recursive: true });
const paths = (file) => [...readFileSync(file, 'utf8').replace(/<defs>[\s\S]*?<\/defs>/, '').matchAll(/<path [^>]*\/>/g)].map((m) => m[0]);
const p1 = paths('page1.svg');
const p2 = paths('page2.svg');
const svg = (title, [x, y, w, h], els, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" role="img" aria-label="${title}">\n<title>${title}</title>\n${extra}${els.join('\n')}\n</svg>\n`;
const box = (x1, y1, x2, y2, pad) => [x1 - pad, y1 - pad, x2 - x1 + 2 * pad, y2 - y1 + 2 * pad].map((n) => +n.toFixed(2));

// Stacked lockup (page 1): symbol + "ra / Clinic". Artwork x 33.8–1053.0, y 26.3–355.6.
writeFileSync(`${out}/raclinic-lockup.svg`, svg('raclinic', box(33.8, 26.3, 1053.0, 355.6, 8), p1));
// Horizontal wordmark (page 2): artwork x 20.6–1052.4, y 53.9–289.4.
writeFileSync(`${out}/raclinic-wordmark.svg`, svg('raclinic', box(20.6, 53.9, 1052.4, 289.4, 8), p2));
// Symbol only (page 1 paths 10–12): x 33.8–397.0, y 28.9–324.8.
const symbol = [p1[10], p1[11], p1[12]];
writeFileSync(`${out}/raclinic-symbol.svg`, svg('raclinic', box(33.8, 28.9, 397.0, 324.8, 6), symbol));
// Square icon canvas for favicons: the symbol centered, unscaled, inside a square viewBox.
const [sx, sy, sw, sh] = [33.8, 28.9, 397.0 - 33.8, 324.8 - 28.9];
const side = Math.max(sw, sh) + 24;
const square = [+(sx - (side - sw) / 2).toFixed(2), +(sy - (side - sh) / 2).toFixed(2), +side.toFixed(2), +side.toFixed(2)];
writeFileSync(`${out}/favicon.svg`, svg('raclinic', square, symbol));
writeFileSync(`${out}/icon-on-white.svg`, svg('raclinic', square, symbol, `<rect x="${square[0]}" y="${square[1]}" width="${side}" height="${side}" fill="#ffffff"/>\n`));
// Sharing image 1200×630: white background, stacked lockup centered at its own proportions.
const [lx, ly, lw, lh] = box(33.8, 26.3, 1053.0, 355.6, 8);
const scale = 900 / lw;
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">\n<rect width="1200" height="630" fill="#ffffff"/>\n<g transform="translate(${(1200 - lw * scale) / 2} ${(630 - lh * scale) / 2}) scale(${scale}) translate(${-lx} ${-ly})">\n${p1.join('\n')}\n</g>\n</svg>\n`;
writeFileSync(`${out}/og-source.svg`, og);
console.log('paths page1', p1.length, 'page2', p2.length, 'square', square);
