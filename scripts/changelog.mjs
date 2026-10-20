#!/usr/bin/env node
/**
 * scripts/changelog.mjs — 版本记录的唯一入口
 *
 * 源文件：changelog/v<version>.md（一版一文件，人工维护）
 * 生成物：
 *   - src/generated/changelog.json   应用内版本记录（Vite 打包，离线可用）
 *   - CHANGELOG.md                   仓库阅读 / GitHub 归档
 *
 * 用法：
 *   node scripts/changelog.mjs new [--version 0.1.13] [--write]
 *   node scripts/changelog.mjs build
 *   node scripts/changelog.mjs check            开发模式：当前版本暂未打 tag 只警告
 *   node scripts/changelog.mjs check --release  发布模式：当前版本必须有 tag
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CHANGELOG_DIR = join(ROOT, 'changelog');
const JSON_PATH = join(ROOT, 'src/generated/changelog.json');
const MARKDOWN_PATH = join(ROOT, 'CHANGELOG.md');
const PACKAGE_PATH = join(ROOT, 'package.json');

const REPO = 'https://github.com/Rannichan/Tavern-Harness';

const LOCALE_ALIASES = {
  '中文': 'zh-CN',
  '简体中文': 'zh-CN',
  English: 'en',
  EN: 'en',
};

const GROUP_ALIASES = {
  '新增': 'added',
  Added: 'added',
  New: 'added',
  '改进': 'changed',
  Changed: 'changed',
  Improved: 'changed',
  '修复': 'fixed',
  Fixed: 'fixed',
  Fixes: 'fixed',
  '内部': 'internal',
  Internal: 'internal',
};

const GROUP_LABEL = {
  'zh-CN': { added: '新增', changed: '改进', fixed: '修复', internal: '内部' },
  en: { added: 'Added', changed: 'Changed', fixed: 'Fixed', internal: 'Internal' },
};

const GROUP_ORDER = ['added', 'changed', 'fixed', 'internal'];

const GIT_IGNORE = [
  /^\d+\.\d+\.\d+$/,
  /^v\d+\.\d+\.\d+$/,
  /^chore\(release\)/,
  /^Merge /,
  /^Initial commit$/,
];

// ------------------------------------------------------------------
// 解析
// ------------------------------------------------------------------

function parseEntryFile(fileName, text) {
  const errors = [];
  const nameMatch = fileName.match(/^v(\d+\.\d+\.\d+)\.md$/);
  if (!nameMatch) {
    return { errors: [`changelog/${fileName}: 文件名必须是 v<major>.<minor>.<patch>.md`], entry: null };
  }

  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const meta = {};
  let i = 0;
  if (lines[0]?.trim() !== '---') {
    errors.push(`changelog/${fileName}: 缺少 frontmatter（首行应为 ---）`);
  } else {
    for (i = 1; i < lines.length; i += 1) {
      if (lines[i].trim() === '---') {
        i += 1;
        break;
      }
      const m = lines[i].match(/^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/);
      if (!m) {
        errors.push(`changelog/${fileName}: 无法解析 frontmatter 行「${lines[i]}」`);
        continue;
      }
      meta[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }

  const groups = { 'zh-CN': [], en: [] };
  let locale = null;
  let group = null;
  for (; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;

    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      const mapped = LOCALE_ALIASES[h2[1].trim()];
      if (!mapped) {
        errors.push(`changelog/${fileName}: 未知语言标题「${h2[1]}」，只支持「中文」/「English」`);
        locale = null;
        group = null;
        continue;
      }
      locale = mapped;
      group = null;
      continue;
    }

    const h3 = line.match(/^###\s+(.+)$/);
    if (h3) {
      const kind = GROUP_ALIASES[h3[1].trim()];
      if (!locale) {
        errors.push(`changelog/${fileName}: 「${h3[1]}」出现在语言标题之前`);
        continue;
      }
      if (!kind) {
        errors.push(`changelog/${fileName}: 未知分组「${h3[1]}」`);
        continue;
      }
      group = { kind, items: [] };
      groups[locale].push(group);
      continue;
    }

    if (line.startsWith('- ')) {
      if (!group) {
        errors.push(`changelog/${fileName}: 列表项缺少所属分组：「${line}」`);
        continue;
      }
      const item = line.slice(2).trim();
      if (!item) {
        errors.push(`changelog/${fileName}: 存在空列表项`);
        continue;
      }
      group.items.push(item);
      continue;
    }

    // 缩进的续行并入上一条，便于写长句
    if (group && group.items.length > 0 && /^\s+/.test(raw)) {
      group.items[group.items.length - 1] += ` ${line}`;
      continue;
    }

    errors.push(`changelog/${fileName}: 无法解析的行「${line}」`);
  }

  const entry = {
    version: nameMatch[1],
    date: meta.date ?? '',
    breaking: meta.breaking === 'true',
    compare: null,
    groups,
  };

  if (meta.version && meta.version !== entry.version) {
    errors.push(`changelog/${fileName}: frontmatter version ${meta.version} 与文件名 ${entry.version} 不一致`);
  }
  if (!meta.date) errors.push(`changelog/${fileName}: frontmatter 缺少 date`);
  if (meta.breaking && meta.breaking !== 'true' && meta.breaking !== 'false') {
    errors.push(`changelog/${fileName}: breaking 只能是 true 或 false`);
  }
  for (const l of ['zh-CN', 'en']) {
    if (!groups[l].some((g) => g.items.length > 0)) {
      errors.push(`changelog/${fileName}: ${l === 'en' ? 'English' : '中文'} 段落没有任何条目`);
    }
  }

  return { errors, entry };
}

function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

function loadPackageVersion() {
  const pkg = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8'));
  return pkg.version;
}

function loadEntries() {
  const errors = [];
  const warnings = [];
  if (!existsSync(CHANGELOG_DIR)) {
    return { entries: [], errors: ['changelog/ 目录不存在'], warnings };
  }

  const files = readdirSync(CHANGELOG_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();
  const entries = [];
  for (const file of files) {
    const parsed = parseEntryFile(file, readFileSync(join(CHANGELOG_DIR, file), 'utf8'));
    errors.push(...parsed.errors);
    if (parsed.entry) entries.push(parsed.entry);
  }

  entries.sort((a, b) => compareVersions(a.version, b.version));

  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.version)) errors.push(`重复的版本号 ${entry.version}`);
    seen.add(entry.version);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || Number.isNaN(Date.parse(entry.date))) {
      errors.push(`v${entry.version}: 日期「${entry.date}」不是合法的 YYYY-MM-DD`);
    }
  }

  for (let i = 1; i < entries.length; i += 1) {
    if (entries[i].date < entries[i - 1].date) {
      errors.push(`v${entries[i].version} 的日期早于 v${entries[i - 1].version}`);
    }
  }

  const pkgVersion = loadPackageVersion();
  const versions = entries.map((e) => e.version);
  if (!versions.includes(pkgVersion)) {
    errors.push(`package.json 版本 ${pkgVersion} 没有对应的 changelog/v${pkgVersion}.md`);
  }
  const latest = versions[versions.length - 1];
  if (latest && latest !== pkgVersion) {
    errors.push(`changelog 最新版本 ${latest} 与 package.json 版本 ${pkgVersion} 不一致：请先执行版本号提升，或补齐/修正源文件`);
  }

  return { entries, errors, warnings };
}

function listGitTags() {
  try {
    const out = execFileSync('git', ['tag', '-l', 'v*'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out ? out.split('\n') : [];
  } catch {
    return null;
  }
}

/**
 * 纯函数：比对「源文件版本」与「git tag」。
 * 正在开发、尚未发布的当前版本（package.json 版本）允许暂时没有 tag：
 * 日常 test / check 只把它当作提醒，发布时用 --release 收紧为错误，
 * 从而保证 npm publish 之前一定已经打过 tag。
 */
