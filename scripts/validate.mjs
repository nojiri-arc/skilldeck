import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const data = JSON.parse(await readFile(resolve(root, 'data/skilldeck.json'), 'utf8'));
const legacy = JSON.parse(await readFile(resolve(root, 'data/legacy-skills.json'), 'utf8'));
const errors = [];
const ids = new Set();
const names = new Set();
const allowedKinds = new Set(['skill', 'builtin_skill', 'plugin_skill', 'canonical_skill', 'command', 'agent', 'automation', 'capability']);
const allowedStatuses = new Set(['synced', 'codex_only', 'claude_only', 'not_mirrorable', 'needs_review']);
const allowedAvailability = new Set(['verified', 'installed_unverified', 'not_distributed', 'not-applicable']);
const allowedPortability = new Set(['directly_shareable', 'adapter_required', 'functionally_recreatable', 'mirror_impossible', 'requires_review']);
const allowedUsageStatuses = new Set(['recent_signal', 'no_signal']);
const allowedGovernanceStatuses = new Set(['keep_required', 'keep_recommended', 'needs_review', 'delete_candidate']);
const categoryIds = new Set(data.categories.map((category) => category.id));
// 凍結済み旧一覧にだけ残る、実体と公開カードを廃止したSkill。
const retiredLegacySkillNames = new Set(['business-card-contact-import', 'prompt-engineering-assistant', 'wayfinder']);

if (data.schemaVersion !== 2) errors.push('schemaVersionは2である必要があります。');
if (data.categories.length !== 8) errors.push(`カテゴリ数は8である必要があります（現在 ${data.categories.length}）。`);
if (data.categories[0]?.id !== 'hall-of-fame') errors.push('第1カテゴリは殿堂入りである必要があります。');
if (data.inventory.legacyCount !== legacy.skills.length) errors.push(`旧登録の件数が一致しません（台帳 ${data.inventory.legacyCount}件、正本 ${legacy.skills.length}件）。`);

for (const record of data.records) {
  if (ids.has(record.id)) errors.push(`ID重複: ${record.id}`);
  ids.add(record.id);
  if (!record.name) errors.push(`名前なし: ${record.id}`);
  if (!allowedKinds.has(record.kind)) errors.push(`未知のkind: ${record.id}`);
  if (!categoryIds.has(record.category)) errors.push(`カテゴリ不正: ${record.id}`);
  if (!allowedStatuses.has(record.mirror.status)) errors.push(`同期状態不正: ${record.id}`);
  if (!allowedPortability.has(record.mirror.portability)) errors.push(`移行可否不正: ${record.id}`);
  if (!allowedUsageStatuses.has(record.usage?.status)) errors.push(`利用状況不正: ${record.id}`);
  if (!allowedGovernanceStatuses.has(record.governance?.status) || !record.governance?.reason) errors.push(`必要性判定不正: ${record.id}`);
  if (!Array.isArray(record.requirements)) errors.push(`必要な連携の形式不正: ${record.id}`);
  for (const env of ['codex', 'claude']) {
    if (typeof record.environments[env].installed !== 'boolean') errors.push(`導入状態不正: ${record.id}/${env}`);
    if (!allowedAvailability.has(record.environments[env].availability)) errors.push(`利用状態不正: ${record.id}/${env}`);
    if (record.environments[env].availability === 'installed_unverified' && !record.environments[env].installed) errors.push(`導入済み証跡のない未確認Plugin: ${record.id}/${env}`);
  }
  if (record.kind === 'skill' && !record.environments.codex.configured && !record.environments.claude.configured && record.mirror.status !== 'needs_review') errors.push(`未検出Skillは要確認にしてください: ${record.id}`);
  const publicText = JSON.stringify(record);
  if (/\/Users\/|\\\\Users\\\\|ghp_|github_pat_|Bearer\s/i.test(publicText)) errors.push(`公開禁止情報の疑い: ${record.id}`);
  const uniqueName = record.kind === 'plugin_skill' ? `${record.kind}:${record.source.canonicalId}` : `${record.kind}:${record.name}`;
  if (names.has(uniqueName)) errors.push(`種別内の表示名重複: ${uniqueName}`);
  names.add(uniqueName);
}

