import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { selectSkillCandidate } from './inventory-utils.mjs';
import { collectUsageEvidence } from './collect-usage.mjs';

const root = resolve(import.meta.dirname, '..');
const outputPath = resolve(root, 'data/skilldeck.json');
const legacyPath = resolve(root, 'data/legacy-skills.json');
const now = new Date().toISOString();
const usageEvidence = await collectUsageEvidence({ now: new Date(now), days: 7 });

const CATEGORIES = [
  { id: 'hall-of-fame', name: 'お気に入り' },
  { id: 'specialized-work', name: '担当業務特化' },
  { id: 'adv', name: 'ADV関連' },
  { id: 'development-ai', name: '開発・AI管理' },
  { id: 'sales-customer', name: '営業・顧客対応' },
  { id: 'ads-analysis', name: '広告・分析' },
  { id: 'materials-design', name: '資料・デザイン' },
  { id: 'meeting-writing-translation', name: '会議・文章・翻訳' },
  { id: 'task-operations', name: 'タスク・業務運用' }
];

// トシが「お気に入り」「おすすめ」として指定したSkillだけをここへ登録する。
const HALL_OF_FAME_SKILLS = new Set(['strict-recheck-and-refine', 'todo-add', 'elegant-prompt', 'communication-approval', 'shiryo-slides', 'shiryo-slides-hub', 'visual-management-board', 'cloudflare-web-publish', 'minutes-full-flow', 'pj-board', 'slack-to-reply-draft', 'link-collection', 'independent-review-session']);

// トシが公開対象から除外するよう指定したレコード。実体の削除や自動化の停止は行わない。
const PUBLIC_RECORD_EXCLUSIONS = new Set(['automation.claude.yuiitsu-offline-cv-import-check', 'automation.claude.yuiitsu-offline-cv-import-recheck-0915', 'automation.claude.zz-flowtest-child', 'automation.claude.zz-flowtest-parent', 'automation.claude.zz-flowtest-parent2']);

// 環境差分の精査でトシが明示的に「保持」を選んだ旧登録。
// 現在の環境では未検出でも、削除候補には戻さない。
const governanceOverrides = new Map([
  ['claude-in-chrome', 'トシが保持を選択。Chrome操作をClaudeで行いたいときのために旧登録を残します。'],
  ['cowork-plugin', 'トシが保持を選択。Cowork Pluginの作成・調整用途として旧登録を残します。'],
  ['cowork-plugin-management:cowork-plugin-customizer', 'トシが保持を選択。既存Cowork Pluginのカスタマイズ用途として旧登録を残します。'],
  ['cowork-plugin-management:create-cowork-plugin', 'トシが保持を選択。Cowork Pluginを新規作成する用途として旧登録を残します。'],
  ['docx', 'トシが保持を選択。Word文書を扱う用途として旧登録を残します。'],
  ['explain-usage', 'トシが保持を選択。利用量の説明用途として旧登録を残します。'],
  ['pptx', 'トシが保持を選択。PowerPoint資料を扱う用途として旧登録を残します。'],
  ['setup-cowork', 'トシが保持を選択。Coworkの初期設定用途として旧登録を残します。']
]);

// legacy-skills.json は89件で凍結されているため、新規skillの日本語説明と依頼例はここで補う。
const userTextOverrides = new Map([
  ['strict-recheck-and-refine', {
    description: '検品スキル。作業後に別のAIが厳しめに見直し、必要な修正まで行う最終チェック用のSkillです。',
    example: '厳しめの再確認をお願い！'
  }],
  ['elegant-prompt', {
    description: '重要なAI依頼を送る前に、目的・成果物・合格／失格条件・証拠・テスト・終了条件・権限の境界を明確にし、制作AI用と独立検品AI用の依頼文を作るSkillです。',
    example: '依頼文精査お願い！'
  }],
  ['obsidian-record', {
    description: 'メモ・ナレッジ・方針を、Obsidian Vaultのルールどおりの場所・項目で保存するSkillです。会議の議事録は「議事録まるっと」（minutes-full-flow）が入口になり、保存の手順としてこのSkillを使います。',
    example: 'Obsidianに記録して'
  }],
  ['communication-approval', {
    description: 'Gmailを基本に、指定されたSlack／LINEのやり取りを「確認→返信文案→個別承認後に送信」まで扱うSkillです。社外Slackでは、メンションと宛名を重ねず、既決条件を再掲せず、目的を添えた日程提案・読みやすい段落構成・明確な締めまで整えます。会話内の日程返信案は作成できますが、「スケ調整お願い」「スケジュール調整お願い」だけでは起動せず、送信やカレンダー登録も勝手に行いません。',
    example: 'コミュニケーションツールの横断確認お願い！'
  }],
  ['todo-add', {
    description: 'ADV MyシートのTODOタブへ、会社・大項目・中項目・TODO詳細・対応日を既存の並び順と書式どおりに1行追加する。分類は文脈から推測し、対応日だけ不明なら確認する。',
    example: 'TODO追加！'
  }],
  ['cloudflare-web-publish', {
    description: 'このMacで作った静的サイト・HTMLアプリを、GitHubリポジトリとCloudflare PagesのGit連携で初めてWeb公開するSkillです。以降はpushするだけで自動で反映されます。トークンをURLに埋め込まず、公開範囲とGitHub Appの認可は事前に確認します。公開済みサイトの更新だけならサイト専用の更新手順を使います。',
    example: 'Cloudflareでweb化して'
  }],
  ['shiryo-slides', {
    description: '議事録やメモから、社内資料・提案資料をページ形式のHTMLスライドで作るSkillです。最初にスタイル・用途・5テーマを選び、Playwrightで崩れを確認し、完成後はHTMLライブラリへ下書き登録します。PPTXやGoogle Slidesを明示された場合だけ別の資料Skillを使います。',
    example: 'この議事録から提案資料を作って'
  }],
  ['shiryo-slides-hub', {
    description: '資料作成の共通入口です。ADV標準を先頭に6テーマから選び、ADV資料を含む社内資料・提案資料をページ形式のHTMLスライドで作り、HTMLライブラリへ下書き登録します。PPTXやGoogle Slidesを明示された場合だけ、それぞれの資料Skillへ振り分けます。',
    example: 'ADV資料をHTMLで作って'
  }],
  ['visual-management-board', {
    description: 'プロダクトの状態、方針、ロードマップ、意思決定の変化を、縦スクロールで読める一枚のHTMLに整理するSkillです。正式記録やデータを根拠にし、完成後はHTMLライブラリへスクロールビジュアルとして下書き登録します。',
    example: 'このプロダクトの状態をスクロール形式で見える化して'
  }],
  ['minutes-full-flow', {
    description: '会議の文字起こしやメモを渡すと、Obsidianへの議事録保存、PJの現在地・決定ログ、Slack「#team-営業議事録」への下書き、TODO候補の番号付き確認とTask Depot登録、PJボードの更新までを1回で進めるSkillです。',
    example: 'この議事録登録して'
  }],
  ['pj-board', {
    description: '担当PJの現在地・全体像と戦略・進行表・会議ごとの決定・次回MTGの準備と、全案件のリンク検索を、タブで切り替える1つのページ（全案件PJボード）にまとめ、Obsidianのノートとリンク集から作り直して同じURLへ上書き公開するSkillです。会議前のアジェンダ作りにも使います。',
    example: 'ゆとりの空間のPJボード更新して'
  }],
  ['slack-to-reply-draft', {
    description: '登録した11チャンネルで自分宛てにメンションされた未返信の投稿を集め、会話ごとにトシの文体で返信案をチャットに出すSkillです。最後に出る選択ボタンで選んだ件だけ、その場でスレッドに送信します（下書きに入れるだけも可）。',
    example: 'Slack TO返信案'
  }],
  ['link-collection', {
    description: 'シート・レポート・Driveフォルダ・資料・管理画面のリンクを、ObsidianのPJごとのリンク集へ別名つきで追加し、全案件PJボードを組み立て直して同じURLへ公開するSkillです。「〇〇のリンクどこ？」と聞けば、リンク集からDriveまで探して返します。',
    example: 'リンク追加！'
  }],
  ['independent-review-session', {
    description: '成果物を、作ったAIとは別の会社のAI（ClaudeならCodex、CodexならClaude）で、会話履歴のない使い捨てセッションに1回だけ検品させるSkillです。渡すのは仕様・合格条件・成果物・証拠の4つだけで、制作の会話や自己評価は渡さず、合格／差戻し／判定不能を根拠つきで返します。毎回・自動では起こさず、「検品！」と頼んだときだけ動きます。',
    example: 'この成果物を検品！'
  }]
]);

