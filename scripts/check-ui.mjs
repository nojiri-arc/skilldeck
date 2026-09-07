import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const html = await readFile(resolve(import.meta.dirname, '..', 'index.html'), 'utf8');
const required = ['skillsTab', 'diffTab', 'data-env="codex"', 'data-env="claude"', 'data-provider="自作"', 'data-provider="他作"', 'data-provider="公式"', 'environmentControls', "hidden=!isSkills", '[hidden] { display:none !important; }', 'aria-pressed', 'skilldeck.json', 'navigator.clipboard', '環境差分', 'if (!count) continue', 'ArrowRight', 'originBadge(record)', 'origin-self', 'origin-official', 'origin-external', '重複候補', '別名統合済み', '同一能力の移行候補', 'normalizeSkillName', '提供元', '正本ID:', '必要な連携', 'hasEnvironmentEvidence', 'ignoreCategory:true', '保持推奨', '削除候補', '必要性を要確認', 'data-review-action="keep"', 'data-review-action="request_delete"', 'reviewStorageKey', 'overflow-x:clip', 'overflow-wrap:anywhere', '.difference-grid { grid-template-columns:1fr; }', 'function japaneseSummary(record)', '原文の説明', 'strict-recheck-and-refine', 'function reviewPurpose(record)', '<b>用途:</b>', 'function pluginPackagePurpose(provider,members)', '用途は不明です。', 'function requestExample(record)', '厳しめの再確認をお願い！', '用途が不明のため、詳細を確認してから依頼してください。'];
const banned = ['>MCP<', '>アプリ<', 'const SKILLS =', 'CATEGORIES ='];
const errors = required.filter((value) => !html.includes(value)).map((value) => `不足: ${value}`)
  .concat(banned.filter((value) => html.includes(value)).map((value) => `旧実装が残っています: ${value}`));
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
if (html.indexOf('id="skillsScreen"') > html.indexOf('data-env="codex"')) { console.error('環境絞り込みがスキル一覧画面の外にあります。'); process.exit(1); }
console.log('UI静的検査: ok');
