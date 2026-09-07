import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const data = JSON.parse(await readFile(resolve(root, 'data/skilldeck.json'), 'utf8'));
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
  ['全8カテゴリに表示対象がある', data.categories.length === 8 && Object.values(categoryCounts).every((count) => count > 0)],
  ['第1カテゴリは殿堂入り', data.categories[0]?.id === 'hall-of-fame'],
  ['殿堂入りはトシが指定したskillだけを登録する', hallOfFameSkills.length === 2 && hallOfFameSkills.every((record) => record.kind === 'skill') && ['strict-recheck-and-refine', 'todo-add'].every((name) => hallOfFameSkills.some((record) => record.name === name))],
  ['第2カテゴリはADV関連', data.categories[1]?.id === 'adv'],
  ['ADVタグのSkillはすべてADV関連', all.filter((record) => record.projectTags.includes('ADV')).every((record) => record.category === 'adv')],
  ['第3カテゴリは開発・AI管理', data.categories[2]?.id === 'development-ai'],
  ['由来は自作・公式・他作だけ', all.every((record) => ['自作', '公式', '他作'].includes(origin(record)))],
  ['通常一覧にcommand・agent・自動実行を混在させない', all.every((record) => ['skill', 'builtin_skill', 'plugin_skill'].includes(record.kind))],
  ['共通正本の未配布Skillを通常一覧に混在させない', !all.some((record) => record.id === 'canonical.manage-codex-claude-mirroring')],
  ['cacheだけで導入済み扱いのPlugin Skillを混在させない', all.filter((record) => record.kind === 'plugin_skill').every((record) => ['codex','claude'].some((env) => record.environments[env].configured || record.environments[env].installed))],
  ['片側Skillに移行可否を設定する', all.filter((record) => record.mirror.status === 'codex_only' || record.mirror.status === 'claude_only').every((record) => ['directly_shareable','adapter_required','functionally_recreatable','mirror_impossible','requires_review'].includes(record.mirror.portability))],
  ['重複候補は正規化した表示名から自動集計する', duplicates.some(([name, group]) => name === 'research' && group.some((record) => record.provider.type === 'user') && group.some((record) => record.provider.type === 'plugin'))],
  ['別名統合済みにgrill-me/grillingを含む', skillLike.some((record) => record.name === 'grilling' && record.aliases.includes('grill-me'))]
  ,['カテゴリ選択後も8カテゴリの件数を算出できる', data.categories.length === 8 && Object.values(categoryCounts).every((count) => count > 0)]
  ,['旧形式と現行Skillの移行候補を自動削除せず保持する', migrationCandidates.length === 3 && migrationCandidates.every((candidate) => candidate.recordIds.length === 2)]
  ,['差分画面では無効な環境フィルターを表示しない', differenceViewHidesEnvironment]
  ,['由来3区分を常時見えるボタンで絞り込める', ['自作','他作','公式'].every((provider) => html.includes(`data-provider="${provider}"`)) && html.includes('originBadge(record)')]
  ,['全Skillに利用状況と必要性判定がある', all.every((record) => ['recent_signal','no_signal'].includes(record.usage?.status) && ['keep_required','keep_recommended','needs_review','delete_candidate'].includes(record.governance?.status))]
  ,['削除候補は実環境未検出・直近利用シグナルなしだけ', all.filter((record) => record.governance?.status === 'delete_candidate').every((record) => record.usage.status === 'no_signal' && !['codex','claude'].some((environment) => record.environments[environment].configured || record.environments[environment].installed))]
  ,['Pluginの必要性判断は個別Skillではなく一式へ集約する', html.includes('function pluginPackageTargets(records)') && html.includes("id:`package:${provider}`") && html.includes("kind:'plugin_package'")]
  ,['精査画面は削除候補を先頭に表示する', html.indexOf("reviewPanel('削除候補'") < html.indexOf("reviewPanel('必要性を要確認'") && html.indexOf("reviewPanel('必要性を要確認'") < html.indexOf("reviewPanel('保持推奨'")]
  ,['保持・削除依頼は実削除せず判断保存と依頼文コピーに限定する', html.includes('data-review-action="keep"') && html.includes('data-review-action="request_delete"') && html.includes('実削除はトシの承認後に実施') && !html.includes('fetch(\'/api/delete')]
  ,['判断一覧はコピーと全消去ができる', html.includes('id="copyReviewQueue"') && html.includes('id="clearReviewQueue"') && html.includes("localStorage.removeItem(reviewStorageKey)")]
  ,['技術差分の重複表示には判断ボタンを重ねない', html.includes("records.map((record) => diffItem(record,{actions:false}))")]
];
const failures = checks.filter(([, result]) => !result);
if (failures.length) { console.error(failures.map(([name]) => name).join('\n')); process.exit(1); }
console.log(JSON.stringify({ result: 'ok', total: all.length, codex: codex.length, claude: claude.length, both: both.length, categoryCounts, duplicateCandidates: duplicates.length, aliasIntegrations: aliasCount }, null, 2));
