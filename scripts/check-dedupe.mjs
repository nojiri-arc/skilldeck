import { selectSkillCandidate } from './inventory-utils.mjs';

const candidates = [
  { version: '1.10.0', relativePath: '1.10.0/skills/example/SKILL.md' },
  { version: '2.0.0', relativePath: '2.0.0/skills/example/SKILL.md' },
  { version: '1.9.9', relativePath: '1.9.9/skills/example/SKILL.md' }
];
const latest = selectSkillCandidate(candidates);
const installed = selectSkillCandidate(candidates, '1.10.0');
if (latest.version !== '2.0.0' || installed.version !== '1.10.0') {
  throw new Error('Plugin versionの採用規則が不正です。');
}
console.log('Plugin version重複除外検査: ok');