// メイン表示は英語のSkill IDに統一し、日本語名がある場合だけ補助表示する。
const japaneseNameOverrides = new Map([
  ['elegant-prompt', 'エレガント・プロンプト'],
  ['obsidian-record', 'Obsidian記録'],
  ['cloudflare-web-publish', 'Cloudflare Web公開'],
  ['shiryo-slides-hub', '資料作成キット（ADV対応）'],
  ['visual-management-board', '視覚管理ボード'],
  ['minutes-full-flow', '議事録まるっと'],
  ['pj-board', 'PJボード'],
  ['slack-to-reply-draft', 'Slack TO返信案'],
  ['link-collection', 'リンク集'],
  ['independent-review-session', '使い捨て検品セッション']
]);

const providerNameOverrides = new Map();

// 外部提供のSkillは、配布先がトシの環境でも由来を自作として表示しない。
const providerOverrides = new Map([
  ['shiryo-slides', { type: 'external', name: 'code4biz/shiryo-slides-kit' }]
]);

const projectTagOverrides = new Map([
  ['obsidian-record', ['AI運用']]
]);

const userTriggerOverrides = new Map([
  ['communication-approval', ['コミュニケーションツールの横断確認お願い！', 'チャット系の横断確認お願い！', '$communication-approval']],
  ['obsidian-record', ['Obsidianに記録して', 'メモしといて', '方針更新して', '$obsidian-record']],
  ['shiryo-slides', ['資料を作って', '提案書を作って', 'スライドにして', '議事録から資料に', '$shiryo-slides']],
  ['shiryo-slides-hub', ['資料を作って', '提案書を作って', 'ADV資料をHTMLで作って', '議事録から資料に', '$shiryo-slides-hub']],
  ['visual-management-board', ['プロダクト状態を視覚化して', '方針を一枚で見える化して', 'スクロール形式でまとめて', '視覚管理ボードを作って', '$visual-management-board']],
  ['minutes-full-flow', ['議事録登録して', '議事録まるっと', '議事録とTODOお願い', '$minutes-full-flow']],
  ['pj-board', ['〇〇のPJボード作って', 'PJボード更新して', '〇〇のMTG準備して', 'PJボードのタブを〇〇の順にして', '$pj-board']],
  ['slack-to-reply-draft', ['Slack TO返信案', 'TO返信案', 'Slackの返信案出して', '$slack-to-reply-draft']],
  ['link-collection', ['リンク追加！', '〇〇のリンクどこ？', 'リンク集に登録して', '$link-collection']],
  ['independent-review-session', ['検品！', '検品して', '独立検品して', '別AIで検品して', 'Codexで検品して', '使い捨て検品', '$independent-review-session']]
]);

// 同期の事実と実動テストの事実を混同しないための、個別検証状態。
const userVerificationOverrides = new Map([
  ['elegant-prompt', {
    codex: { availability: 'verified', evidenceType: 'clean_room_test' },
    claude: { availability: 'installed_unverified', evidenceType: 'file_hash_verified', verificationNote: 'ファイル配置・ハッシュ一致を確認。実動テストは未実施。' }
  }],
  ['manage-codex-claude-mirroring', {
    codex: { availability: 'verified', evidenceType: 'verified_runtime' },
    claude: { availability: 'installed_unverified', evidenceType: 'file_hash_verified', verificationNote: 'ファイル配置・ハッシュ一致を確認。実動テストは未実施。' }
  }],
  ['obsidian-record', {
    codex: { availability: 'installed_unverified', evidenceType: 'file_hash_verified', verificationNote: 'ファイル配置・ハッシュ一致を確認。新しい会話での実動テストは未実施。' },
    claude: { availability: 'installed_unverified', evidenceType: 'file_hash_verified', verificationNote: 'ファイル配置・ハッシュ一致を確認。新しい会話での実動テストは未実施。' }
  }],
  ['cloudflare-web-publish', {
    codex: { availability: 'installed_unverified', evidenceType: 'file_hash_verified', verificationNote: 'ファイル配置・ハッシュ一致を確認。新しい会話での実動テストは未実施。' },
    claude: { availability: 'installed_unverified', evidenceType: 'file_hash_verified', verificationNote: 'ファイル配置・ハッシュ一致を確認。新しい会話での実動テストは未実施。' }
  }],
  ['shiryo-slides', {
    codex: { availability: 'installed_unverified', evidenceType: 'file_hash_verified', verificationNote: 'ファイル配置・ハッシュ一致を確認。新しい会話での実動テストは未実施。' },
    claude: { availability: 'installed_unverified', evidenceType: 'file_hash_verified', verificationNote: 'ファイル配置・ハッシュ一致を確認。新しい会話での実動テストは未実施。' }
  }],
  ['shiryo-slides-hub', {
    codex: { availability: 'installed_unverified', evidenceType: 'file_hash_verified', verificationNote: 'ファイル配置・ハッシュ一致を確認。新しい会話での実動テストは未実施。' },
    claude: { availability: 'installed_unverified', evidenceType: 'file_hash_verified', verificationNote: 'ファイル配置・ハッシュ一致を確認。新しい会話での実動テストは未実施。' }
  }],
  ['visual-management-board', {
    codex: { availability: 'installed_unverified', evidenceType: 'file_hash_verified', verificationNote: 'ファイル配置・ハッシュ一致を確認。新しい会話での実動テストは未実施。' },
    claude: { availability: 'installed_unverified', evidenceType: 'file_hash_verified', verificationNote: 'ファイル配置・ハッシュ一致を確認。新しい会話での実動テストは未実施。' }
  }],
  ['minutes-full-flow', {
    codex: { availability: 'installed_unverified', evidenceType: 'file_hash_verified', verificationNote: 'ファイル配置・ハッシュ一致を確認。新しい会話での実動テストは未実施。' },
    claude: { availability: 'installed_unverified', evidenceType: 'file_hash_verified', verificationNote: 'ファイル配置・ハッシュ一致を確認。新しい会話での実動テストは未実施。' }
  }],
  ['pj-board', {
    codex: { availability: 'installed_unverified', evidenceType: 'file_hash_verified', verificationNote: 'ファイル配置・ハッシュ一致を確認。新しい会話での実動テストは未実施。' },
    claude: { availability: 'installed_unverified', evidenceType: 'file_hash_verified', verificationNote: 'ファイル配置・ハッシュ一致を確認。2026-09-17 にゆとりの空間のPJボードを作って公開した。新しい会話での実動テストは未実施。' }
  }],
  ['slack-to-reply-draft', {
    codex: { availability: 'installed_unverified', evidenceType: 'file_hash_verified', verificationNote: 'ファイル配置・ハッシュ一致を確認。新しい会話での実動テストは未実施。' },
    claude: { availability: 'installed_unverified', evidenceType: 'file_hash_verified', verificationNote: 'ファイル配置・ハッシュ一致を確認。2026-09-17 に11チャンネルのメンション検索条件を実データで確認した。新しい会話での実動テストは未実施。' }
  }],
  ['link-collection', {
    codex: { availability: 'installed_unverified', evidenceType: 'file_hash_verified', verificationNote: 'ファイル配置・ハッシュ一致を確認。新しい会話での実動テストは未実施。' },
    claude: { availability: 'installed_unverified', evidenceType: 'file_hash_verified', verificationNote: 'ファイル配置・ハッシュ一致を確認。2026-09-17 に全7案件のリンク集（134件）を作り、全案件PJボードの検索に載せた。新しい会話での実動テストは未実施。' }
  }],
  ['independent-review-session', {
    codex: { availability: 'installed_unverified', evidenceType: 'file_hash_verified', verificationNote: 'ファイル配置・ハッシュ一致を確認。2026-09-17 に新しい会話でこのSkillが選ばれること、Codexを検品者にした起動（差戻し・合格の両ケース）を確認。Skill経由の実動テストは未実施。' },
    claude: { availability: 'installed_unverified', evidenceType: 'file_hash_verified', verificationNote: 'ファイル配置・ハッシュ一致を確認。2026-09-17 に新しい会話でこのSkillが選ばれること、Claudeを検品者にした起動（差戻し）を確認。Skill経由の実動テストは未実施。' }
  }]
]);

