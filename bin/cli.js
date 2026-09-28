#!/usr/bin/env node
// bin/cli.js — npx tavern-harness 一键启动，默认自动打开浏览器
// 用法：
//   tavern-harness             启动并按实际端口自动打开浏览器（默认）
//   tavern-harness --no-open   只启动，不打开浏览器
//   tavern-harness --port 5273 指定端口（5173 被占用时 vite 会自动顺延，
//                              会打开顺延后的实际端口）
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');              // 包根目录
const configFile = join(root, 'vite.config.ts'); // 复用现有配置（cors 代理 / sandbox 懒启动都在里面）

// ---- 解析命令行参数 ----
const args = process.argv.slice(2);
let open = true; // 默认自动打开浏览器
let port;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--no-open') open = false;
  else if (a === '--open') open = true;
  else if (a === '--port') port = Number(args[++i]);
  else if (a.startsWith('--port=')) port = Number(a.slice('--port='.length));
}
const serverOptions = { open };
if (Number.isInteger(port) && port > 0 && port < 65536) serverOptions.port = port;

try {
  // inlineConfig 与 vite.config.ts 合并（inline 优先），open 会覆盖配置文件里的 open:false
  const server = await createServer({
    root,
    configFile,
    server: serverOptions,
  });
  await server.listen();
  server.printUrls();
  console.log('\nTavern Harness 已启动，浏览器应已自动打开（未打开可手动访问上面 Local 地址）。按 Ctrl+C 停止。');

  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });
} catch (err) {
  console.error('启动失败:', err);
  process.exit(1);
}