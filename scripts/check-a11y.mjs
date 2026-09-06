const pairs = [
  ['通常文', '#625956', '#ffffff'],
  ['補助文', '#7a6f6b', '#ffffff'],
  ['アクセント', '#8c2f3a', '#ffffff'],
  ['自作バッジ', '#7d3358', '#f8eaf1'],
  ['公式バッジ', '#216152', '#eaf6f0'],
  ['他作バッジ', '#49608e', '#edf1fb'],
  ['ダーク通常文', '#c8bbb6', '#211a19'],
  ['ダーク補助文', '#aa9b96', '#211a19']
];
const luminance = (hex) => {
  const rgb = hex.slice(1).match(/.{2}/g).map((part) => parseInt(part, 16) / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
};
const results = pairs.map(([label, foreground, background]) => ({ label, ratio: (Math.max(luminance(foreground), luminance(background)) + .05) / (Math.min(luminance(foreground), luminance(background)) + .05) }));
const failed = results.filter((result) => result.ratio < 4.5);
if (failed.length) { console.error(JSON.stringify(failed)); process.exit(1); }
const html = await readFile(resolve(import.meta.dirname, '..', 'index.html'), 'utf8');
const responsiveRequirements = ['overflow-x:clip', 'overflow-wrap:anywhere', '@media (max-width:880px)', '.difference-grid { grid-template-columns:1fr; }'];
const missing = responsiveRequirements.filter((value) => !html.includes(value));
if (missing.length) { console.error(`モバイル横スクロール対策が不足しています: ${missing.join(', ')}`); process.exit(1); }
console.log(JSON.stringify(results.map((result) => ({ ...result, ratio: Number(result.ratio.toFixed(2)) })), null, 2));
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