const aliases = new Map();
// 実体と登録の両方を廃止したSkill。凍結した旧一覧からも再表示しない。
const retiredSkillNames = new Set(['business-card-contact-import', 'wayfinder', 'prompt-engineering-assistant', 'ai-workflow-consultant', 'skill-registry-update', 'calendar-event-and-meet-link',
  // 2026-09-14 トシ承認で退役（SkillDeck精査で不要と判断）。
  'codex:setup', 'codex:review', 'codex:adversarial-review', 'codex:rescue', 'codex:transfer', 'codex:status', 'codex:result', 'codex:cancel', 'mission-control-daily-brief', 'discord-ai-relay', 'create-chatgpt-project', 'sequential-task-execution', 'grill-me', 'grill-with-docs', 'ask-matt', 'setup-matt-pocock-skills', 'to-spec', 'to-tickets', 'implement', 'tdd', 'teach', 'prototype', 'slide-outline-generator', 'funny-gif', 'japanese-english-translator', 'japanese-korean-translator', 'artifact-template-adv-2', 'sso-quick-diagnostics', 'communication-detection',
  // 2026-09-15 トシ承認で退役（統括AI・案件長が前提の旧体制の施策スキル）。
  'strategy-execution-orchestrator', 'initiative-progress-manager']);
const categoryByName = new Map([
  ['artifact-template-adv-1', 'materials-design'],
  ['artifact-template-adv-2', 'materials-design'], ['artifact-template-jra', 'materials-design'],
  ['adv-business-knowledge', 'development-ai'], ['adv-shiryo-sakusei', 'materials-design'],
  ['adv-shiyo-gijiroku', 'meeting-writing-translation'], ['aso-internal-order-request', 'task-operations'],
  ['aso-simulation-and-order-request', 'task-operations'], ['aso-simulation-intake', 'task-operations'],
  ['catchphrase-ideation', 'meeting-writing-translation'],
  ['obsidian-record', 'meeting-writing-translation'],
  ['calendar-event-and-meet-link', 'task-operations'], ['customer-icebreaker-research', 'sales-customer'],
  ['code-review', 'development-ai'], ['communication-approval', 'task-operations'],
  ['competitive-service-research', 'ads-analysis'], ['create-chatgpt-project', 'development-ai'],
  ['design-qc', 'materials-design'], ['domain-modeling', 'development-ai'], ['funny-gif', 'materials-design'],
  ['draft-client-proposal', 'sales-customer'], ['draft-sales-email', 'sales-customer'],
  ['existing-attacker', 'sales-customer'], ['makeleaps-client-registration', 'task-operations'],
  ['makeleaps-orderslip-creation', 'task-operations'], ['meeting-minutes-notion-registration', 'meeting-writing-translation'],
  ['mtg-after-automation', 'task-operations'], ['new-attacker', 'sales-customer'],
  ['pipedrive-manage-sales', 'sales-customer'], ['post-order-operations-router', 'task-operations'],
  ['google-ads-consultant', 'ads-analysis'], ['grill-with-docs', 'development-ai'], ['grilling', 'development-ai'],
  ['implement', 'development-ai'], ['japanese-english-translator', 'meeting-writing-translation'],
  ['japanese-korean-translator', 'meeting-writing-translation'], ['kimono-brain-todo-management', 'task-operations'],
  ['mission-control-daily-brief', 'task-operations'], ['pc-lightening', 'development-ai'],
  ['plan-landing-page', 'materials-design'],
  ['prototype', 'development-ai'], ['research', 'ads-analysis'], ['setup-matt-pocock-skills', 'development-ai'],
  ['review-cleaning-sales-sheet-update', 'task-operations'], ['review-cleaning-sheet-setup', 'task-operations'],
  ['review-screenshot-automation-setup', 'task-operations'], ['review-screenshot-daily-operations', 'task-operations'],
  ['review-screenshot-reflection', 'task-operations'], ['sales-deal-lifecycle-router', 'sales-customer'],
  ['sales-sheet-update', 'task-operations'], ['skill-registry-update', 'development-ai'],
  ['slide-outline-generator', 'materials-design'], ['sso-quick-diagnostics', 'ads-analysis'],
  ['task-collection-daily-brief', 'task-operations'], ['tdd', 'development-ai'], ['teach', 'meeting-writing-translation'], ['to-spec', 'development-ai'],
  ['todo-share-table', 'task-operations'],
  ['to-tickets', 'development-ai'], ['yuiitsu-ad-reporting', 'ads-analysis'],
  ['yuiitsu-before-after-posts', 'materials-design'], ['yuiitsu-daily-ads-analysis', 'ads-analysis']
]);

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function canonicalName(name) {
  return aliases.get(name) ?? name;
}

function normalizeWhitespace(value = '') {
  return value.replace(/\s+/g, ' ').trim();
}

function readFrontmatter(text) {
  const block = text.match(/^---\s*\n([\s\S]*?)\n---/);
  const source = block?.[1] ?? '';
  const get = (key) => normalizeWhitespace(source.match(new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, 'm'))?.[1] ?? '');
  return { name: get('name'), description: get('description'), canonicalId: get('canonical_id') || get('id') };
}

async function isDirectory(path) {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
}

async function scanSkills(directory) {
  if (!(await isDirectory(directory))) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const skillPath = join(directory, entry.name, 'SKILL.md');
    try {
      const text = await readFile(skillPath, 'utf8');
      const meta = readFrontmatter(text);
      result.push({ folder: entry.name, name: meta.name || entry.name, canonicalId: meta.canonicalId || null, description: meta.description, hash: await hashManagedDirectory(join(directory, entry.name)) });
    } catch { /* SKILL.mdのないフォルダは対象外 */ }
  }
  return result.sort((a, b) => a.folder.localeCompare(b.folder));
}

