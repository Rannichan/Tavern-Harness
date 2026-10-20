import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { check, compareVersions, evaluateTags, loadEntries } from './scripts/changelog.mjs';

// ============================================================
// 版本记录一致性
// 保证「每个 npm 版本都有一条记录」不是靠自觉，而是靠测试。
// ============================================================

const root = fileURLToPath(new URL('.', import.meta.url));
const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));
const generated = JSON.parse(readFileSync(`${root}src/generated/changelog.json`, 'utf8'));

test('changelog 源文件、git tag 与 package.json 版本一一对应', () => {
  const { entries, errors, warnings } = check();
  assert.deepEqual(errors, [], `\n${errors.join('\n')}`);
  for (const warning of warnings) console.warn(`警告：${warning}`);
  assert.ok(entries.length > 0, '至少应有一个版本记录');
  assert.equal(entries.at(-1)?.version, pkg.version, '最新记录必须对应当前 package.json 版本');
});

test('每个版本都有中英文条目', () => {
  const { entries } = loadEntries();
  for (const entry of entries) {
    for (const locale of ['zh-CN', 'en']) {
      const groups = entry.groups[locale];
      assert.ok(groups.length > 0, `v${entry.version} 缺少 ${locale} 分组`);
      assert.ok(
        groups.some((group) => group.items.length > 0),
        `v${entry.version} 的 ${locale} 没有任何条目`,
      );
    }
  }
});

test('版本记录日期递增且格式合法', () => {
  const { entries } = loadEntries();
  for (let i = 0; i < entries.length; i += 1) {
    assert.match(entries[i].date, /^\d{4}-\d{2}-\d{2}$/);
    if (i > 0) assert.ok(entries[i].date >= entries[i - 1].date, `v${entries[i].version} 日期早于上一版本`);
  }
});

test('生成的应用内数据与 package.json 一致', () => {
  assert.equal(generated.latest, pkg.version);
  assert.equal(generated.entries[0]?.version, pkg.version);
  assert.equal(generated.entries.length, loadEntries().entries.length);
  assert.match(generated.repo, /^https:\/\/github\.com\//);
  for (const entry of generated.entries) {
    assert.ok(entry.compare == null || entry.compare.includes('...'), `v${entry.version} 的 compare 引用不合法`);
    assert.ok(entry.groups['zh-CN'].length > 0 && entry.groups.en.length > 0);
  }
});

test('版本号按数字而非字符串排序', () => {
  assert.ok(compareVersions('0.1.10', '0.1.9') > 0);
  assert.ok(compareVersions('0.2.0', '0.1.99') > 0);
  assert.equal(compareVersions('0.1.12', '0.1.12'), 0);
});

// 发布时序：先写 changelog 再打 tag，所以开发中的当前版本允许暂时没有 tag；
// 发布前（--release）则必须已经打好，避免 tag 漏打导致版本记录对不上。
test('当前版本未打 tag：开发模式只警告，发布模式报错', () => {
  const versions = ['0.1.12', '0.1.13'];
  const tags = ['v0.1.12'];

  const developing = evaluateTags(versions, tags, '0.1.13', false);
  assert.deepEqual(developing.errors, []);
  assert.equal(developing.warnings.length, 1);
  assert.match(developing.warnings[0], /v0\.1\.13/);

  const releasing = evaluateTags(versions, tags, '0.1.13', true);
  assert.equal(releasing.errors.length, 1);
  assert.match(releasing.errors[0], /还没有对应的 git tag v0\.1\.13/);
});

test('历史版本缺 tag、或有 tag 却没文件，任何模式都报错', () => {
  const missingTag = evaluateTags(['0.1.12', '0.1.13'], ['v0.1.13'], '0.1.13', false);
  assert.ok(
    missingTag.errors.some((error) => error.includes('changelog/v0.1.12.md')),
    `应报告历史版本缺 tag：${missingTag.errors.join('\n')}`,
  );

  const missingFile = evaluateTags(['0.1.12'], ['v0.1.12', 'v0.1.99'], '0.1.12', false);
  assert.ok(
    missingFile.errors.some((error) => error.includes('v0.1.99')),
    `应报告 tag 缺少源文件：${missingFile.errors.join('\n')}`,
  );
});
