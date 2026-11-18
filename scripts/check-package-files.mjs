#!/usr/bin/env node
/**
 * 发布前校验：package.json 的 files 白名单必须覆盖所有运行时相对导入。
 *
 * 背景：0.1.32 的 persistence-server.mjs 新增了
 *   import { normalizeBailianAudioUrl } from './voice-server.mjs';
 * 但 files 列表没有同步加入 voice-server.mjs。npm 包安装后持久化服务启动即
 * ERR_MODULE_NOT_FOUND，页面无法加载 / 保存对话。这个脚本在 npm pack /
 * npm publish 之前沿着入口文件检查相对导入，避免同类问题再次进入发布包。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const toPosix = (path) => path.split(sep).join('/');

// npm 总会带上这些文件，不受 files 限制
const ALWAYS_PUBLISHED = new Set(['package.json', 'README.md', 'README.zh.md', 'LICENSE', 'LICENSE.md']);

function isPublished(relPath) {
  const path = toPosix(relPath);
  if (ALWAYS_PUBLISHED.has(path)) return true;
  return (pkg.files ?? []).some((entry) => {
    const clean = toPosix(entry).replace(/^\.\//, '').replace(/\/$/, '');
    if (!clean) return false;
    // 目前 files 没有使用 glob；真出现时退化为前缀匹配，宁可少报也不误报
    if (clean.includes('*')) return path.startsWith(clean.split('*')[0]);
    return path === clean || path.startsWith(`${clean}/`);
  });
}

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) files.push(...walk(full));
    else files.push(toPosix(relative(ROOT, full)));
  }
  return files;
}

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.css', '.svg', '.png', '.webp', '.woff', '.woff2', '.wasm'];

function resolveSpecifier(fromRel, specifier) {
  const clean = specifier.split(/[?#]/)[0];
  const base = resolve(ROOT, dirname(fromRel), clean);
  const candidates = [base];
  for (const extension of RESOLVE_EXTENSIONS) candidates.push(base + extension);
  // TS 的 ESM 写法会写 .js 后缀，但源码实际是 .ts
  if (clean.endsWith('.js')) {
    const withoutExtension = base.slice(0, -'.js'.length);
    candidates.push(`${withoutExtension}.ts`, `${withoutExtension}.tsx`);
  }
  for (const extension of ['.ts', '.tsx', '.js', '.mjs', '.json']) {
    candidates.push(join(base, `index${extension}`));
  }
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return toPosix(relative(ROOT, candidate));
    }
  }
  return null;
}

function extractSpecifiers(code) {
  const specifiers = new Set();
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g, // import ... from / export ... from
    /\bimport\s+['"]([^'"]+)['"]/g, // import './side-effect'
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // 动态 import()
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) specifiers.add(match[1]);
  }
  return specifiers;
}

// 收集运行时入口：bin、Vite 配置、根目录服务端模块，以及 src 下全部源码。
// src 整个目录都在 files 里，递归检查可以提前发现“新增顶层模块却忘了发布”的情况。
const roots = new Set();
for (const binPath of Object.values(pkg.bin ?? {})) roots.add(toPosix(binPath));
roots.add('vite.config.ts');
for (const name of readdirSync(ROOT)) {
  if (name.endsWith('.mjs') && !name.endsWith('.test.mjs')) roots.add(name);
}
if (existsSync(join(ROOT, 'src'))) {
  for (const file of walk(join(ROOT, 'src'))) {
    if (/\.(ts|tsx|js|jsx|mjs)$/.test(file)) roots.add(file);
  }
}

const errors = [];
const visited = new Set();

function checkFile(relPath) {
  if (visited.has(relPath)) return;
  visited.add(relPath);

  if (!isPublished(relPath)) {
    errors.push(`${relPath} 被运行时文件引用，但不在 package.json 的 files 列表里`);
    return;
  }
  if (!/\.(ts|tsx|js|jsx|mjs)$/.test(relPath)) return;

  const code = readFileSync(join(ROOT, relPath), 'utf8');
  for (const specifier of extractSpecifiers(code)) {
    if (!specifier.startsWith('.')) continue;
    const target = resolveSpecifier(relPath, specifier);
    if (!target) {
      errors.push(`${relPath} 的相对导入无法解析：${specifier}`);
      continue;
    }
    if (!isPublished(target)) {
      errors.push(`${relPath} 导入了 ${target}，但 ${target} 不会被打进 npm 包`);
      continue;
    }
    checkFile(target);
  }
}

for (const root of roots) checkFile(root);

if (errors.length > 0) {
  console.error('npm 发布内容校验失败：');
  for (const error of errors) console.error(`  - ${error}`);
  console.error('请把缺失的运行时文件加入 package.json 的 "files"，再重新打包。');
  process.exit(1);
}

const entryCount = [...visited].filter((file) => extname(file) !== '').length;
console.log(`npm 发布内容校验通过：${entryCount} 个运行时文件都在 files 白名单内。`);
