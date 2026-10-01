// Tavern Harness · Wiki 章节 09「导入 PNG / 游戏」
window.WIKI = window.WIKI || { chapters: [] };
window.WIKI.chapters.push({
  id: 'import',
  group: '世界搭建',
  num: '玖',
  kicker: 'Import',
  title: '导入 PNG / 游戏',
  lead: 'SillyTavern 生态角色卡与完整游戏一键入馆。',
  html: `
    <h3>SillyTavern PNG 角色卡</h3>
    <ul class="plain">
      <li>入口在「角色工坊 → 👤 角色卡 / 📖 世界书」页顶部「<b>PNG 导入</b>」。</li>
      <li>支持 <b>chara V2</b>（含 data 信封）与 <b>ccv3</b>（含裸字段变体）两种格式；上限 8MB。</li>
      <li>解析结果<b>先预填不落库</b>，检查确认后才保存；自动拆解人设分节（角色描述/性格/场景/示例对话/系统提示词）、多开场白（去重，取前 20 条）与内嵌世界书条目。</li>
    </ul>

    <h3>游戏 JSON（本应用生态）</h3>
    <ul class="plain">
      <li>侧栏「<b><i class="ic" data-ic="import"></i> 导入</b>」→ <code>选择游戏 JSON 文件…</code> → 「<b>导入并重建</b>」。</li>
      <li><b>冲突策略：绝不覆盖</b>——重名角色/世界书/技能自动建「(2)」副本，会话一律新建，消息按原顺序与相对时间间隔重建。</li>
      <li>成功提示会报数：<code>新角色 {n} 个、世界书 {n}、技能 {n} 个、对话 {n} 条</code>；导入内容分配<b>全新的独立工作目录</b>。</li>
    </ul>
    <div class="moat"></div>
  `,
});
