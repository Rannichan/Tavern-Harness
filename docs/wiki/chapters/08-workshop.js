// Tavern Harness · Wiki 章节 08「角色工坊与世界观」
window.WIKI = window.WIKI || { chapters: [] };
window.WIKI.chapters.push({
  id: 'workshop',
  group: '世界搭建',
  num: '捌',
  kicker: 'Workshop',
  title: '角色工坊与世界观',
  lead: '三个标签页：<span class="chip">👤 角色卡</span> <span class="chip">📖 世界书</span> <span class="chip">🛠 技能表</span>',
  html: `
    <h3>👤 角色卡</h3>
    <ul class="plain">
      <li><b>字段</b>：上传头像（图片 → data URL，可清除）· 名称 · 人设 Prompt（注入 system prompt）· 开场白 Greeting · 启用技能（{a}/{b}，复选 tag）。</li>
      <li><b>多开场白</b>：「添加开场白」可建备用版本，<span class="mono">每次新对话随机选择一条</span>。</li>
      <li><b>内置角色</b>「酒馆老板」默认启用全部内置技能、<span class="mono">受保护不可删除</span>。</li>
      <li>技能默认对新角色<b>未启用</b>——去编辑角色的「启用技能」里勾选生效。</li>
    </ul>

    <h3>📖 世界书（Lorebook）</h3>
    <ul class="plain">
      <li>表单：<code>世界书名</code> + <code>内容（附加在角色人设之后）</code>，支持 Markdown 渲染预览。</li>
      <li>内容会在系统提示词中以 <code>=== 世界书 ===</code> 分节附加在人设后，可<b>按会话绑定</b>。</li>
      <li>SillyTavern PNG 角色卡内嵌世界书导入时会自动解析为条目文本。</li>
    </ul>

    <h3>🛠 技能表</h3>
    <ul class="plain">
      <li>分组：内置技能（{n}）/ 自定义技能（{n}）/ 导入技能（{n}）；组内<b>拖拽排序</b>（持久化）。</li>
      <li>卡片显示名称 / 描述 / <code>实现类型: {t}</code>；「详情」弹窗展示描述、参数 Schema、声明式实现与原始 OpenAI Tool JSON。</li>
      <li><b>内置技能受保护</b>：不可删除，使用 <code>update_skill</code> 修改亦被拒。</li>
    </ul>
    <div class="co co-ok reveal"><span class="co-ic">🧩</span><div class="co-body">角色 = 人设 + 开场白 + 启用的技能。一个侦探角色可以是「推理人设 + roll_dice + file_read」的组合——世界观决定了他们<b>能做什么</b>，而不仅是说什么。</div></div>
    <div class="moat"></div>
  `,
});