async function hashManagedDirectory(directory) {
  const entries = [];
  async function visit(current) {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['.DS_Store', 'Thumbs.db', 'desktop.ini', '.git'].includes(entry.name)) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) entries.push(path);
    }
  }
  await visit(directory);
  const hash = createHash('sha256');
  for (const path of entries) {
    hash.update(relative(directory, path));
    hash.update('\0');
    hash.update(await readFile(path));
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

async function scanMarkdownDirectory(directory) {
  if (!(await isDirectory(directory))) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const text = await readFile(join(directory, entry.name), 'utf8');
    const meta = readFrontmatter(text);
    result.push({ name: meta.name || basename(entry.name, '.md'), description: meta.description, hash: sha256(text) });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

async function walkFiles(directory, matcher, { includeHidden = false } = {}) {
  if (!(await isDirectory(directory))) return [];
  const found = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (!includeHidden && entry.name.startsWith('.')) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (matcher(entry.name, path)) found.push(path);
    }
  }
  await visit(directory);
  return found.sort();
}

async function scanPluginSkills(directory, { preferredVersion = null } = {}) {
  const paths = await walkFiles(directory, (name) => name === 'SKILL.md');
  const candidates = [];
  for (const path of paths) {
    const text = await readFile(path, 'utf8');
    const meta = readFrontmatter(text);
    const relativePath = relative(directory, path);
    const firstSegment = relativePath.split('/')[0];
    candidates.push({ folder: basename(dirname(path)), name: meta.name || basename(dirname(path)), description: meta.description, hash: sha256(text), path, relativePath, version: firstSegment === 'skills' || firstSegment.startsWith('.') ? basename(directory) : firstSegment });
  }
  // 同じPluginの複数versionや同じSkillの重複は、最新版相当の1件だけを採用する。
  const grouped = new Map();
  for (const candidate of candidates) grouped.set(canonicalName(candidate.name), [...(grouped.get(canonicalName(candidate.name)) ?? []), candidate]);
  const unique = new Map([...grouped.entries()].map(([name, group]) => [name, selectSkillCandidate(group, preferredVersion)]));
  return { skills: [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, 'ja')), rawCount: candidates.length, duplicateExclusions: candidates.length - unique.size };
}

async function listCodexCachePackages(cacheRoot) {
  if (!(await isDirectory(cacheRoot))) return [];
  const packages = [];
  for (const market of await readdir(cacheRoot, { withFileTypes: true })) {
    if (!market.isDirectory() || market.name.startsWith('.')) continue;
    const marketPath = join(cacheRoot, market.name);
    for (const plugin of await readdir(marketPath, { withFileTypes: true })) {
      if (!plugin.isDirectory() || plugin.name.startsWith('.')) continue;
      packages.push({ marketplace: market.name, plugin: plugin.name, directory: join(marketPath, plugin.name) });
    }
  }
  return packages.sort((a, b) => `${a.marketplace}/${a.plugin}`.localeCompare(`${b.marketplace}/${b.plugin}`));
}

function parseEnabledCodexPlugins(configText) {
  return [...configText.matchAll(/^\[plugins\."([^"]+)"\]\s*\n\s*enabled\s*=\s*true/mg)].map((match) => {
    const at = match[1].lastIndexOf('@');
    return { key: match[1], plugin: match[1].slice(0, at), marketplace: match[1].slice(at + 1) };
  });
}

function makePortability(value = 'requires_review') {
  return value;
}

function isAdvSkill(name, legacy) {
  return legacy?.c === 1 || name.startsWith('adv-') || ['new-attacker', 'existing-attacker', 'pipedrive-manage-sales', 'sales-sheet-update', 'post-order-operations-router', 'sales-deal-lifecycle-router'].includes(name);
}

function projectTags(name, legacy) {
  if (isAdvSkill(name, legacy)) return ['ADV'];
  if (name.startsWith('yuiitsu-') || name === 'kimono-brain-todo-management') return ['ゆいいつ', 'きものブレイン'];
  return [];
}

const SPECIALIZED_WORK_SKILLS = new Set([
  'adv-new-attacker',
  'task-depot-sync-now',
  'todo-share-table',
  'yuiitsu-ad-reporting',
  'yuiitsu-before-after-posts',
  'yuiitsu-daily-ads-analysis',
]);

function isSpecializedWorkSkill(name) {
  return SPECIALIZED_WORK_SKILLS.has(name);
}

function categoryFor(name, legacy) {
  if (HALL_OF_FAME_SKILLS.has(name)) return 'hall-of-fame';
  if (isSpecializedWorkSkill(name)) return 'specialized-work';
  if (isAdvSkill(name, legacy)) return 'adv';
  if (categoryByName.has(name)) return categoryByName.get(name);
  if (name.startsWith('adv-') || name.includes('sales') || name.includes('order') || name.includes('customer')) return 'sales-customer';
  if (name.includes('ads') || name.includes('report') || name.includes('research') || name.includes('analysis')) return 'ads-analysis';
  if (name.includes('template') || name.includes('design') || name.includes('slide') || name.includes('gif')) return 'materials-design';
  if (name.includes('meeting') || name.includes('minutes') || name.includes('translation') || name.includes('email')) return 'meeting-writing-translation';
  if (name.includes('task') || name.includes('daily') || name.includes('approval') || name.includes('calendar')) return 'task-operations';
  return 'development-ai';
}

function legacyDetails(legacy) {
  if (!legacy) return {};
  return { description: legacy.d, example: legacy.e, origin: legacy.o, legacyNames: [legacy.n] };
}

function mirrorStatus(record) {
  const codex = record.environments.codex;
  const claude = record.environments.claude;
  const codexPresent = codex.configured || codex.installed;
  const claudePresent = claude.configured || claude.installed;
  if (record.mirror.eligible === false) return record.mirror.status;
  if (codexPresent && claudePresent && codex.contentHash === claude.contentHash) return 'synced';
  if (codexPresent && claudePresent) return 'needs_review';
  if (codexPresent) return 'codex_only';
  if (claudePresent) return 'claude_only';
  return 'needs_review';
}

function governanceFor(record) {
  const usage = record.usage;
  const hasEnvironmentEvidence = ['codex', 'claude'].some((environment) => record.environments[environment].configured || record.environments[environment].installed);
  const overrideReason = governanceOverrides.get(record.name);
  if (overrideReason) return { status: 'keep_recommended', actionScope: 'skilldeck_record', reason: overrideReason };
  if (record.kind === 'builtin_skill') {
    return { status: 'keep_required', actionScope: 'none', reason: 'ベンダー提供の組み込みSkillです。個別削除ではなく、環境の標準機能として保持します。' };
  }
  if (usage.status === 'recent_signal') {
    return { status: 'keep_recommended', actionScope: record.kind === 'plugin_skill' ? 'plugin_package' : 'skill', reason: `直近${usage.windowDays}日間の利用シグナルがあるため保持推奨です。` };
  }
  if (!hasEnvironmentEvidence && record.provider.type === 'legacy') {
    return { status: 'delete_candidate', actionScope: 'skilldeck_record', reason: '旧SkillDeckには登録されていますが、現在のCodex／Claude環境では検出されず、直近利用も確認できないため削除候補です。' };
  }
  if (record.kind === 'plugin_skill') {
    return { status: 'needs_review', actionScope: 'plugin_package', reason: '個別SkillではなくPlugin単位で、他の同梱Skill・依存機能と一緒に必要性を確認します。' };
  }
  if (record.provider.type === 'user') {
    return { status: 'needs_review', actionScope: 'skill', reason: 'ユーザー作成Skillのため自動削除しません。役割重複と今後の利用予定を確認して判断します。' };
  }
  return { status: 'needs_review', actionScope: 'skill', reason: '利用履歴だけでは不要と断定できません。提供元・依存関係・代替機能を確認して判断します。' };
}

