import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const html = await readFile(resolve(import.meta.dirname, '..', 'index.html'), 'utf8');
const required = ['skillsTab', 'integrationsTab', 'diagnosticsTab', 'integrationsScreen', 'diagnosticsScreen', 'data-env="codex"', 'data-env="claude"', 'data-availability="verified"', 'data-availability="installed_unverified"', 'data-availability="not_distributed"', 'data-provider="自作"', 'data-provider="他作"', 'data-provider="公式"', 'purposeFilter', 'projectFilter', 'environmentControls', "hidden=!isSkills", '[hidden] { display:none !important; }', 'aria-pressed', 'skilldeck.json', 'navigator.clipboard', '連携・MCP', 'デクの見直し候補', 'if (!count) continue', 'ArrowRight', 'originBadge(record)', 'origin-self', 'origin-official', 'origin-external', '重複候補', '別名統合済み', '同一能力の移行候補', 'normalizeSkillName', '提供元', '正本ID:', '必要な連携', '起動語', 'hasEnvironmentEvidence', 'ignoreCategory:true', 'data-review-action="keep"', 'data-review-action="request_delete"', 'reviewStorageKey', 'overflow-x:clip', 'overflow-wrap:anywhere', '.difference-grid { grid-template-columns:1fr; }', 'function japaneseSummary(record)', '原文の説明', 'strict-recheck-and-refine', '検品スキル', '共通Skill・AI運用', 'function reviewPurpose(record)', '<b>用途:</b>', 'function codexAdvice(record)', 'デクのおすすめ:', 'function technicalGuide(title)', 'function pluginPackagePurpose(provider,members)', 'packageGovernanceOverrides', '用途は不明です。', 'function requestExample(record)', '厳しめの再確認をお願い！', '用途が不明のため、詳細を確認してから依頼してください。', 'environmentAvailabilityLabel', '実動確認済み', '配置・設定確認（実行未検証）', 'function renderIntegrations()', 'function integrationCard(item)', "['MCP','App','能力']", 'availabilityEnvironments', '環境範囲', '利用可否'];
const banned = ['id="diffTab"', 'id="diffScreen"', 'const SKILLS =', 'CATEGORIES ='];
const errors = required.filter((value) => !html.includes(value)).map((value) => `不足: ${value}`)
  .concat(banned.filter((value) => html.includes(value)).map((value) => `旧実装が残っています: ${value}`));
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
if (html.indexOf('id="skillsScreen"') > html.indexOf('data-env="codex"')) { console.error('環境絞り込みがスキル一覧画面の外にあります。'); process.exit(1); }
const order = ['id="search"', 'id="purposeFilter"', 'id="projectFilter"', 'id="environmentControls"', 'data-availability="verified"', 'data-provider="自作"'];
if (order.some((value, index) => index && html.indexOf(order[index - 1]) > html.indexOf(value))) { console.error('フィルター順が検索→用途→案件→環境→利用可否→提供元ではありません。'); process.exit(1); }
console.log('UI静的検査: ok');
