import { gameFont, menuFont } from './fonts.js';

const SYLLABICS = [
  '\u1401', '\u1403', '\u1405', '\u140a', '\u142f', '\u1431', '\u1433', '\u1438',
  '\u144c', '\u144e', '\u1450', '\u1455', '\u146b', '\u146d', '\u146f', '\u1472',
  '\u1489', '\u148b', '\u148d', '\u1490', '\u14a3', '\u14a5', '\u14a7', '\u14aa',
  '\u14c0', '\u14c2', '\u14c4', '\u14c7', '\u14ed', '\u14ef', '\u14f1', '\u14f4',
  '\u1526', '\u1528', '\u152a', '\u152d', '\u1543', '\u1546', '\u1548', '\u154b',
  '\u1593', '\u158f', '\u1591', '\u1595',
];

function hash01(seed: number): number {
  let h = Math.imul(seed | 0, 374761393);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

function glyphFor(index: number, time: number): string {
  const slot = Math.floor(time * 24 + index * 7);
  return SYLLABICS[(slot + index * 13) % SYLLABICS.length];
}

export function drawDecodedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  sizePx: number,
  openedAt: number,
  align: CanvasTextAlign = 'left',
): void {
  const elapsed = performance.now() * 0.001 - openedAt;
  const previousAlign = ctx.textAlign;
  const previousBaseline = ctx.textBaseline;
  const chars = [...text];
  const widths = chars.map((ch) => {
    ctx.font = gameFont(sizePx);
    return ctx.measureText(ch).width;
  });
  const totalW = widths.reduce((sum, width) => sum + width, 0);
  let cursor = align === 'center' ? x - totalW / 2 : align === 'right' ? x - totalW : x;
  ctx.textAlign = 'left';
  ctx.textBaseline = previousBaseline;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const doneAt = 0.08 + hash01(i + text.length * 31) * 0.62;
    const decoded = ch.trim() === '' || elapsed >= doneAt;
    ctx.font = decoded ? gameFont(sizePx) : menuFont(sizePx);
    ctx.fillText(decoded ? ch : glyphFor(i, elapsed), cursor, y);
    cursor += widths[i];
  }

  ctx.textAlign = previousAlign;
  ctx.textBaseline = previousBaseline;
}
