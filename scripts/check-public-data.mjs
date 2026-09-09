import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const publicFiles = [
  'index.html',
  'data/legacy-skills.json',
  'data/skilldeck.json',
  'scripts/build-inventory.mjs',
  'scripts/extract-legacy.mjs',
  'scripts/inventory-utils.mjs'
];
const forbidden = [/\/Users\//i, /github_pat_/i, /ghp_/i, /bearer\s/i, /api[_-]?key/i, /oauth[_-]?token/i];
const dataOnlyForbidden = [/remote_plugin_id/i, /installPath/i];
const hits = [];
for (const file of publicFiles) {
  const content = await readFile(resolve(import.meta.dirname, '..', file), 'utf8');
  for (const pattern of forbidden) if (pattern.test(content)) hits.push(`${file}: ${pattern}`);
  if (file.startsWith('data/')) for (const pattern of dataOnlyForbidden) if (pattern.test(content)) hits.push(`${file}: ${pattern}`);
}
const skilldeck = JSON.parse(await readFile(resolve(import.meta.dirname, '..', 'data/skilldeck.json'), 'utf8'));
for (const capability of skilldeck.inventory.capabilities ?? []) {
  const serialized = JSON.stringify(capability);
  if (/app-\d{8,}|dev-\d{8,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{4,}/i.test(serialized)) hits.push(`data/skilldeck.json: 連携・MCPに外部ID形式が含まれます (${capability.id})`);
}
const publicHtml = await readFile(resolve(import.meta.dirname, '..', 'index.html'), 'utf8');
if (/app-[a-f0-9]{16,}|dev-[a-f0-9]{16,}/i.test(publicHtml)) hits.push('index.html: 外部ID形式が含まれます');
if (hits.length) { console.error(hits.join('\n')); process.exit(1); }
console.log('公開データ機密文字列検査: ok');
