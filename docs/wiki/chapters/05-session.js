// Tavern Harness · Wiki 章节 05「创建对话」
window.WIKI = window.WIKI || { chapters: [] };
window.WIKI.chapters.push({
  id: 'session',
  group: '酒馆日常',
  kicker: 'Create',
  title: '创建对话',
  lead: '开聊的两条路：侧栏「<i class="ic" data-ic="plus"></i> 新建」现开一局，或「<i class="ic" data-ic="import"></i> 导入」一键入馆整局游戏。',
  html: `
    <h3>从零创建对话</h3>
    <p>点击「<i class="ic" data-ic="plus"></i> 新建」打开创建对话弹窗：</p>
    <ol class="steps">
      <li><b>参与角色</b>：至少选一位角色；<span class="mono">玩家（用户）默认队首</span>，可拖拽排序发言顺序。选 1 位角色就是单聊，选 2–5 位自动成群聊。</li>
      <li><b>对话名称</b>：默认由角色名拼出，可自己改。</li>
      <li><b>随机顺序</b>：开启后每轮洗牌（RANDOM）；关闭则固定座位顺序（PRESET）。仅对群聊有意义，单聊无轮换。</li>
      <li><b>启用开场白</b>：单聊启用 NPC 开场白；群聊仅当首位发言者是角色时启用其开场白。角色若有多个开场白，<span class="mono">随机选一条</span>。</li>
      <li><b>用户人设（可选）</b>：从「不在会话中的角色卡」中选择，你将以该身份入戏。</li>
      <li><b>世界书（可选）</b>：为这局对话绑定一份世界观。</li>
    </ol>

    <h3>从JSON重建游戏</h3>
    <p>点击「<i class="ic" data-ic="import"></i> 导入」打开游戏导入弹窗：</p>
    <ul class="plain">
      <li><b>重建完整游戏</b>：会根据导入的JSON数据自动创建需要的角色卡 / 世界书 / 技能，并创建包含上述内容的对话。</li>
      <li><b>绝不覆盖</b>：重名角色卡 / 世界书 / 技能会自动以副本创建，不会覆盖已有的内容。</li>
      <li>导入成功会提示：<code>新角色 {n} 个、世界书 {n}、技能 {n} 个、对话 {n} 条</code>——游戏导出分享详见「导出 & 导入」章。</li>
    </ul>

    <h3>会话管理</h3>
    <ul class="plain">
      <li>侧栏会话列表支持<b>搜索</b>（标题 + 消息内容）、<b>置顶</b>、活动指示点（正在生成或有新回复）。</li>
      <li>会话右键菜单：<b>编辑会话</b> / <b>置顶对话</b> / <b>导出游戏</b> / <b>删除会话</b>。</li>
      <li>删除会话会同时清理其专属工作目录 <code>sandbox_workspace/session-&lt;id&gt;/</code>；内置「酒馆老板」的公区对话例外，见「工作区与文件」章。</li>
    </ul>
    <div class="moat"></div>
  `,
});
