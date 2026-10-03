// Tavern Harness · Wiki 章节 01「这间酒馆是什么」
// 一章一文件：本文件只放内容数据，布局壳在 docs/wiki.html；
// 直接改字符串即可，刷新页面生效（file:// 直开也无需构建/服务器）。
window.WIKI = window.WIKI || { chapters: [] };
window.WIKI.chapters.push({
  id: 'overview',
  group: '开张准备',
  kicker: 'The Beginning',
  title: '这间酒馆是什么',
  lead: 'AI 原生的角色扮演沙盒，构建任意你想要的世界。',
  html: `
    <p><strong>Tavern Harness（酒馆助手）</strong>是一个<strong>AI 原生的角色扮演沙盒</strong>。它跑在你自己的浏览器里：会话、角色卡、世界书、技能、生涯统计，全部存在浏览器 <code>IndexedDB</code>，<strong>不上传任何服务器</strong>。</p>
    <p class="dim">你可以从零搭建世界，让具备技能的智能体在其中行动、协作与成长。以下是 Tavern Harness 的部分特性：</p>

    <div class="grid2">
      <div class="card reveal"><h4>🎭 自由叙事与对话</h4>
        <p class="dim" style="margin-bottom:0">接入任意 OpenAI 兼容 API，支持思考模式、图片/视频附件，以及编辑、重新生成、分支 Fork 和原始日志审阅，让每段剧情都可自由推进与回溯。</p></div>
      <div class="card reveal"><h4>🌍 构建角色与世界</h4>
        <p class="dim" style="margin-bottom:0">用角色卡、Lorebook 世界书和用户人设组织设定；支持最多 5 名 NPC 的回合制群聊、PNG 导入与游戏导出分享。</p></div>
    </div>
    <div class="grid2">
      <div class="card reveal"><h4>🛠 让角色获得技能</h4>
        <p class="dim" style="margin-bottom:0">角色不只是对话 NPC：可以直接调用 19 项内置工具，也能随时委托酒馆老板创建你需要的新技能。</p></div>
      <div class="card reveal"><h4>🗂 保留可持续的游戏状态</h4>
        <p class="dim" style="margin-bottom:0">会话拥有独立工作目录，可读写和展示文件、执行受控本地命令；数据保存在本机浏览器中，让世界<b>有状态、可存档、可延续</b>。</p></div>
    </div>

    <div class="moat"></div>
  `,
});
