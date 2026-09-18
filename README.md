# Tavern Harness · 酒馆助手

MyAgent-Android（Mioo）的 Web 版复刻——一个本地优先的 AI 助手 / Agent 聊天客户端，跑在你自己的浏览器里。

**Tavern Harness** 提供与 Android 版一致的功能：任意 OpenAI 兼容 API、多 Provider 管理、角色卡（NPC）、Lorebook、生成式技能、群聊回合制、多模态附件、定时消息、生涯统计等。所有数据通过 IndexedDB 存储在本地，无需自建服务端。

> ⚠️ **数据说明**：全部数据（会话、配置、角色等）保存在浏览器 IndexedDB 中，**与浏览器、端口、站点绑定**。换浏览器（如 Chrome → Safari）、开隐私窗口、或换端口访问会看不到旧数据——这是浏览器安全机制，属于正常现象。如需迁移，可在对话页右上角「分享对话」导出会话 JSON（可自定义保存位置与文件名）。

## ✨ 功能

### 对话
- 任意 OpenAI 兼容 `chat/completions` 接口，**流式输出**（SSE）
- **多 Provider 管理**：Base URL / API Key，连通性测试与模型列表拉取
- **思考模式**：独立展示 thinking 内容（`reasoning` / `reasoning_content` / `thinking_content`），支持 Qwen `chat_template_kwargs` 适配
- **原生工具调用**：OpenAI `tools` 协议，本地真实执行，`role=tool` 结果回灌，最多 4 层 ReAct 链式调用
- **多模态附件**：图片（粘贴 / 选择）随消息发送为 data URL
- **消息管理**：右键编辑历史消息、重新生成回复、查看原始请求/响应日志（自动脱敏）
- **中断生成**：可随时停止流式输出，已生成部分自动持久化
- **魔法命令**：`/new` 开始新话题（截断上下文）、`/pass` 跳过本轮发言（群聊）
- **Markdown 渲染**：代码高亮、表格、行内/块级数学公式（KaTeX）
- 每条消息记录延迟、token 用量、tokens/s、所用模型等指标

### 会话模式
- **标准对话（STANDARD）**：与助手一对一
- **NPC 对话**：与单个角色卡对话，独立人设、开场白、技能配置
- **群聊（GROUP）**：2~5 位 NPC 同场对话
  - 回合制：PRESET（按座位顺序）/ RANDOM（随机）
  - `@角色名` 直接指定下一个发言者
  - 玩家可扮演角色（User Persona）

### 角色工坊（对标 SillyTavern）
- **角色卡（NPC）**：人设、开场白、彩色首字母头像 / 选图，编辑页内按角色启用技能（内置角色「酒馆老板」默认启用全部内置技能）
- **SillyTavern PNG 导入**：chara V2 / ccv3 V3 一键导入，解析人设、开场白、内嵌Lorebook
- **Lorebook**：世界观设定附加在人设后，可绑定到会话
- **技能表（工具）**：
  - 内置：`run_shell_script`（本地沙箱执行）、`roll_dice`、`create_skill` / `update_skill` / `delete_skill`、`get_tavern_info`、角色与Lorebook CRUD
  - **生成式技能**：`template` / `http_get` / `javascript`（Web Worker 沙箱，支持 async/await，可注入 `$read`/`$write`/`$append`/`$list` 持久化游戏状态）/ `file_read` / `file_write` / `shell`（真实执行，白名单直执 + 高危弹窗）/ `device_action`（通知 / 震动）
  - **确认门控**：更新/删除类操作、以及**高危 shell 命令**均弹出确认框

## 🚀 使用

```bash
npm install
npm run dev      # 开发
npm run build    # 构建
npm run preview  # 预览
```

然后在「设置 → 模型服务 Provider」中：

1. 添加 Provider：名称、Base URL、API Key，启用后点击「测试连接」拉取模型列表
2. 在聊天页顶部点击模型名选择模型
3. 回到对话，开聊！

## 🛡️ 生成式技能 `shell` 的真实执行沙箱

`shell` 类型默认在浏览器内虚拟工作区模拟（`file_read` / `file_write` 使用 IndexedDB）。如需让 `shell` 技能执行**真实本地命令**，无需手动操作——**开发服务器（`npm run dev`）会在首次收到 `/api-v2/exec` 请求时自动拉起沙箱服务**（`node sandbox-server.mjs`，默认为本机 `127.0.0.1:17891`），并复用已有实例（手动先启动也可，不会被重复拉起）。

```bash
npm start          # 或 npm run dev —— 沙箱自动随启
```

也可以手动单独启动（可选，常用于调试独立沙箱）：

```bash
node sandbox-server.mjs            # 默认端口 17891
```

启用后：