function makeEnvironment(configured = false, invocation = null, detectedBy = null, contentHash = null, availability = 'verified', installed = configured, evidenceType = configured ? 'verified_runtime' : 'none') {
  return { configured, installed, invocation, detectedBy, contentHash, availability, evidenceType };
}

const legacyInput = JSON.parse(await readFile(legacyPath, 'utf8'));
const legacyByName = new Map(legacyInput.skills.map((skill) => [canonicalName(skill.n), skill]));
const records = new Map();
const capabilities = [];
let capabilitySequence = 0;
const capabilitySequences = new Map([['MCP', 0], ['App', 0], ['能力', 0]]);
const evidenceSummary = {
  codex: { enabledPluginPackages: 0, remoteInstallMarkers: 0, marketplaceSourcePackages: 0, marketplaceSourceSkillFiles: 0, cachePhysicalSkillFiles: 0, nonRuntimeSkillDefinitions: 0, cacheOnlySkillFiles: 0, pluginSkillFilesConsidered: 0, duplicateExclusions: 0 },
  claude: { enabledPluginPackages: 0, installedPluginPackages: 0, installMarkers: 0, marketplaceSourcePackages: 0, marketplaceSourceSkillFiles: 0, cachePhysicalSkillFiles: 0, nonRuntimeSkillDefinitions: 0, cacheOnlySkillFiles: 0, pluginSkillFilesConsidered: 0, duplicateExclusions: 0 }
};

function addCapability({ id, name, environment, evidenceType, availability, reason }) {
  // 元のPluginキーや外部IDは棚卸し判定にのみ使い、公開データには出さない。
  capabilitySequence += 1;
  const normalized = String(name).toLocaleLowerCase('en');
  const type = normalized.includes('mcp') ? 'MCP' : /browser|chrome|computer-use|gmail|slack|calendar|pipedrive/.test(normalized) ? 'App' : '能力';
  const number = (capabilitySequences.get(type) ?? 0) + 1;
  capabilitySequences.set(type, number);
  const safeLabel = `${type}記録 ${String(number).padStart(2, '0')}`;
  capabilities.push({ id: `capability-${capabilitySequence}`, name: safeLabel, type, environment, evidenceType, availability, reason, lastVerifiedAt: now });
}

function upsert(record) {
  const previous = records.get(record.id);
  if (previous) {
    for (const env of ['codex', 'claude']) {
      if (record.environments[env].configured) previous.environments[env] = record.environments[env];
    }
    previous.aliases = [...new Set([...(previous.aliases ?? []), ...(record.aliases ?? [])])];
    if (!previous.description && record.description) previous.description = record.description;
    return previous;
  }
  records.set(record.id, record);
  return record;
}

const normalizeUserToken = (value = '') => canonicalName(String(value).trim()).toLocaleLowerCase('ja');
const userSourceId = (value) => `skills/${canonicalName(String(value).trim().replace(/^skills\//, ''))}`;

function findUserRecord(skill) {
  const candidates = [...records.values()].filter((record) => record.kind === 'skill');
  const canonicalId = skill.canonicalId ? userSourceId(skill.canonicalId) : null;
  if (canonicalId) {
    const match = candidates.find((record) => record.source.canonicalId === canonicalId);
    if (match) return match;
  }
  if (skill.name) {
    const match = candidates.find((record) => normalizeUserToken(record.identity?.frontmatterName) === normalizeUserToken(skill.name));
    if (match) return match;
  }
  const byHash = candidates.find((record) => record.source.contentHash === skill.hash || ['codex', 'claude'].some((env) => record.environments[env].contentHash === skill.hash));
  if (byHash) return byHash;
  const aliasesForSkill = [skill.folder, skill.name].filter(Boolean).map(normalizeUserToken);
  return candidates.find((record) => aliasesForSkill.some((alias) => normalizeUserToken(record.name) === alias || record.aliases.some((knownAlias) => normalizeUserToken(knownAlias) === alias)));
}

function makeUserRecord(skill, env) {
  const skillId = canonicalName(skill.canonicalId || skill.name || skill.folder);
  const displayName = skillId;
  const legacy = legacyByName.get(skillId);
  const existing = findUserRecord(skill);
  const rawName = String(existing?.name ?? displayName).trim().toLocaleLowerCase('ja');
  const aliasValues = [skill.folder, skill.name].filter((value) => String(value).trim().toLocaleLowerCase('ja') !== rawName);
  const record = existing ?? {
    id: `user.${skillId}`,
    kind: 'skill',
    name: displayName,
    ...(japaneseNameOverrides.has(skillId) ? { japaneseName: japaneseNameOverrides.get(skillId) } : {}),
    aliases: [],
    description: userTextOverrides.get(skillId)?.description ?? legacy?.d ?? skill.description ?? '説明は要確認です。',
    example: userTextOverrides.get(skillId)?.example ?? legacy?.e ?? '',
    category: categoryFor(skillId, legacy),
    projectTags: projectTagOverrides.get(skillId) ?? projectTags(skillId, legacy),
    provider: providerOverrides.get(skillId) ?? { type: 'user', name: providerNameOverrides.get(skillId) ?? 'トシ用に作成' },
    source: { canonicalId: userSourceId(skill.canonicalId || skillId), contentHash: null },
    identity: { frontmatterName: skill.name || null },
    triggers: userTriggerOverrides.get(skillId) ?? [],
    environments: { codex: makeEnvironment(), claude: makeEnvironment() },
    mirror: { eligible: true, status: 'needs_review', reasonCode: null, reason: null },
    requirements: [],
    legacy: legacyDetails(legacy),
    lastVerifiedAt: now
  };
  records.set(record.id, record);
  record.name = displayName;
  record.provider = providerOverrides.get(skillId) ?? { type: 'user', name: providerNameOverrides.get(skillId) ?? 'トシ用に作成' };
  if (japaneseNameOverrides.has(skillId)) record.japaneseName = japaneseNameOverrides.get(skillId);
  else delete record.japaneseName;
  record.aliases = [...new Set([...record.aliases, ...aliasValues])];
  record.environments[env] = {
    ...makeEnvironment(true, env === 'codex' ? `$${skillId}` : `/${skillId}`, 'user-skill-directory', skill.hash),
    ...(userVerificationOverrides.get(skillId)?.[env] ?? {})
  };
  record.source.contentHash ??= skill.hash;
}

const home = homedir();
const [codexUserSkills, claudeUserSkills, codexBuiltinSkills, claudeAutomation] = await Promise.all([
  scanSkills(join(home, '.codex', 'skills')),
  scanSkills(join(home, '.claude', 'skills')),
  scanSkills(join(home, '.codex', 'skills', '.system')),
  scanSkills(join(home, '.claude', 'scheduled-tasks'))
]);

for (const skill of codexUserSkills) makeUserRecord(skill, 'codex');
for (const skill of claudeUserSkills) makeUserRecord(skill, 'claude');