const normalSkills = data.records.filter((record) => ['skill', 'builtin_skill', 'plugin_skill'].includes(record.kind));
const mirroringRecords = data.records.filter((record) => record.name === 'manage-codex-claude-mirroring');
if (mirroringRecords.length !== 1) errors.push(`共通正本のミラー管理Skillは1件である必要があります（現在 ${mirroringRecords.length}）。`);
else {
  const mirroringRecord = mirroringRecords[0];
  if (mirroringRecord.source.canonicalId !== 'canonical/skills/manage-codex-claude-mirroring') errors.push('ミラー管理Skillの正本IDが不正です。');
  if (mirroringRecord.kind === 'canonical_skill') {
    if (mirroringRecord.mirror.status !== 'needs_review' || mirroringRecord.environments.codex.configured || mirroringRecord.environments.claude.configured) errors.push('共通正本のミラー管理Skillの未配布状態が不正です。');
  } else if (mirroringRecord.kind !== 'skill' || mirroringRecord.mirror.status !== 'synced' || !mirroringRecord.environments.codex.configured || !mirroringRecord.environments.claude.configured) {
    errors.push('配布済みミラー管理Skillの同期状態が不正です。');
  }
}
for (const capability of data.inventory.capabilities ?? []) {
  if (!capability.id || !capability.name || !['codex', 'claude'].includes(capability.environment)) errors.push(`能力台帳の形式不正: ${capability.id ?? '名前なし'}`);
  if (!allowedAvailability.has(capability.availability)) errors.push(`能力台帳の利用状態不正: ${capability.id}`);
}
const representedLegacyNames = new Set(data.records.flatMap((record) => [...(record.legacy?.legacyNames ?? []), ...(record.aliases ?? [])]));
const missingLegacy = legacy.skills.map((skill) => skill.n).filter((name) => !retiredLegacySkillNames.has(name) && !representedLegacyNames.has(name));
if (missingLegacy.length) errors.push(`旧登録の反映が不足しています: ${missingLegacy.join(', ')}`);
const skillLike = data.records.filter((record) => ['skill', 'canonical_skill', 'builtin_skill', 'plugin_skill'].includes(record.kind));
for (const record of skillLike.filter((record) => record.kind === 'skill' && record.provider.type === 'user')) {
  if (!record.identity?.frontmatterName || !record.source.contentHash?.startsWith('sha256:')) errors.push(`ユーザーSkillの全体照合情報が不足: ${record.id}`);
  if (['codex', 'claude'].filter((env) => record.environments[env].configured).some((env) => !record.environments[env].contentHash?.startsWith('sha256:'))) errors.push(`ユーザーSkillの環境ハッシュが不足: ${record.id}`);
}
for (const record of skillLike) {
  if (new Set(record.aliases ?? []).size !== (record.aliases ?? []).length) errors.push(`別名重複: ${record.id}`);
  if ((record.aliases ?? []).some((alias) => alias.trim().toLocaleLowerCase('ja') === record.name.trim().toLocaleLowerCase('ja'))) errors.push(`自己参照の別名: ${record.id}`);
}
const duplicateGroups = new Map();
for (const record of skillLike) {
  const key = record.name.trim().toLocaleLowerCase('ja');
  duplicateGroups.set(key, [...(duplicateGroups.get(key) ?? []), record]);
}
for (const [name, group] of duplicateGroups) {
  if (group.length < 2) continue;
  const sourceIds = new Set(group.map((record) => record.source.canonicalId));
  if (sourceIds.size < 2) errors.push(`重複候補の正本IDが識別不能: ${name}`);
}
const migrationCandidates = data.inventory.migrationCandidates ?? [];
if (migrationCandidates.length !== 3) errors.push(`移行候補は3件を保持する必要があります（現在 ${migrationCandidates.length}）。`);
for (const candidate of migrationCandidates) {
  if (candidate.recordIds?.length !== 2 || candidate.recordIds.some((id) => !ids.has(id))) errors.push(`移行候補の参照が不正: ${candidate.label ?? '名前なし'}`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(JSON.stringify({
  result: 'ok',
  records: data.records.length,
  normalSkills: normalSkills.length,
  evidence: data.inventory.evidence,
  statuses: Object.fromEntries([...allowedStatuses].map((status) => [status, data.records.filter((record) => record.mirror.status === status).length]))
}, null, 2));
