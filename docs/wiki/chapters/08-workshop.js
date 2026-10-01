// Tavern Harness · Wiki 章节 08「角色工坊与世界观」
window.WIKI = window.WIKI || { chapters: [] };
window.WIKI.chapters.push({
  id: 'workshop',
  group: '世界搭建',
  num: '捌',
  kicker: 'Workshop',
  title: '角色工坊与世界书',
  lead: '从左上角 <span class="chip chip-main"><i class="ic" data-ic="users"></i> 角色工坊</span> 进入 → 三个标签页：<span class="chip">👤 角色卡</span> <span class="chip">📖 世界书</span> <span class="chip">🛠 技能表</span>',
  html: `
    <h3>SillyTavern PNG 角色卡导入</h3>
    <ul class="plain">
      <li>入口在「角色工坊 → 👤 角色卡 / 📖 世界书」页顶部「<b>PNG 导入</b>」。</li>
      <li>支持 <b>V2</b> 与 <b>V3</b> 两种格式；上限 8MB。</li>
      <li>解析结果<b>先预填不落库</b>，检查确认后才保存；自动拆解人设分节（角色描述/性格/场景/示例对话/系统提示词）、多开场白（去重，取前 20 条）与内嵌世界书条目。</li>
    </ul>

    <h3>👤 角色卡</h3>
    <ul class="plain">
      <li><b>可编辑字段</b>：头像、角色名称、人设 Prompt、开场白 Greeting、启用技能。</li>
      <li><b>多开场白</b>：「添加开场白」可建备用版本，<span class="mono">每次新对话随机选择一条</span>。</li>
      <li><b>内置角色</b>「酒馆老板」默认启用全部内置技能、<span class="mono">受保护不可删除</span>。</li>
      <li>技能默认对新角色<b>未启用</b>——去编辑角色的「启用技能」里勾选生效。</li>
    </ul>

    <h3>📖 世界书</h3>
    <ul class="plain">
      <li>可编辑字段：<code>世界书名</code> + <code>世界书内容</code>，支持 Markdown 渲染预览。</li>
      <li>内容会在系统提示词中以 <code>=== 世界书 ===</code> 分节附加在人设后，可<b>按会话绑定</b>。</li>
      <li>SillyTavern PNG 角色卡内嵌世界书导入时会自动解析为条目文本。</li>
    </ul>

    <h3>🛠 技能表</h3>
    <ul class="plain">
      <li>分组：自定义技能 / 导入技能 / 内置技能（不可修改）；支持<b>拖拽排序</b>。</li>
      <li>卡片显示名称 / 描述 / 实现类型；「详情」弹窗展示描述、参数 Schema、声明式实现与原始 OpenAI Tool JSON。</li>
      <li><b>内置技能受保护</b>：不可删除，使用 <code>update_skill</code> 修改亦被拒。</li>
    </ul>
    <div class="co co-ok reveal"><span class="co-ic">🧩</span><div class="co-body">角色卡定义了角色的人设，世界书定义了世界观和游戏的玩法，技能则是赋予角色在世界观下进行游戏的能力。</div></div>
    <div class="moat"></div>
  `,
});