const canonicalMirroringSkillDirectory = process.env.SKILLDECK_CANONICAL_SKILL_DIR
  ? resolve(process.env.SKILLDECK_CANONICAL_SKILL_DIR)
  : resolve(root, '..', 'skill-mirror', 'canonical', 'skills', 'manage-codex-claude-mirroring');
const canonicalMirroringSkillPath = join(canonicalMirroringSkillDirectory, 'SKILL.md');
const canonicalMirroringText = await readFile(canonicalMirroringSkillPath, 'utf8');
const canonicalMirroringMeta = readFrontmatter(canonicalMirroringText);
const canonicalMirroringName = canonicalMirroringMeta.name || 'manage-codex-claude-mirroring';
const canonicalMirroringHash = await hashManagedDirectory(canonicalMirroringSkillDirectory);
const distributedMirroringRecord = [...records.values()].find((record) => record.kind === 'skill' && normalizeUserToken(record.name) === normalizeUserToken(canonicalMirroringName));
if (distributedMirroringRecord) {
  distributedMirroringRecord.source.canonicalId = 'canonical/skills/manage-codex-claude-mirroring';
  distributedMirroringRecord.source.contentHash = canonicalMirroringHash;
} else {
  upsert({
    id: 'canonical.manage-codex-claude-mirroring',
    kind: 'canonical_skill',
    name: canonicalMirroringName,
    aliases: [],
    description: canonicalMirroringMeta.description || 'CodexとClaude間のSkill・共通指示の配布状態を管理する共通正本です。',
    example: '',
    category: 'development-ai',
    projectTags: [],
    provider: { type: 'user', name: 'トシ用に作成' },
    source: { canonicalId: 'canonical/skills/manage-codex-claude-mirroring', contentHash: canonicalMirroringHash },
    environments: {
      codex: makeEnvironment(false, null, 'canonical-registry', null, 'not_distributed'),
      claude: makeEnvironment(false, null, 'canonical-registry', null, 'not_distributed')
    },
    mirror: { eligible: true, status: 'needs_review', reasonCode: 'canonical_not_distributed', reason: '共通正本には登録済みですが、Codex／Claudeへは未配布です。' },
    requirements: [],
    legacy: {},
    lastVerifiedAt: now
  });
}

const codexCacheRoot = join(home, '.codex', 'plugins', 'cache');
const codexConfig = await readFile(join(home, '.codex', 'config.toml'), 'utf8');
const enabledCodexPlugins = parseEnabledCodexPlugins(codexConfig);
evidenceSummary.codex.marketplaceSourcePackages = new Set([...codexConfig.matchAll(/^\[marketplaces\.([^\]]+)\]/mg)].map((match) => match[1])).size;
evidenceSummary.codex.cachePhysicalSkillFiles = (await walkFiles(codexCacheRoot, (name) => name === 'SKILL.md', { includeHidden: true })).length;
const codexPackages = await listCodexCachePackages(codexCacheRoot);
const codexPackageByKey = new Map(codexPackages.map((item) => [`${item.marketplace}/${item.plugin}`, item]));
const codexRemoteMarkerKeys = new Set();
for (const item of codexPackages) {
  try {
    await readFile(join(item.directory, '.codex-remote-plugin-install.json'), 'utf8');
    codexRemoteMarkerKeys.add(`${item.marketplace}/${item.plugin}`);
  } catch { /* markerなし */ }
}
evidenceSummary.codex.enabledPluginPackages = enabledCodexPlugins.length;
evidenceSummary.codex.remoteInstallMarkers = codexRemoteMarkerKeys.size;

function addCodexPluginSkill(item, skill, evidence) {
  const name = canonicalName(skill.name);
  const legacy = legacyByName.get(name);
  const configured = evidence === 'config_enabled';
  upsert({
    id: `plugin.codex.${item.marketplace}.${item.plugin}.${name}`.replace(/[^a-z0-9.-]+/gi, '-'),
    kind: 'plugin_skill',
    name,
    aliases: skill.folder.trim().toLocaleLowerCase('ja') === name.trim().toLocaleLowerCase('ja') ? [] : [skill.folder],
    description: legacy?.d ?? skill.description ?? `${item.plugin} Plugin由来のSkillです。`,
    example: legacy?.e ?? '',
    category: categoryFor(name, legacy),
    projectTags: projectTags(name, legacy),
    provider: { type: 'plugin', name: `${item.plugin}@${item.marketplace}` },
    source: { canonicalId: `codex-plugin/${item.marketplace}/${item.plugin}/skills/${name}`, contentHash: skill.hash },
    environments: {
      codex: makeEnvironment(configured, `/${name}`, evidence === 'config_enabled' ? 'codex-config-enabled' : 'codex-remote-install-marker', skill.hash, 'installed_unverified', true, evidence),
      claude: makeEnvironment(false, null, null, null, 'not-applicable')
    },
    mirror: { eligible: false, status: 'codex_only', reasonCode: 'plugin_skill', reason: configured ? 'Codex設定で有効化されたPlugin由来です。実行可否はこの棚卸しでは未確認です。' : 'リモート導入記録はありますが、Codex設定での有効化・実行可否は未確認です。', portability: makePortability('adapter_required') },
    requirements: [],
    legacy: legacyDetails(legacy),
    lastVerifiedAt: now
  });
}

const codexEvidenceKeys = new Set([...enabledCodexPlugins.map((item) => `${item.marketplace}/${item.plugin}`), ...codexRemoteMarkerKeys]);
for (const key of codexEvidenceKeys) {
  const item = codexPackageByKey.get(key);
  const evidence = enabledCodexPlugins.some((plugin) => `${plugin.marketplace}/${plugin.plugin}` === key) ? 'config_enabled' : 'remote_install_marker';
  if (!item) {
    addCapability({ id: `capability.codex.${key}`.replace(/[^a-z0-9.-]+/gi, '-'), name: key, environment: 'codex', evidenceType: evidence, availability: 'installed_unverified', reason: '導入・有効化の記録はありますが、対応するPlugin内容を取得できませんでした。' });
    continue;
  }
  const scanned = await scanPluginSkills(item.directory);
  evidenceSummary.codex.pluginSkillFilesConsidered += scanned.rawCount;
  evidenceSummary.codex.duplicateExclusions += scanned.duplicateExclusions;
  if (!scanned.skills.length) {
    addCapability({ id: `capability.codex.${key}`.replace(/[^a-z0-9.-]+/gi, '-'), name: key, environment: 'codex', evidenceType: evidence, availability: 'installed_unverified', reason: '導入・有効化の記録はありますが、Skill定義は検出されませんでした。' });
  }
  for (const skill of scanned.skills) addCodexPluginSkill(item, skill, evidence);
}

for (const item of codexPackages) {
  const key = `${item.marketplace}/${item.plugin}`;
  if (codexEvidenceKeys.has(key)) continue;
  const scanned = await scanPluginSkills(item.directory);
  evidenceSummary.codex.cacheOnlySkillFiles += scanned.rawCount;
}
evidenceSummary.codex.nonRuntimeSkillDefinitions = evidenceSummary.codex.cachePhysicalSkillFiles - evidenceSummary.codex.pluginSkillFilesConsidered - evidenceSummary.codex.cacheOnlySkillFiles;