function evaluateTags(versions, tags, pkgVersion, strictTags) {
  const errors = [];
  const warnings = [];
  const tagSet = new Set(tags);
  const fileSet = new Set(versions.map((version) => `v${version}`));
  for (const tag of tags) {
    if (!fileSet.has(tag)) errors.push(`tag ${tag} 没有对应的 changelog/${tag}.md`);
  }
  for (const name of fileSet) {
    if (tagSet.has(name)) continue;
    if (!strictTags && name === `v${pkgVersion}`) {
      warnings.push(`changelog/${name}.md 还没有对应的 git tag ${name}（开发中的版本，发布前补上 tag 即可）`);
      continue;
    }
    errors.push(`changelog/${name}.md 还没有对应的 git tag ${name}`);
  }
  return { errors, warnings };
}

function checkTags(entries, errors, warnings, strictTags) {
  const tags = listGitTags();
  if (tags === null) {
    warnings.push('未检测到 git 仓库，跳过 tag 与 changelog 文件的一一对应校验');
    return;
  }
  const result = evaluateTags(entries.map((entry) => entry.version), tags, loadPackageVersion(), strictTags);
  errors.push(...result.errors);
  warnings.push(...result.warnings);
}

// ------------------------------------------------------------------
// 生成物
// ------------------------------------------------------------------

