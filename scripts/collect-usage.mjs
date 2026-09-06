import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';

const DAY_MS = 24 * 60 * 60 * 1000;

const normalize = (value = '') => String(value).trim().toLocaleLowerCase('ja');

async function listJsonlFiles(directory, cutoffMs = 0) {
  const result = [];
  async function visit(current) {
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        const info = await stat(path);
        if (info.mtimeMs >= cutoffMs) result.push(path);
      }
    }
  }
  await visit(directory);
  return result.sort();
}

function recentCodexDirectories(root, now, days) {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(now.getTime() - index * DAY_MS);
    return join(root, String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0'));
  });
}

function addEvidence(index, keys, environment, sessionId, timestamp) {
  for (const rawKey of keys) {
    const key = normalize(rawKey);
    if (!key) continue;
    const previous = index.get(key) ?? { codex: new Map(), claude: new Map() };
    const known = previous[environment].get(sessionId);
    if (!known || String(timestamp) > String(known)) previous[environment].set(sessionId, timestamp);
    index.set(key, previous);
  }
}

function codexPathKeys(path) {
  const plugin = path.match(/\.codex\/plugins\/cache\/([^/]+)\/([^/]+)\/(?:[^/]+\/)*skills\/([^/]+)\/SKILL\.md$/);
  if (plugin) return [`codex-plugin/${plugin[1]}/${plugin[2]}/skills/${plugin[3]}`, plugin[3]];
  const builtin = path.match(/\.codex\/skills\/\.system\/([^/]+)\/SKILL\.md$/);
  if (builtin) return [`codex-system/${builtin[1]}`, builtin[1]];
  const user = path.match(/\.codex\/skills\/([^/]+)\/SKILL\.md$/);
  if (user) return [`skills/${user[1]}`, user[1]];
  return [];
}

function extractCodexSkillPaths(value = '') {
  return [...String(value).matchAll(/\/Users\/nojiri\/\.codex\/(?:skills|plugins\/cache)\/(?:[^/"\\\s]+\/)+SKILL\.md/g)].map((match) => match[0]);
}

async function scanCodexFile(path, index) {
  const sessionId = basename(path, '.jsonl');
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.includes('SKILL.md') || !line.includes('custom_tool_call')) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (row.type !== 'response_item' || row.payload?.type !== 'custom_tool_call') continue;
    const paths = extractCodexSkillPaths(row.payload.input);
    for (const skillPath of paths) addEvidence(index, codexPathKeys(skillPath), 'codex', sessionId, row.timestamp);
  }
}

function claudeSkillNames(value, found = []) {
  if (!value || typeof value !== 'object') return found;
  if (value.type === 'tool_use' && value.name === 'Skill' && value.input?.skill) found.push(String(value.input.skill));
  if (Array.isArray(value)) for (const child of value) claudeSkillNames(child, found);
  else for (const child of Object.values(value)) claudeSkillNames(child, found);
  return found;
}

async function scanClaudeFile(path, index) {
  const sessionId = basename(path, '.jsonl');
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.includes('"name":"Skill"')) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    for (const rawName of claudeSkillNames(row)) {
      const suffix = rawName.includes(':') ? rawName.slice(rawName.lastIndexOf(':') + 1) : rawName;
      addEvidence(index, [rawName, suffix], 'claude', sessionId, row.timestamp);
    }
  }
}

function environmentEvidence(index, keys, environment) {
  const exact = index.get(normalize(keys.sourceId))?.[environment];
  const sources = exact?.size ? [exact] : keys.names.map((name) => index.get(normalize(name))?.[environment]).filter(Boolean);
  const sessions = new Map();
  for (const source of sources) for (const [sessionId, timestamp] of source) {
    const known = sessions.get(sessionId);
    if (!known || String(timestamp) > String(known)) sessions.set(sessionId, timestamp);
  }
  const timestamps = [...sessions.values()].filter(Boolean).sort();
  return { observed: sessions.size > 0, sessionCount: sessions.size, lastUsedAt: timestamps.at(-1) ?? null };
}

export async function collectUsageEvidence({ now = new Date(), days = 7 } = {}) {
  const home = homedir();
  const cutoffMs = now.getTime() - days * DAY_MS;
  const index = new Map();
  const codexDirectories = recentCodexDirectories(join(home, '.codex', 'sessions'), now, days);
  const codexFiles = (await Promise.all(codexDirectories.map((directory) => listJsonlFiles(directory)))).flat();
  const claudeFiles = await listJsonlFiles(join(home, '.claude', 'projects'), cutoffMs);
  for (const path of codexFiles) await scanCodexFile(path, index);
  for (const path of claudeFiles) await scanClaudeFile(path, index);
  return {
    days,
    forRecord(record) {
      const keys = { sourceId: record.source?.canonicalId ?? '', names: [record.name, ...(record.aliases ?? [])] };
      const codex = environmentEvidence(index, keys, 'codex');
      const claude = environmentEvidence(index, keys, 'claude');
      const timestamps = [codex.lastUsedAt, claude.lastUsedAt].filter(Boolean).sort();
      const sessionCount = codex.sessionCount + claude.sessionCount;
      return {
        status: sessionCount ? 'recent_signal' : 'no_signal',
        windowDays: days,
        sessionCount,
        lastUsedAt: timestamps.at(-1) ?? null,
        environments: { codex, claude },
        reason: sessionCount
          ? `直近${days}日間に、CodexでSkill定義参照${codex.sessionCount}セッション、Claudeで明示呼び出し${claude.sessionCount}セッションを確認しました。`
          : `直近${days}日間にSkill定義参照・明示呼び出しは確認できませんでした。未使用の断定ではありません。`
      };
    }
  };
}