for (const skill of codexBuiltinSkills) {
  const name = skill.folder;
  const legacy = legacyByName.get(name);
  upsert({
    id: `builtin.codex.${name}`,
    kind: 'builtin_skill',
    name,
    aliases: [],
    description: legacy?.d ?? skill.description ?? 'Codex組み込みSkillです。',
    example: legacy?.e ?? '',
    category: 'development-ai',
    projectTags: [],
    provider: { type: 'openai', name: 'OpenAI' },
    source: { canonicalId: `codex-system/${name}`, contentHash: skill.hash },
    environments: {
      codex: makeEnvironment(true, `$${name}`, 'codex-system-skill', skill.hash),
      claude: makeEnvironment(false, null, 'excluded-mirror-copy', null, 'not-applicable')
    },
    mirror: { eligible: false, status: 'not_mirrorable', reasonCode: 'codex_builtin', reason: 'Codex組み込みSkillのため、Claude側へ複製しても対応とは扱いません。' },
    requirements: [],
    legacy: legacyDetails(legacy),
    lastVerifiedAt: now
  });
}

const claudePluginRoot = join(home, '.claude', 'plugins');
const claudeSettings = JSON.parse(await readFile(join(home, '.claude', 'settings.json'), 'utf8'));
const claudeInstalled = JSON.parse(await readFile(join(claudePluginRoot, 'installed_plugins.json'), 'utf8'));
const claudePluginEntries = Object.entries(claudeInstalled.plugins ?? {});
evidenceSummary.claude.installedPluginPackages = claudePluginEntries.length;
evidenceSummary.claude.enabledPluginPackages = claudePluginEntries.filter(([key]) => claudeSettings.enabledPlugins?.[key] === true).length;
const claudeMarketplaceManifests = await walkFiles(join(claudePluginRoot, 'marketplaces'), (name, path) => name === 'plugin.json' && path.includes('/.claude-plugin/'), { includeHidden: true });
evidenceSummary.claude.marketplaceSourcePackages = claudeMarketplaceManifests.length;
evidenceSummary.claude.marketplaceSourceSkillFiles = (await walkFiles(join(claudePluginRoot, 'marketplaces'), (name) => name === 'SKILL.md')).length;
evidenceSummary.claude.cachePhysicalSkillFiles = (await walkFiles(join(claudePluginRoot, 'cache'), (name) => name === 'SKILL.md', { includeHidden: true })).length;
const claudeInstallMarkers = await walkFiles(join(claudePluginRoot, '.install-manifests'), (name) => name.endsWith('.json'));
evidenceSummary.claude.installMarkers = claudeInstallMarkers.length;

function splitPluginKey(key) {
  const at = key.lastIndexOf('@');
  return { plugin: key.slice(0, at), marketplace: key.slice(at + 1) };
}

function addClaudePluginSkill(key, install, skill) {
  const { plugin, marketplace } = splitPluginKey(key);
  const name = canonicalName(skill.name);
  const legacy = legacyByName.get(name);
  const configured = claudeSettings.enabledPlugins?.[key] === true;
  const claudeEnvironment = makeEnvironment(configured, `/${name}`, configured ? 'claude-enabled-plugin' : 'claude-install-record', skill.hash, 'installed_unverified', true, configured ? 'config_enabled' : 'install_record');
  // 同じPlugin名・Skill名でCodex版がある場合は、環境別の複製ではなく1枚のカードに統合する。
  // 同名でも別Plugin（例: index）は統合しない。
  const codexCounterpart = [...records.values()].find((record) => record.kind === 'plugin_skill'
    && record.name === name
    && record.provider.type === 'plugin'
    && record.provider.name.startsWith(`${plugin}@`)
    && (record.environments.codex.configured || record.environments.codex.installed));
  if (codexCounterpart) {
    codexCounterpart.environments.claude = claudeEnvironment;
    codexCounterpart.provider = { type: 'plugin', name: `${plugin}（Codex / Claude）` };
    codexCounterpart.source.canonicalId = `plugin/${plugin}/skills/${name}`;
    codexCounterpart.mirror = { eligible: true, status: 'needs_review', reasonCode: 'plugin_cross_environment', reason: 'CodexとClaudeの同名Plugin Skillを1枚に統合しています。内容ハッシュと実行可否は環境ごとに確認します。', portability: makePortability('adapter_required') };
    return;
  }
  upsert({
    id: `plugin.claude.${marketplace}.${plugin}.${name}`.replace(/[^a-z0-9.-]+/gi, '-'),
    kind: 'plugin_skill',
    name,
    aliases: skill.folder.trim().toLocaleLowerCase('ja') === name.trim().toLocaleLowerCase('ja') ? [] : [skill.folder],
    description: legacy?.d ?? skill.description ?? `${plugin} Plugin由来のSkillです。`,
    example: legacy?.e ?? '',
    category: categoryFor(name, legacy),
    projectTags: projectTags(name, legacy),
    provider: { type: 'plugin', name: `${plugin}@${marketplace}` },
    source: { canonicalId: `claude-plugin/${marketplace}/${plugin}/skills/${name}`, contentHash: skill.hash },
    environments: {
      codex: makeEnvironment(false, null, null, null, 'not-applicable'),
      claude: claudeEnvironment
    },
    mirror: { eligible: false, status: 'claude_only', reasonCode: 'plugin_skill', reason: configured ? 'Claude設定で有効化されたPlugin由来です。実行可否はこの棚卸しでは未確認です。' : '導入記録はありますが、Claude設定での有効化・実行可否は未確認です。', portability: makePortability('adapter_required') },
    requirements: [],
    legacy: legacyDetails(legacy),
    lastVerifiedAt: now
  });
}

const claudeInstalledByKey = new Map();
for (const [key, installs] of claudePluginEntries) {
  const install = [...installs].sort((a, b) => String(b.installedAt).localeCompare(String(a.installedAt)))[0];
  claudeInstalledByKey.set(key, install);
  const scanned = await scanPluginSkills(install.installPath, { preferredVersion: install.version });
  evidenceSummary.claude.pluginSkillFilesConsidered += scanned.rawCount;
  evidenceSummary.claude.duplicateExclusions += scanned.duplicateExclusions + Math.max(0, installs.length - 1) * scanned.skills.length;
  if (!scanned.skills.length) {
    addCapability({ id: `capability.claude.${key}`.replace(/[^a-z0-9.-]+/gi, '-'), name: key, environment: 'claude', evidenceType: claudeSettings.enabledPlugins?.[key] ? 'config_enabled' : 'install_record', availability: 'installed_unverified', reason: '導入記録はありますが、Skill定義は検出されませんでした。' });
  }
  for (const skill of scanned.skills) addClaudePluginSkill(key, install, skill);
}
for (const markerPath of claudeInstallMarkers) {
  const marker = JSON.parse(await readFile(markerPath, 'utf8'));
  const key = marker.pluginId;
  if (claudeInstalledByKey.has(key)) continue;
  addCapability({ id: `capability.claude.marker.${key}`.replace(/[^a-z0-9.-]+/gi, '-'), name: key, environment: 'claude', evidenceType: 'install_marker', availability: 'installed_unverified', reason: '導入マーカーはありますが、現在のSkillパッケージおよび有効化状態を確認できませんでした。' });
}
evidenceSummary.claude.nonRuntimeSkillDefinitions = evidenceSummary.claude.cachePhysicalSkillFiles - evidenceSummary.claude.pluginSkillFilesConsidered;

