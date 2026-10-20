# Changelog

> 本文件由 `scripts/changelog.mjs` 从 `changelog/v*.md` 生成，请勿手动编辑。
> 版本对比链接见文末；源文件位于仓库 `changelog/` 目录。

## [0.1.12] - 2026-10-16

### 中文

#### 修复

- 为外部 HTTPS 模型服务补充代理转发，修复浏览器 CORS 导致的连接失败

#### 内部

- README 增加中英文切换链接

### English

#### Fixed

- Added proxy forwarding for external HTTPS model providers, fixing connection failures caused by browser CORS

#### Internal

- Added language links between the English and Chinese READMEs

## [0.1.11] - 2026-10-15

### 中文

#### 新增

- 角色书（Character Book）：支持编辑、导入与按关键词召回
- 导入深度提示词并作为附加指令生效
- 人物设定占位符在对话中正确替换为用户人设
- 编辑器支持 Markdown 预览，聊天消息支持强调样式
- 仪表盘新增 GitHub 入口

#### 改进

- 工作坊编辑器改用 Portal 渲染，避免弹窗被父容器裁剪
- 改进原始响应日志查看器
- 保留导入角色的完整开场白，并归一化角色卡提示词

#### 修复

- 修复仪表盘操作按钮边框不一致

### English

#### Added

- Character Book: edit, import, and keyword-based recall
- Import depth prompts and apply them as additional instructions
- Persona placeholders are now replaced with the user's persona in conversations
- Markdown previews in editors, plus emphasis rendering in chat messages
- GitHub link on the dashboard

#### Changed

- Workshop editors now render in a portal so modals are no longer clipped by their parent
- Improved the raw response log viewer
- Preserved full imported greetings and normalized imported character-card prompts

#### Fixed

- Fixed inconsistent borders on dashboard action buttons

## [0.1.10] - 2026-10-12

### 中文

#### 新增

- YOLO 模式：可在设置中选择自动批准工具修改与 Shell 执行，减少逐次确认
- 沙箱工作区持久化到包目录之外，升级或重装 npm 包不再丢失技能文件

#### 修复

- 校验并保留流式返回的工具调用参数，修复参数被截断或解析失败
- 修复设置卡片、文档标题与仪表盘按钮的样式问题

#### 内部

- 新增贡献指南（CONTRIBUTING），补充测试与提交流程

### English

#### Added

- YOLO mode: optionally auto-approve tool edits and shell execution from Settings
- Sandbox workspace now persists outside the package directory, so skill files survive upgrades and reinstalls

#### Fixed

- Validate and preserve streamed tool-call arguments, fixing truncated or unparsable arguments
- Fixed styling issues in settings cards, documentation headings, and dashboard buttons

#### Internal

- Added CONTRIBUTING with testing and pull-request guidelines

## [0.1.9] - 2026-10-09

### 中文

#### 改进

- 统一应用各处背景，减少页面切换时的色差
- 更新浏览器标签页标题，显示当前所在页面

### English

#### Changed

- Unified application backgrounds to remove color jumps between views
- Updated browser tab titles to reflect the current page

## [0.1.8] - 2026-10-09

### 中文

#### 修复

- 修复编辑器预览与提示词区域的尺寸异常
- 本地化「新话题」标记，切换语言后不再显示原始键值

#### 新增

- 补充 MIT 许可证

#### 内部

- 更新文档与演示视频链接，README 增加玩法展示入口

### English

#### Fixed

- Fixed incorrect sizing in the editor preview and prompt area
- Localized the "new topic" marker so it no longer shows a raw key after switching languages

#### Added

- Added the MIT license

#### Internal

- Refreshed documentation and demo links, and added gameplay showcases to the README

## [0.1.7] - 2026-10-07

### 中文

#### 修复

- 修复导入游戏后参与者座位顺序错乱的问题

### English

#### Fixed

- Fixed participant seat order being scrambled after importing a game

## [0.1.6] - 2026-10-07

### 中文

#### 改进

- 对齐「仅提及」群聊模式下的系统提示词，减少角色误发言

#### 内部

- 文档更新：首页导航、Wiki 启动指南、README 安装说明，并补充开放生态介绍

### English

#### Changed

- Aligned system prompts in mention-only group chats to reduce characters speaking out of turn

#### Internal

- Documentation refresh: homepage navigation, Wiki quick start, README setup, and an open-ecosystem section

## [0.1.5] - 2026-10-07

### 中文

#### 修复

- 修复沙箱服务在 npm 安装场景下无法从包根目录解析的问题

### English

#### Fixed

- Fixed the sandbox server failing to resolve from the package root when installed from npm

## [0.1.4] - 2026-10-07

### 中文

#### 修复

- 补齐 React 子路径依赖的预打包，修复 `npx` 启动时解析失败

### English

#### Fixed

- Prebundled React subpath dependencies to fix resolution failures when starting via `npx`

## [0.1.3] - 2026-10-07

### 中文

#### 修复

- 修复 React DOM 具名导入在预打包后不可用导致的页面白屏

### English

#### Fixed

- Fixed a blank page caused by named React DOM imports breaking after prebundling

## [0.1.2] - 2026-10-07

### 中文

#### 修复

- 修复通过 npm 全局安装或 `npx` 启动时，运行时依赖未预打包导致的启动失败

### English

#### Fixed

- Fixed startup failures after installing from npm or running via `npx` caused by unbundled runtime dependencies

## [0.1.1] - 2026-10-07

### 中文

#### 新增

- 首个公开版本：`npx tavern-harness` 一键启动，自动打开浏览器并支持局域网访问
- 流式对话与工具调用，支持实时思考过程预览
- 角色工坊：角色卡、世界书（Lorebook）、SillyTavern v2/v3 角色卡与 PNG 导入
- 多人群聊与回合队列，支持角色互相 @ 与发言顺序编排
- 内置技能与沙箱执行：文件读写、Shell 白名单命令、代码执行
- 成就系统、统计面板、主题切换与简体中文 / 繁體中文 / English 三语界面
- 游戏完整导出与导入、定时消息
- 本地优先：所有数据保存在本机，不经过第三方服务

#### 内部

- Vite + React + Zustand + Dexie 技术栈，浏览器端本地持久化

### English

#### Added

- First public release: one-command startup with `npx tavern-harness`, auto-opens the browser, and serves the LAN
- Streaming chat with tool calls and live thinking preview
- Character workshop: character cards, lorebooks, SillyTavern v2/v3 cards, and PNG import
- Group chats with a turn queue, character @-mentions, and reorderable speaking order
- Built-in skills and sandboxed execution: file reads/writes, allowlisted shell commands, code execution
- Achievements, stats, themes, and Simplified Chinese / Traditional Chinese / English UI
- Full gameplay export and import, plus scheduled messages
- Local-first: all data stays on your machine and never passes through a third-party service

#### Internal

- Vite + React + Zustand + Dexie stack with browser-side local persistence

<!-- 链接定义 -->
[0.1.12]: https://github.com/Rannichan/Tavern-Harness/compare/v0.1.11...v0.1.12
[0.1.11]: https://github.com/Rannichan/Tavern-Harness/compare/v0.1.10...v0.1.11
[0.1.10]: https://github.com/Rannichan/Tavern-Harness/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/Rannichan/Tavern-Harness/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/Rannichan/Tavern-Harness/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/Rannichan/Tavern-Harness/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/Rannichan/Tavern-Harness/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/Rannichan/Tavern-Harness/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/Rannichan/Tavern-Harness/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Rannichan/Tavern-Harness/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Rannichan/Tavern-Harness/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Rannichan/Tavern-Harness/releases/tag/v0.1.1