function attachCompareRefs(entries) {
  const asc = [...entries].sort((a, b) => compareVersions(a.version, b.version));
  return asc.map((entry, index) => ({
    ...entry,
    compare: index === 0 ? null : `v${asc[index - 1].version}...v${entry.version}`,
  }));
}

function renderJson(entries) {
  const desc = [...entries].sort((a, b) => compareVersions(b.version, a.version));
  const payload = {
    latest: desc[0]?.version ?? null,
    repo: REPO,
    entries: desc.map((entry) => ({
      version: entry.version,
      date: entry.date,
      breaking: entry.breaking,
      compare: entry.compare,
      groups: entry.groups,
    })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function renderMarkdown(entries) {
  const desc = [...entries].sort((a, b) => compareVersions(b.version, a.version));
  const lines = [
    '# Changelog',
    '',
    '> 本文件由 `scripts/changelog.mjs` 从 `changelog/v*.md` 生成，请勿手动编辑。',
    '> 版本对比链接见文末；源文件位于仓库 `changelog/` 目录。',
    '',
  ];
  for (const entry of desc) {
    lines.push(`## [${entry.version}] - ${entry.date}`, '');
    if (entry.breaking) {
      lines.push('> ⚠️ 本版本包含需要手动处理的变更，升级前请先备份数据。', '');
    }
    lines.push('### 中文', '');
    for (const group of entry.groups['zh-CN']) {
      lines.push(`#### ${GROUP_LABEL['zh-CN'][group.kind]}`, '');
      for (const item of group.items) lines.push(`- ${item}`);
      lines.push('');
    }
    lines.push('### English', '');
    for (const group of entry.groups.en) {
      lines.push(`#### ${GROUP_LABEL.en[group.kind]}`, '');
      for (const item of group.items) lines.push(`- ${item}`);
      lines.push('');
    }
  }
  lines.push('<!-- 链接定义 -->');
  for (const entry of desc) {
    const url = entry.compare ? `${REPO}/compare/${entry.compare}` : `${REPO}/releases/tag/v${entry.version}`;
    lines.push(`[${entry.version}]: ${url}`);
  }
  lines.push('');
  return lines.join('\n');
}

function generateOutputs(entries) {
  return new Map([
    [JSON_PATH, renderJson(entries)],
    [MARKDOWN_PATH, renderMarkdown(entries)],
  ]);
}

// ------------------------------------------------------------------
// 校验 / 构建
// ------------------------------------------------------------------

function check(options = {}) {
  const { entries, errors, warnings } = loadEntries();
  if (errors.length === 0) {
    checkTags(entries, errors, warnings, options.strictTags === true);
    const generated = generateOutputs(attachCompareRefs(entries));
    for (const [path, content] of generated) {
      const label = relative(ROOT, path);
      if (!existsSync(path)) {
        errors.push(`缺少生成物 ${label}，请运行 npm run changelog:build`);
      } else if (readFileSync(path, 'utf8') !== content) {
        errors.push(`${label} 与 changelog/ 源文件不一致，请运行 npm run changelog:build`);
      }
    }
  }
  return { entries, errors, warnings };
}

function build() {
  const { entries, errors, warnings } = loadEntries();
  for (const warning of warnings) console.warn(`警告：${warning}`);
  if (errors.length > 0) {
    for (const error of errors) console.error(`错误：${error}`);
    throw new Error(`changelog 校验失败（${errors.length} 项）`);
  }
  const outputs = generateOutputs(attachCompareRefs(entries));
  for (const [path, content] of outputs) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    console.log(`写入 ${relative(ROOT, path)}`);
  }
  console.log(`完成：${entries.length} 个版本`);
}

// ------------------------------------------------------------------
// 起草新版本
// ------------------------------------------------------------------

function gitLines(args) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function lastTag() {
  return gitLines(['describe', '--tags', '--abbrev=0', '--match', 'v*']) || null;
}

function classifySubject(subject) {
  const match = subject.match(/^(\w+)(?:\([^)]*\))?!?:\s*(.+)$/);
  if (!match) return { kind: 'changed', text: subject };
  const [, type, text] = match;
  if (type === 'feat') return { kind: 'added', text };
  if (type === 'fix') return { kind: 'fixed', text };
  if (['perf', 'refactor', 'docs', 'chore', 'test', 'build', 'ci', 'style'].includes(type)) {
    return { kind: 'internal', text };
  }
  return { kind: 'changed', text };
}

function draftBody(from) {
  const commits = gitLines(['log', '--pretty=%s', from ? `${from}..HEAD` : 'HEAD'])
    .split('\n')
    .filter(Boolean)
    .filter((subject) => !GIT_IGNORE.some((pattern) => pattern.test(subject)));

  const buckets = { added: [], changed: [], fixed: [], internal: [] };
  for (const subject of commits) {
    const { kind, text } = classifySubject(subject);
    buckets[kind].push(text);
  }

  const zh = GROUP_ORDER.filter((kind) => buckets[kind].length > 0)
    .map((kind) => [`### ${GROUP_LABEL['zh-CN'][kind]}`, ...buckets[kind].map((text) => `- ${text}`)].join('\n'))
    .join('\n\n');
  const en = GROUP_ORDER.filter((kind) => buckets[kind].length > 0)
    .map((kind) => [`### ${GROUP_LABEL.en[kind]}`, ...buckets[kind].map((text) => `- ${text}`)].join('\n'))
    .join('\n\n');

  return { zh: zh || '### 新增\n- ', en: en || '### Added\n- ', count: commits.length };
}

function draftChangelog(version) {
  const from = lastTag();
  const { zh, en, count } = draftBody(from);
  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  return {
    count,
    from,
    text: `---
version: ${version}
date: ${date}
breaking: false
---

## 中文

${zh}

## English

${en}
`,
  };
}

function parseArgs(argv) {
  const args = { version: null, write: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--version') args.version = argv[++i];
    else if (arg.startsWith('--version=')) args.version = arg.slice('--version='.length);
    else if (arg === '--write') args.write = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return args;
}

function runNew(argv) {
  const args = parseArgs(argv);
  const version = args.version ?? loadPackageVersion();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`版本号必须是 x.y.z：${version}`);

  const target = join(CHANGELOG_DIR, `v${version}.md`);
  if (existsSync(target)) throw new Error(`changelog/v${version}.md 已存在`);

  const draft = draftChangelog(version);
  if (!args.write) {
    process.stdout.write(draft.text);
    return;
  }
  mkdirSync(CHANGELOG_DIR, { recursive: true });
  writeFileSync(target, draft.text);
  console.log(`已从 ${draft.from ?? '初始提交'} 之后的 ${draft.count} 条提交起草 changelog/v${version}.md`);
  console.log('请改写为用户可读的中英文条目，然后运行：npm run changelog:build');
}

function usage() {
  console.log(`用法：
  node scripts/changelog.mjs new [--version x.y.z] [--write]   从 git 提交起草新版本
  node scripts/changelog.mjs build                             校验并生成 src/generated/changelog.json 与 CHANGELOG.md
  node scripts/changelog.mjs check [--release]                 只校验（含生成物是否最新）
                                                               --release：当前版本必须已有 git tag（发布前使用）`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') {
    usage();
    return;
  }
  if (command === 'build') return build();
  if (command === 'check') {
    const unknown = rest.filter((arg) => arg !== '--release');
    if (unknown.length > 0) throw new Error(`未知参数：${unknown[0]}`);
    const release = rest.includes('--release');
    const { entries, errors, warnings } = check({ strictTags: release });
    for (const warning of warnings) console.warn(`警告：${warning}`);
    if (errors.length > 0) {
      for (const error of errors) console.error(`错误：${error}`);
      throw new Error(`changelog 校验失败（${errors.length} 项）`);
    }
    console.log(`通过：${entries.length} 个版本，tag、源文件与生成物一致${release ? '（发布模式：当前版本已有 tag）' : ''}`);
    return;
  }
  if (command === 'new') return runNew(rest);
  usage();
  throw new Error(`未知命令：${command}`);
}

const isMain = process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

export {
  build,
  check,
  compareVersions,
  evaluateTags,
  generateOutputs,
  loadEntries,
  parseEntryFile,
  renderJson,
  renderMarkdown,
};