const codexClaudeInstall = claudeInstalledByKey.get('codex@openai-codex');
const commandDir = codexClaudeInstall ? join(codexClaudeInstall.installPath, 'commands') : '';
for (const command of await scanMarkdownDirectory(commandDir)) {
  const name = `codex:${command.name}`;
  const legacy = legacyByName.get(name);
  upsert({
    id: `command.claude.${command.name}`,
    kind: 'command',
    name,
    aliases: [],
    description: legacy?.d ?? command.description ?? 'ClaudeのPlugin commandです。',
    example: legacy?.e ?? '',
    category: 'development-ai',
    projectTags: [],
    provider: { type: 'plugin', name: 'OpenAI Codex Plugin経由' },
    source: { canonicalId: `claude-plugin/codex/commands/${command.name}`, contentHash: command.hash },
    environments: {
      codex: makeEnvironment(false, null, null, null, 'not-applicable'),
      claude: makeEnvironment(claudeSettings.enabledPlugins?.['codex@openai-codex'] === true, `/codex:${command.name}`, 'claude-enabled-plugin-command', command.hash, 'installed_unverified', true, 'config_enabled')
    },
    mirror: { eligible: false, status: 'claude_only', reasonCode: 'plugin_command', reason: 'Claude Pluginのcommandであり、Skillとは別種別です。実行可否はこの棚卸しでは未確認です。', portability: makePortability('mirror_impossible') },
    requirements: [],
    legacy: legacyDetails(legacy),
    lastVerifiedAt: now
  });
}

const agentDir = codexClaudeInstall ? join(codexClaudeInstall.installPath, 'agents') : '';
for (const agent of await scanMarkdownDirectory(agentDir)) {
  upsert({
    id: `agent.claude.codex.${agent.name}`,
    kind: 'agent',
    name: agent.name,
    aliases: [],
    description: agent.description || 'Claude Plugin由来のagentです。',
    example: '',
    category: 'development-ai',
    projectTags: [],
    provider: { type: 'plugin', name: 'OpenAI Codex Plugin経由' },
    source: { canonicalId: `claude-plugin/codex/agents/${agent.name}`, contentHash: agent.hash },
    environments: {
      codex: makeEnvironment(false, null, null, null, 'not-applicable'),
      claude: makeEnvironment(claudeSettings.enabledPlugins?.['codex@openai-codex'] === true, null, 'claude-enabled-plugin-agent', agent.hash, 'installed_unverified', true, 'config_enabled')
    },
    mirror: { eligible: false, status: 'claude_only', reasonCode: 'plugin_agent', reason: 'Claude Plugin由来のagentであり、Skillとは別種別です。実行可否はこの棚卸しでは未確認です。', portability: makePortability('mirror_impossible') },
    requirements: [],
    legacy: {},
    lastVerifiedAt: now
  });
}

for (const task of claudeAutomation) {
  upsert({
    id: `automation.claude.${task.folder}`,
    kind: 'automation',
    name: task.folder,
    aliases: [],
    description: task.description || 'Claude Scheduled Taskの定義です。現在の有効状態は要確認です。',
    example: '',
    category: categoryFor(task.folder),
    projectTags: projectTags(task.folder),
    provider: { type: 'user', name: 'Claude Scheduled Task' },
    source: { canonicalId: `claude-scheduled-tasks/${task.folder}`, contentHash: task.hash },
    environments: {
      codex: makeEnvironment(false, null, null, null, 'not-applicable'),
      claude: makeEnvironment(false, null, 'claude-scheduled-task-definition', task.hash, 'installed_unverified', true, 'definition_file')
    },
    mirror: { eligible: false, status: 'needs_review', reasonCode: 'automation-state', reason: '定義ファイルは確認済みですが、クラウド側での有効状態は未確認です。' },
    requirements: [],
    legacy: {},
    lastVerifiedAt: now
  });
}

for (const legacy of legacyInput.skills) {
  const name = canonicalName(legacy.n);
  if (retiredSkillNames.has(name)) continue;
  if ([...records.values()].some((record) => record.name === name || record.aliases?.includes(legacy.n))) continue;
  const kind = name.startsWith('codex:') ? 'command' : 'skill';
  upsert({
    id: `legacy.${name.replace(/[^a-z0-9]+/gi, '-')}`,
    kind,
    name,
    aliases: legacy.n === name ? [] : [legacy.n],
    description: legacy.d,
    example: legacy.e,
    category: categoryFor(name, legacy),
    projectTags: projectTags(name, legacy),
    provider: { type: 'legacy', name: '旧SkillDeck登録' },
    source: { canonicalId: null, contentHash: null },
    environments: { codex: makeEnvironment(), claude: makeEnvironment() },
    mirror: { eligible: null, status: 'needs_review', reasonCode: 'registered_only', reason: '現行の実環境との対応を確認できていません。削除せず要確認として保持します。' },
    requirements: [],
    legacy: legacyDetails(legacy),
    lastVerifiedAt: now
  });
}

const finalRecords = [...records.values()].map((record) => {
  record.mirror.status = mirrorStatus(record);
  if (record.mirror.status === 'synced') record.mirror.reason = null;
  if (!record.mirror.portability) {
    if (record.kind === 'canonical_skill' || record.kind === 'skill') record.mirror.portability = 'directly_shareable';
    else if (record.kind === 'plugin_skill') record.mirror.portability = 'adapter_required';
    else if (record.kind === 'builtin_skill' || record.kind === 'command' || record.kind === 'agent') record.mirror.portability = 'mirror_impossible';
    else record.mirror.portability = 'requires_review';
  }
  record.usage = usageEvidence.forRecord(record);
  record.governance = governanceFor(record);
  return record;
}).filter((record) => !PUBLIC_RECORD_EXCLUSIONS.has(record.id)).sort((a, b) => a.name.localeCompare(b.name, 'ja'));

const capabilityMigrationDefinitions = [
  { legacyName: 'docx', currentName: 'documents', label: '文書作成（docx ⇄ Documents）' },
  { legacyName: 'pptx', currentName: 'presentations', label: 'プレゼンテーション（pptx ⇄ Presentations）' },
  { legacyName: 'xlsx', currentName: 'spreadsheets', label: '表計算（xlsx ⇄ Spreadsheets）' }
];
const migrationCandidates = capabilityMigrationDefinitions.map((definition) => {
  const legacyRecord = finalRecords.find((record) => record.name.trim().toLocaleLowerCase('ja') === definition.legacyName);
  const currentRecord = finalRecords.find((record) => record.name.trim().toLocaleLowerCase('ja') === definition.currentName);
  if (!legacyRecord || !currentRecord) return null;
  return { label: definition.label, reason: '旧カードと現行Skillは同一能力の候補です。自動統合・削除はしていません。', recordIds: [legacyRecord.id, currentRecord.id] };
}).filter(Boolean);

const result = {
  schemaVersion: 2,
  generatedAt: now,
  categories: CATEGORIES,
  inventory: {
    legacyCount: legacyInput.skills.length,
    userSkills: { codex: codexUserSkills.length, claude: claudeUserSkills.length },
    evidence: evidenceSummary,
    capabilities: capabilities.sort((a, b) => a.name.localeCompare(b.name, 'ja')),
    migrationCandidates,
    notes: [
      'Plugin cacheの物理ファイルだけでは、導入済み・利用可能とは扱いません。',
      'config有効化または導入マーカーだけのPluginは、実行可否未確認として記録しています。',
      '認証情報、絶対パス、接続ID、会話履歴は公開データに含めていません。',
      '利用状況は直近7日間のSkill定義読み込み・明示呼び出しだけを集計し、会話本文やセッション名は公開しません。',
      '削除候補は提案であり、自動削除や即時削除は行いません。'
    ]
  },
  records: finalRecords
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(`records: ${finalRecords.length}, skills: ${finalRecords.filter((record) => record.kind === 'skill').length}`);
