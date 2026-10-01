// Tavern Harness · Wiki 章节 01「这间酒馆是什么」
// 一章一文件：本文件只放内容数据，布局壳在 docs/wiki.html；
// 直接改字符串即可，刷新页面生效（file:// 直开也无需构建/服务器）。
window.WIKI = window.WIKI || { chapters: [] };
window.WIKI.chapters.push({
  id: 'overview',
  group: '开张准备',
  num: '壹',
  kicker: 'The Beginning',
  title: '这间酒馆是什么',
  lead: '一段话版本：本地优先的 AI 角色扮演酒馆，高自由度沙盒，构建任意你想要的世界。',
  html: `
    <p><strong>Tavern Harness（酒馆助手）</strong>是一个<strong>纯前端 Web 应用 + 可选的本地沙箱服务</strong>。它跑在你自己的浏览器里：会话、角色卡、世界书、技能、生涯统计，全部存在浏览器 <code>IndexedDB</code>，<strong>不上传任何服务器</strong>。</p>
    <p class="dim">从这里开始，请记住：这里的每一个「角色」都是具备技能拓展的智能体，不只是会说话的嘴替。酒馆老板与它身后的生成式技能，是实现这一切的根基。</p>

    <div class="grid2">
      <div class="card reveal"><h4>🎭 对话层</h4>
        <p class="dim" style="margin-bottom:0">任意 OpenAI 兼容 API、思考模式（Reasoning Effort）、图片/视频附件、消息右键编辑 / 重新生成 / Fork 分支 / 原始日志。</p></div>
      <div class="card reveal"><h4>🎭 世界层</h4>
        <p class="dim" style="margin-bottom:0">角色卡（对标 SillyTavern）、Lorebook 世界书、群聊回合制（最多 5 NPC + 玩家）、用户人设、PNG 导入、游戏导出分享。</p></div>
    </div>
    <div class="grid2">
      <div class="card reveal"><h4>🛠 技能层</h4>
        <p class="dim" style="margin-bottom:0">19 项内置原生工具 + 6 类生成式执行类型（<code>template</code> / <code>http_get</code> / <code>javascript</code> / <code>file_read</code> / <code>file_write</code> / <code>shell</code>），可现场拜托酒馆老板造新技能。</p></div>
      <div class="card reveal"><h4>🗂 沙盒层</h4>
        <p class="dim" style="margin-bottom:0">会话专属工作目录、公共目录 <code>public/</code>、受控本地命令、文件读写与展示——让游戏<b>有状态、有存档、有画面</b>。</p></div>
    </div>

    <div class="moat"></div>
  `,
});
