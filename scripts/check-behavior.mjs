import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const data = JSON.parse(await readFile(resolve(root, 'data/skilldeck.json'), 'utf8'));
const recipes = JSON.parse(await readFile(resolve(root, 'data/request-recipes.json'), 'utf8'));
const html = await readFile(resolve(root, 'index.html'), 'utf8');
const skills = data.records.filter((record) => ['skill', 'builtin_skill', 'plugin_skill'].includes(record.kind));
const filter = (envs) => skills.filter((record) => envs.every((env) => record.environments[env].configured || record.environments[env].installed));
const all = filter([]);
const codex = filter(['codex']);
const claude = filter(['claude']);
const both = filter(['codex', 'claude']);
const categoryCounts = Object.fromEntries(data.categories.map((category) => [category.id, all.filter((record) => record.category === category.id).length]));
const hallOfFameSkills = all.filter((record) => record.category === 'hall-of-fame');
const ordered = [...all].sort((a, b) => data.categories.findIndex((category) => category.id === a.category) - data.categories.findIndex((category) => category.id === b.category) || a.name.localeCompare(b.name, 'ja'));
const origin = (record) => {
  if (record.legacy?.origin === '自作') return '自作';
  if (record.legacy?.origin === 'もらった' || record.legacy?.origin === 'プラグイン') return '他作';
  if (record.legacy?.origin === '公式') return '公式';
  if (record.provider.type === 'user') return '自作';
  if (record.provider.type === 'openai' || record.provider.name.includes('OpenAI')) return '公式';
  return '他作';
};
const skillLike = data.records.filter((record) => ['skill', 'canonical_skill', 'builtin_skill', 'plugin_skill'].includes(record.kind));
const duplicateGroups = new Map();
for (const record of skillLike) {
  const key = record.name.trim().toLocaleLowerCase('ja');
  duplicateGroups.set(key, [...(duplicateGroups.get(key) ?? []), record]);
}
const duplicates = [...duplicateGroups.entries()].filter(([, group]) => group.length > 1);
const aliasCount = skillLike.reduce((total, record) => total + (record.aliases?.length ?? 0), 0);
const migrationCandidates = data.inventory.migrationCandidates ?? [];
const differenceViewHidesEnvironment = html.includes("byId('environmentControls').hidden=!isSkills");
const checks = [
  ['未選択はSkill全件', all.length === skills.length],
  ['Codex選択はCodexの導入・設定証跡がある項目だけ', codex.every((record) => record.environments.codex.configured || record.environments.codex.installed)],
  ['Claude選択はClaudeの導入・設定証跡がある項目だけ', claude.every((record) => record.environments.claude.configured || record.environments.claude.installed)],
  ['両選択は両環境の導入・設定証跡がある項目だけ', both.every((record) => (record.environments.codex.configured || record.environments.codex.installed) && (record.environments.claude.configured || record.environments.claude.installed))],
  ['全9カテゴリに表示対象がある', data.categories.length === 9 && Object.values(categoryCounts).every((count) => count > 0)],
  ['第1カテゴリはお気に入り', data.categories[0]?.id === 'hall-of-fame' && data.categories[0]?.name === 'お気に入り'],
  ['お気に入りには現行指定Skillを登録する', hallOfFameSkills.length === 7 && hallOfFameSkills.every((record) => record.kind === 'skill') && ['strict-recheck-and-refine', 'todo-add', 'elegant-prompt', 'communication-approval', 'shiryo-slides', 'shiryo-slides-hub', 'cloudflare-web-publish'].every((name) => hallOfFameSkills.some((record) => record.name === name))],
  ['第2カテゴリは担当業務特化', data.categories[1]?.id === 'specialized-work' && data.categories[1]?.name === '担当業務特化'],
  ['ゆいいつ・業務導線Skillは担当業務特化', ['adv-new-attacker', 'task-depot-sync-now', 'todo-share-table', 'yuiitsu-ad-reporting', 'yuiitsu-before-after-posts', 'yuiitsu-daily-ads-analysis'].every((name) => all.some((record) => record.name === name && record.category === 'specialized-work'))],
  ['既存のADV関連カテゴリに表示対象がある', all.some((record) => record.category === 'adv')],
  ['第3カテゴリはADV関連', data.categories[2]?.id === 'adv'],
  ['第4カテゴリは開発・AI管理', data.categories[3]?.id === 'development-ai'],
  ['由来は自作・公式・他作だけ', all.every((record) => ['自作', '公式', '他作'].includes(origin(record)))],
  ['通常一覧にcommand・agent・自動実行を混在させない', all.every((record) => ['skill', 'builtin_skill', 'plugin_skill'].includes(record.kind))],
  ['共通正本の未配布Skillを通常一覧に混在させない', !all.some((record) => record.id === 'canonical.manage-codex-claude-mirroring')],
  ['cacheだけで導入済み扱いのPlugin Skillを混在させない', all.filter((record) => record.kind === 'plugin_skill').every((record) => ['codex','claude'].some((env) => record.environments[env].configured || record.environments[env].installed))],
  ['片側Skillに移行可否を設定する', all.filter((record) => record.mirror.status === 'codex_only' || record.mirror.status === 'claude_only').every((record) => ['directly_shareable','adapter_required','functionally_recreatable','mirror_impossible','requires_review'].includes(record.mirror.portability))],
  ['researchは公式Plugin版だけを表示する', all.filter((record) => record.name === 'research').length === 1 && all.some((record) => record.name === 'research' && record.provider.type === 'plugin') && !duplicates.some(([name]) => name === 'research')],
  ['ADV Plugin Skillの環境別複製を1カードへ統合する', ['adv-business-knowledge','adv-shiryo-sakusei','adv-shiyo-gijiroku','aso-internal-order-request','aso-simulation-and-order-request','aso-simulation-intake','customer-icebreaker-research','draft-client-proposal','draft-sales-email','makeleaps-client-registration','makeleaps-orderslip-creation','meeting-minutes-notion-registration','mtg-after-automation','pipedrive-manage-sales','post-order-operations-router','review-cleaning-sales-sheet-update','review-cleaning-sheet-setup','review-screenshot-automation-setup','review-screenshot-daily-operations','review-screenshot-reflection','sales-deal-lifecycle-router','sales-sheet-update','task-collection-daily-brief'].every((name) => { const matches=all.filter((record) => record.name === name); return matches.length === 1 && matches[0].environments.codex.installed && matches[0].environments.claude.installed; })],
  ['2026-09-14に退役したSkill・旧コマンドを再表示しない', !['codex:setup', 'codex:review', 'codex:adversarial-review', 'codex:rescue', 'codex:transfer', 'codex:status', 'codex:result', 'codex:cancel', 'mission-control-daily-brief', 'discord-ai-relay', 'create-chatgpt-project', 'sequential-task-execution', 'grill-me', 'grill-with-docs', 'ask-matt', 'setup-matt-pocock-skills', 'to-spec', 'to-tickets', 'implement', 'tdd', 'teach', 'prototype', 'slide-outline-generator', 'funny-gif', 'japanese-english-translator', 'japanese-korean-translator', 'artifact-template-adv-2', 'sso-quick-diagnostics', 'communication-detection'].some((name) => all.some((record) => record.name === name || record.aliases?.includes(name)))]
  ,['カテゴリ選択後も9カテゴリの件数を算出できる', data.categories.length === 9 && Object.values(categoryCounts).every((count) => count > 0)]
  ,['旧形式と現行Skillの移行候補を自動削除せず保持する', migrationCandidates.length === 3 && migrationCandidates.every((candidate) => candidate.recordIds.length === 2)]
  ,['スキル以外の画面では環境フィルターを表示しない', differenceViewHidesEnvironment]
  ,['由来3区分を常時見えるボタンで絞り込める', ['自作','他作','公式'].every((provider) => html.includes(`data-provider="${provider}"`)) && html.includes('originBadge(record)')]
  ,['全Skillに利用状況と必要性判定がある', all.every((record) => ['recent_signal','no_signal'].includes(record.usage?.status) && ['keep_required','keep_recommended','needs_review','delete_candidate'].includes(record.governance?.status))]
  ,['削除候補は実環境未検出・直近利用シグナルなしだけ', all.filter((record) => record.governance?.status === 'delete_candidate').every((record) => record.usage.status === 'no_signal' && !['codex','claude'].some((environment) => record.environments[environment].configured || record.environments[environment].installed))]
  ,['Pluginの必要性判断は個別Skillではなく一式へ集約する', html.includes('function pluginPackageTargets(records)') && html.includes("id:`package:${provider}`") && html.includes("kind:'plugin_package'")]
  ,['精査画面はデクの見直し候補だけを表示する', html.includes("reviewPanel('デクの見直し候補'") && !html.includes("reviewPanel('保持推奨'") && !html.includes("reviewPanel('必要性を要確認'")]
  ,['保持・削除の判断を保存して、正本更新対象を明確にできる', html.includes('data-review-action="keep"') && html.includes('data-review-action="request_delete"') && html.includes('判断: ${decision === \'keep\' ? \'保持\' : \'削除\'}') && !html.includes('fetch(\'/api/delete')]
  ,['判断一覧はコピーと全消去ができる', html.includes('id="copyReviewQueue"') && html.includes('id="clearReviewQueue"') && html.includes("localStorage.removeItem(reviewStorageKey)")]
  ,['技術差分は常時表示し、判断ボタンを置かない', html.includes('function technicalGuide(title)') && html.includes('records.map((record) => diffItem(record,{actions:false})).join') && html.includes('technical-details')]
  ,['検品Skillと実動確認の状態を区別して表示する', html.includes("'strict-recheck-and-refine':'検品スキルです。") && html.includes("'strict-recheck-and-refine':'検品スキル'") && html.includes("environment.evidenceType === 'clean_room_test'") && html.includes("environment.evidenceType === 'file_hash_verified'")]
  ,['エレガント・プロンプトはClaude実動未検証を記録する', hallOfFameSkills.some((record) => record.id === 'user.elegant-prompt' && record.environments.codex.evidenceType === 'clean_room_test' && record.environments.claude.evidenceType === 'file_hash_verified' && /実動テストは未実施/.test(record.environments.claude.verificationNote || ''))]
  ,['廃止承認済みのprompt-engineering-assistantを再表示しない', !all.some((record) => record.name === 'prompt-engineering-assistant')]
  ,['2026-09-15に退役した施策スキル2件を再表示しない', !['strategy-execution-orchestrator', 'initiative-progress-manager'].some((name) => all.some((record) => record.name === name || record.aliases?.includes(name)))]
  ,['Obsidian記録は指定カテゴリ・起動語・両環境の実行未検証状態で表示する', (() => { const record=all.find((item) => item.id === 'user.obsidian-record'); return record?.name === 'obsidian-record' && record.japaneseName === 'Obsidian記録' && record.category === 'meeting-writing-translation' && record.projectTags.includes('AI運用') && record.example === '議事録保存して' && ['議事録保存して', 'メモしといて', '方針更新して', '$obsidian-record'].every((trigger) => record.triggers?.includes(trigger)) && /ToDoを表/.test(record.description) && ['codex', 'claude'].every((environment) => record.environments[environment].availability === 'installed_unverified' && record.environments[environment].evidenceType === 'file_hash_verified' && /実動テストは未実施/.test(record.environments[environment].verificationNote || '')); })()]
  ,['shiryo-slidesはお気に入り・外部提供・両環境実動未検証で表示する', (() => { const record=all.find((item) => item.id === 'user.shiryo-slides'); return record?.category === 'hall-of-fame' && record.provider.type === 'external' && record.provider.name === 'code4biz/shiryo-slides-kit' && record.example === 'この議事録から提案資料を作って' && ['資料を作って', '提案書を作って', 'スライドにして', '議事録から資料に', '$shiryo-slides'].every((trigger) => record.triggers?.includes(trigger)) && /16:9のHTMLスライド/.test(record.description) && /ADV仕様やPPTX/.test(record.description) && ['codex', 'claude'].every((environment) => record.environments[environment].contentHash === 'sha256:edb27366aaf0f9e6bc4370d73ee6ae0b36206157760777c53641322ec66dd31d' && record.environments[environment].availability === 'installed_unverified' && record.environments[environment].evidenceType === 'file_hash_verified' && /実動テストは未実施/.test(record.environments[environment].verificationNote || '')); })()]
  ,['資料作成キットはお気に入り・ADV対応・両環境実動未検証で表示する', (() => { const record=all.find((item) => item.id === 'user.shiryo-slides-hub'); return record?.category === 'hall-of-fame' && record.japaneseName === '資料作成キット（ADV対応）' && record.provider.type === 'user' && record.example === 'ADV資料をHTMLで作って' && ['資料を作って', '提案書を作って', 'ADV資料をHTMLで作って', '議事録から資料に', '$shiryo-slides-hub'].every((trigger) => record.triggers?.includes(trigger)) && /ADV標準を先頭に6テーマ/.test(record.description) && /PPTXやGoogle Slides/.test(record.description) && ['codex', 'claude'].every((environment) => record.environments[environment].availability === 'installed_unverified' && record.environments[environment].evidenceType === 'file_hash_verified' && /実動テストは未実施/.test(record.environments[environment].verificationNote || '')); })()]
  ,['Claude中核2 Skillは配置・設定確認だけで、実動確認済みと混同しない', ['elegant-prompt', 'manage-codex-claude-mirroring'].every((id) => { const record=all.find((item) => item.id === `user.${id}`); return record?.environments.claude.availability === 'installed_unverified' && record.environments.claude.evidenceType === 'file_hash_verified' && /実動テストは未実施/.test(record.environments.claude.verificationNote || ''); })]
  ,['4つの画面とフィルター順がある', ['recipesTab','skillsTab','integrationsTab','diagnosticsTab','recipesScreen','integrationsScreen','diagnosticsScreen'].every((id) => html.includes(id)) && ['id="search"','id="purposeFilter"','id="projectFilter"','id="environmentControls"','data-availability="verified"','data-provider="自作"'].every((id,index,array) => !index || html.indexOf(array[index - 1]) < html.indexOf(id))]
  ,['依頼レシピは実在するSkillだけを組み合わせる', recipes.recipes.length >= 12 && recipes.recipes.every((recipe) => recipe.skills.length && recipe.skills.every((name) => skills.some((record) => record.name === name)))]
  ,['依頼レシピは依頼文・発動Skill・成果物を表示してコピーできる', html.includes('function renderRecipes()') && html.includes('data-recipe-skill') && html.includes('依頼文をコピー') && recipes.recipes.every((recipe) => recipe.prompt && recipe.outputs.length)]
  ,['連携・MCPは診断ではなく種別ごとの専用画面に表示する', html.includes('function renderIntegrations()') && html.includes('function integrationCard(item)') && html.includes("['MCP','App','能力']") && (data.inventory.capabilities ?? []).every((item) => ['MCP','App','能力'].includes(item.type)) && !html.includes("diffPanel('導入証跡のみの連携・能力'")]
  ,['利用可否は選択した環境だけで照合する', html.includes("const availabilityEnvironments = state.envs.size ? [...state.envs] : ['codex','claude'];")]
  ,['日本語名は英語名の補助表示としてカードに表示する', html.includes('class="japanese-name"') && html.includes('日本語名：${escapeHtml(record.japaneseName)}')]
  ,['communication-approvalは横断確認を扱い、汎用スケ調整では起動しない', (() => { const record=all.find((item) => item.id === 'user.communication-approval'); return record?.example === 'コミュニケーションツールの横断確認お願い！' && /指定されたSlack／LINE/.test(record.description) && /だけでは起動せず/.test(record.description) && ['コミュニケーションツールの横断確認お願い！', 'チャット系の横断確認お願い！', '$communication-approval'].every((trigger) => record.triggers?.includes(trigger)) && !record.triggers?.includes('スケ調整お願い') && !record.triggers?.includes('スケジュール調整お願い'); })()]
  ,['公開除外指定の自動化を再生成で戻さない', !data.records.some((record) => record.id === 'automation.claude.yuiitsu-offline-cv-import-check')]
  ,['退役済みのai-workflow-consultantを再表示しない', !all.some((record) => record.name === 'ai-workflow-consultant')]
  ,['退役済みのskill-registry-updateを再表示しない', !all.some((record) => record.name === 'skill-registry-update')]
  ,['退役済みのcalendar-event-and-meet-linkを再表示しない', !all.some((record) => record.name === 'calendar-event-and-meet-link')]
];
const failures = checks.filter(([, result]) => !result);
if (failures.length) { console.error(failures.map(([name]) => name).join('\n')); process.exit(1); }
console.log(JSON.stringify({ result: 'ok', total: all.length, codex: codex.length, claude: claude.length, both: both.length, categoryCounts, duplicateCandidates: duplicates.length, aliasIntegrations: aliasCount }, null, 2));
