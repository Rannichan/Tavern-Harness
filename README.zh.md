# Tavern Harness · AI 原生的角色扮演沙盒

[GitHub 仓库](https://github.com/Rannichan/Tavern-Harness) · [产品主页](https://rannichan.github.io/Tavern-Harness/) · [高自由度沙盒](https://rannichan.github.io/Tavern-Harness/#world) · [问题反馈](https://github.com/Rannichan/Tavern-Harness/issues) · [讨论区](https://github.com/Rannichan/Tavern-Harness/discussions) · [Discord 交流](https://discord.gg/kPSWGeaHx) · [技能沙箱设计文档](./notebook/skill-sandbox-design.md)

<a id="run"></a>
## 1 · 如何运行

> 需要本机装有 **Node.js ≥ 18**。Tavern Harness 是一个纯前端 Web 应用 + 可选的本地沙箱服务，无需 Docker、无需数据库服务。

### 方式一：一键启动（推荐）

无需克隆仓库或全局安装：

```bash
npx tavern-harness
```

首次运行会下载包、启动本地服务，并自动打开浏览器。可选参数：

```bash
npx tavern-harness --no-open
npx tavern-harness --port 5273
```

服务仅监听本机。使用 shell 技能时，命令会以启动命令的当前用户权限在本机执行；请仅运行来自可信来源的版本，并审阅每次命令确认弹窗。

### 方式二：从源码开发

```bash
git clone https://github.com/Rannichan/Tavern-Harness.git
cd Tavern-Harness
npm install
npm run dev      # 开发服务器默认端口 5173，被占用时自动顺延
```

### 首次启动配置模型服务

启动后到「**设置 → 模型服务 Provider**」：

1. **添加 Provider**：名称 + Base URL + API Key —— 支持任意 OpenAI 兼容 `chat/completions` 接口（OpenAI / DeepSeek / Qwen / SiliconFlow / Ollama / LM Studio / 自建 vLLM 均可）
2. **测试连接**：自动拉取模型列表。若目标服务未开 CORS 头，会自动经内置同源代理转发（仅限内网 / 局域网地址），成功后 Base URL 自动改写为代理形式保存
3. **选模型**：聊天页顶部点击模型名即可，回到对话开聊！

### 数据隐私须知

- **全部数据存在浏览器 IndexedDB 里**：会话、角色卡、世界书、技能、统计、API Key，均**不上传任何服务器**。
- 数据与浏览器、端口、站点绑定：换浏览器 / 开隐身窗 / 换端口看不到旧数据——这是浏览器安全机制，属正常现象。请确保每次在同一个端口启动、并在同一个浏览器打开。

<a id="features"></a>
## 2 · 产品特色

### 🍺 酒馆老板随时为您服务

无论是构建角色卡这种小事儿，还是设计跑团玩法这种累活儿，再或者你只是不知道从何入手，都可以来找酒馆老板！

我们为酒馆进行了全方位的 AI 装修，让游戏的创建和体验都更加简单。

### 🛠️ 技能系统

所有的角色不再是只能对话的角色，而是**具备技能拓展的智能体**：为每一个角色装备需要的技能，实现更高级的玩法。

酒馆已经提供了一些必要的技能（例如掷骰子）；同时你也可以拜托酒馆老板，**创建任意你想要的技能**~

### 💬 多角色群聊

每个房间支持添加**至多 6 个角色**，并提供类似于回合制游戏的行动顺序表，轻松管理多人对话。

支持 **@ 角色** 和**跳过**，模拟真实的多人对话场景——无论是从上帝视角观测角色们的行为，还是亲自代入角色参与其中，总能找到你的玩法。

### 🎁 和朋友分享你的游戏

兼容 **Tavern 生态**，一键导入 PNG 角色卡。

同时支持**游戏一键打包分享**：对方直接导入即可游玩，无需手动创建角色、技能、配置对话。

### 🍃 完全本地 / 简洁干净

目前支持 **OpenAI 格式的 API 接口**：你可以使用你的 token plan，也可以自己本地部署模型，一切数据都保存在本地。

项目不依赖任何外部 harness，UI 也经过了精细打磨，提供简洁干净的体验。

<a id="gameplay"></a>
## 3 · 玩法示例

> 「玩法示例」由浅入深：前三例零配置开箱即玩，后四例逐步解锁沙盒能力。所有例子中的「老板」＝内置角色「酒馆老板」，首次启动即存在，默认启用全部内置技能。

### 示例一：深夜陪伴（零门槛）

1. 新建对话 → 选「NPC 对话」→ 角色「酒馆老板」（或任意自定义角色）
2. 直接开聊，像跟朋友一样对话；开启**思考模式**还能看到老板的内心盘算
3. 长按 / 右键任意消息：编辑历史、重新生成、查看原始日志、Fork 分支

### 示例二：跑团掷骰（角色扮演）

1. 新建「NPC 对话」，角色当 GM：人设写上「你是主持本团的 GM，用 roll_dice 决定命运」
2. 开场白抛出剧情钩子；老板会自动调用 `roll_dice`，并在消息里呈现「大成功！/ 大失败！」
3. 把团规、世界观写进 Lorebook 绑定到该会话，人设即刻变成一个完整世界

### 示例三：群聊剧本（最多 6 人一台戏）

1. 「角色工坊」里建多个 NPC（如侦探、管家、女主）
2. 新建「群聊」对话，添加至多 6 个角色：拖拽设定发言顺序，或开启随机洗牌
3. 用 `@角色名` 点名下一个发言者；输入 `/new` 开新话题（截断上下文）；输入 `/pass` 跳过自己本轮发言

### 示例四：现场造技能（自造能力）

1. 对老板说：「帮我生成一个技能，输入城市名返回天气」，它会调用 `create_skill` 写出 `template` / `http_get` 实现的新技能
2. 新技能默认未启用于任何角色，去「角色工坊 → 技能表」为要用的角色勾选生效
3. 技能支持 `$read` / `$write` / `$append` / `$list` 桥接会话工作区，无需重启即时生效

### 示例五：持久化小游戏（沙盒高阶）

1. 让老板写一个 `javascript` 技能实现好感度系统：每轮数值经 `$write` 存进工作目录 `state.json`
2. 再写一个读取 `$read` 的技能，用 `file_write` 生成 HTML 仪表盘 `dashboard.html`
3. `file_display` 直接弹窗图形化展示数值变化（HTML 沙箱渲染、可缩放、可画中画），工作区内文件均可预览
4. 删除会话时磁盘目录 `sandbox_workspace/session-<id>/` 自动一并清理

### 示例六：整理文件（shell）

1. 对话里让老板 `ls` 看工作区、`cat` 读文件、`cp` 归档你的创作文稿
2. 读写必须留在本会话工作目录内；白名单外命令（如 `node`、`git`）与 `mv` / `rm` 类修改操作都会先弹窗确认再执行
3. 普通会话对公共目录 `public/` 只读——只有内置「酒馆老板」的会话能写入公共区，供所有会话共享素材

### 示例七：携带整个世界（导入导出 / Fork）

1. 一局游戏玩到中期，「导出游戏」勾选是否包含对话历史，得到一个自包含 JSON
2. 把 JSON 发给朋友，对方「导入游戏」一键还原你的角色与世界（冲突自动建副本不覆盖）
3. 或自己「创建分支 / Fork」：同一段历史分岔出多个平行结局

<a id="feedback"></a>
## 4 · 交流反馈

- 🐛 发现 Bug / 提需求 → [GitHub Issues](https://github.com/Rannichan/Tavern-Harness/issues)，欢迎附上导出的游戏 JSON 或浏览器控制台日志（务必注意脱敏 API Key 哦）
- 🟣 用法讨论 / 玩法灵感 / 分享你的角色卡与技能 / 围观开发进展 → 加入 [Discord 社区](https://discord.gg/kPSWGeaHx)
- 🤝 欢迎提交 Pull Request：我最喜欢写bug了
- 📣 想第一时间收到更新，点个 Star / Watch 就好

> 酒馆24小时营业，老板随时为您服务！
