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
  ['殿堂入りはトシが指定したSkillだけを登録する', hallOfFameSkills.length === 5 && hallOfFameSkills.every((record) => record.kind === 'skill') && ['strict-recheck-and-refine', 'todo-add', 'エレガント・プロンプト', '戦略→実行 統括', '施策進行マネージャー'].every((name) => hallOfFameSkills.some((record) => record.name === name))],
  ['第2カテゴリはADV関連', data.categories[1]?.id === 'adv'],
  ['ADVタグのSkillはすべてADV関連', all.filter((record) => record.projectTags.includes('ADV')).every((record) => record.category === 'adv')],
  ['第3カテゴリは開発・AI管理', data.categories[2]?.id === 'development-ai'],
  ['由来は自作・公式・他作だけ', all.every((record) => ['自作', '公式', '他作'].includes(origin(record)))],
  ['通常一覧にcommand・agent・自動実行を混在させない', all.every((record) => ['skill', 'builtin_skill', 'plugin_skill'].includes(record.kind))],
  ['共通正本の未配布Skillを通常一覧に混在させない', !all.some((record) => record.id === 'canonical.manage-codex-claude-mirroring')],
  ['cacheだけで導入済み扱いのPlugin Skillを混在させない', all.filter((record) => record.kind === 'plugin_skill').every((record) => ['codex','claude'].some((env) => record.environments[env].configured || record.environments[env].installed))],
  ['片側Skillに移行可否を設定する', all.filter((record) => record.mirror.status === 'codex_only' || record.mirror.status === 'claude_only').every((record) => ['directly_shareable','adapter_required','functionally_recreatable','mirror_impossible','requires_review'].includes(record.mirror.portability))],
  ['researchは公式Plugin版だけを表示する', all.filter((record) => record.name === 'research').length === 1 && all.some((record) => record.name === 'research' && record.provider.type === 'plugin') && !duplicates.some(([name]) => name === 'research')],
  ['別名統合済みにgrill-me/grillingを含む', skillLike.some((record) => record.name === 'grilling' && record.aliases.includes('grill-me'))]
  ,['カテゴリ選択後も8カテゴリの件数を算出できる', data.categories.length === 8 && Object.values(categoryCounts).every((count) => count > 0)]
  ,['旧形式と現行Skillの移行候補を自動削除せず保持する', migrationCandidates.length === 3 && migrationCandidates.every((candidate) => candidate.recordIds.length === 2)]
  ,['差分画面では無効な環境フィルターを表示しない', differenceViewHidesEnvironment]
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
  ,['共通Skill 2件は殿堂入り・AI運用・Codex実動確認済みである', ['strategy-execution-orchestrator', 'initiative-progress-manager'].every((id) => { const record=all.find((item) => item.id === `user.${id}`); return record?.category === 'hall-of-fame' && record.projectTags.includes('AI運用') && record.provider.type === 'user' && /共通正本Skill/.test(record.provider.name) && record.environments.codex.configured && record.environments.codex.evidenceType === 'clean_room_test' && record.environments.claude.configured && record.environments.claude.evidenceType === 'file_hash_verified'; })]
  ,['共通Skillの表示名・依頼例・起動語が正しい', (() => { const strategy=all.find((record) => record.id === 'user.strategy-execution-orchestrator'); const progress=all.find((record) => record.id === 'user.initiative-progress-manager'); return strategy?.name === '戦略→実行 統括' && strategy.example === '施策開始！' && strategy.triggers?.includes('$strategy-execution-orchestrator') && progress?.name === '施策進行マネージャー' && progress.example === '施策進行！' && ['スケジュール調整お願い', '$initiative-progress-manager'].every((trigger) => progress.triggers?.includes(trigger)); })()]
  ,['退役済みのai-workflow-consultantを再表示しない', !all.some((record) => record.name === 'ai-workflow-consultant')]
];
const failures = checks.filter(([, result]) => !result);
if (failures.length) { console.error(failures.map(([name]) => name).join('\n')); process.exit(1); }
console.log(JSON.stringify({ result: 'ok', total: all.length, codex: codex.length, claude: claude.length, both: both.length, categoryCounts, duplicateCandidates: duplicates.length, aliasIntegrations: aliasCount }, null, 2));