- 开发服务器（`npm run dev`）会自动把 `/api-v2/exec` 转发给该服务；已编译产物（`npm run preview` / 静态部署）需在同一站点额外部署该服务（或手动代理）。
- **权限模型（命令分级）**：
  - **直接执行命令 → 不需确认**：`pwd`、`ls`、`cat`、`touch`、`mkdir`、`cp`、`grep`、`sed`、`tar`、`gzip`、`unzip`、`zip`、`jq`、`awk`、`xargs`、`tee`、`whoami`、`uname`、`uptime`、`node`、`git` …
  - **高危黑名单命令 → 弹窗确认后执行**：`sudo`、`su`、`dd`、`mkfs`、`fdisk`、`mount`、`chmod`、`chown`、`kill`、`curl`、`wget`、`nc`、`ssh`、`scp`、`shutdown`、`reboot`、`systemctl`、`docker`、`kubectl` …（前端先弹窗展示整段脚本，用户批准后带 `confirmed` 标记重发，服务端才放行；拒绝返回 `CANCELLED`）
  - **其余命令 → 一律拒绝**（前后端双重检查，无弹窗）
- 其余规范：仅允许 `https://`（见 `http_get` 内网封锁）、单条命令 5s 超时、输出截断、脚本 ≤ 8000 字符 / ≤ 20 行、每行一条命令（无 shell 解释器，`&` `|` `;` `>` 等仅为普通参数，不构成拼接/注入）。
- 该服务仅监听 `127.0.0.1`，不对外暴露；未启动时返回明确错误提示。

### 会话隔离的工作目录

每个对话（会话）在创建时都会分配一个**以会话 id 命名的专属工作目录**：`sandbox_workspace/session-<会话id>/`（单层目录，直接位于工作区根下，不再嵌套）。该会话下所有工具调用——`run_shell_script`、`file_read` / `file_write`、生成式技能的 `shell` 与 `javascript`（`$read` / `$write` / `$append` / `$list`）——都**只在这一个目录内进行**：

- **创建对话时即预建其工作目录**（沙箱服务运行时真实建目录；未启动则静默跳过，首次工具调用时自动补建）；
- 删除对话时会**一并删除其专属工作目录**（磁盘目录 + 沙箱未启动时写入浏览器虚拟工作区 IndexedDB 的数据一并清理）；
- shell 命令以该目录为 `cwd` 执行；
- 文件读写 / 文件列表只对该目录可见（无法访问其它会话的工作目录）；
- 浏览器虚拟工作区（沙箱未启动时的回退）同样按会话隔离：`generated_skill_workspace/sessions/session-<会话id>/…`；
- 不同会话之间的文件互不可见、互不影响，游戏状态（血量 / 好感度等）天然按会话隔离。

旧会话（在本功能上线前创建）没有工作目录字段，沿用共享根工作区 `sandbox_workspace/`，行为与之前一致。会话头部副标题会显示当前会话的工作目录名（如 `session-12`）。

### 生成式技能 `file_read` / `file_write` 的真实磁盘工作区

当本地沙箱服务运行（开发服务器自动拉起）时，技能的 `file_read` / `file_write` 会读写项目根目录下的 **`sandbox_workspace/`** 真实文件夹（首次写入自动创建，已被 `.gitignore` 忽略）。技能可以：

- 读取工作区内任意相对路径文件（单文件 ≤ 100KB，超出截断）
- 写入 / 追加文件（相对路径，禁止 `..` / 绝对路径 / 符号链接逃逸，单文件 ≤ 400KB）
- 通过 `file_list` 端点列出工作区文件（上限 500 个）

> ⚠️ **权限边界**：技能的所有文件操作都被**限制在 `sandbox_workspace/` 目录内**，无法访问项目其它文件（`http_get` 同样屏蔽内网）。沙箱服务未启动时，`file_*` 自动回退到浏览器 IndexedDB 虚拟工作区，行为与之前一致。你可以随时在编辑器 / 资源管理器里直接查看、修改 `sandbox_workspace/` 下的文件——技能读写的就是这些真实文件。

### 本地 / 局域网服务（CORS）

浏览器出于安全会拦截跨域请求。若你的 OpenAI 兼容服务（如局域网内 `http://192.168.x.x:8788/`）**未开放 CORS 头**，请求会自动回退到内置代理：Vite 开发服务器在**服务端**把 `/api/<host:port>/` 转发到目标服务，浏览器同源不再受限（`npm run build` 后的静态部署不包含此代理）。

- `测试连接` 与对话请求均会自动尝试直连，CORS 被拦时自动改用代理（仅内网/局域网地址）
- 代理连通后，Provider 的 Base URL 会被自动改写为同源代理形式并保存，无需手动填写

## 🛠 技术栈

- React 18 + TypeScript + Vite
- Zustand（全局状态）
- Dexie.js（IndexedDB ORM，对应 Room）
- KaTeX（数学渲染）
- marked（Markdown 解析）
- Web Worker 沙箱（JavaScript 技能隔离执行）

## 📁 结构

```
src/
├── core/               # 领域逻辑（提示词组装 / 回合循环 / OpenAI 客户 / 工具引擎 / 统计）
│   └── tools/          # 内置工具 + 生成式技能执行器 + 虚拟文件系统
├── db/                 # Dexie 数据库与种子数据
├── store/              # Zustand 全局状态（对应 MainViewModel）
├── components/         # React UI
├── theme/              # 主题系统（4 主题 × 明暗）
└── types/              # 领域模型
```

## 📝 说明

- Web 版将设备专属功能映射为等效实现：震动 → `navigator.vibrate`；通知 → Notification API；shell 命令 → 白名单模拟；本地端口转发 → 不适用（浏览器环境）
- API Key 只存储在浏览器本地 IndexedDB，不上传任何服务器