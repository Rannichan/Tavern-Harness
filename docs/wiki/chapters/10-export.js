// Tavern Harness · Wiki 章节 10「导出、分享与 Fork」
window.WIKI = window.WIKI || { chapters: [] };
window.WIKI.chapters.push({
  id: 'export-share',
  group: '世界搭建',
  num: '玖',
  kicker: 'Export & Share',
  title: '导出与分享',
  lead: '轻松分享你创建的游戏。',
  html: `
    <h3>导出游戏</h3>
    <p>会话右键「<b>导出游戏</b>」或会话头部分享按钮打开弹窗：</p>
    <ul class="plain">
      <li><b>包含对话历史</b>（可选开关）：勾选后 JSON 会包含全部消息记录。</li>
      <li>导出内容 = 会话设置（模式/标题/世界书/用户人设/发言顺序/开场白开关/队列）+ 全部参与角色卡（人设/开场白/头像/启用技能）+ 所需生成式技能。</li>
      <li>消息剔除 token/延迟模型等调试字段，只留正文；保存走系统「另存为」，不支持时回退默认下载目录。</li>
    </ul>

    <h3>导入游戏 JSON</h3>
    <ul class="plain">
      <li>侧栏「<b><i class="ic" data-ic="import"></i> 导入</b>」→ <code>选择游戏 JSON 文件…</code> → 「<b>导入并重建</b>」。</li>
      <li><b>冲突策略：绝不覆盖</b>——重名角色/世界书/技能自动建「(2)」副本，会话一律新建，消息按原顺序与相对时间间隔重建。</li>
      <li>成功提示会报数：<code>新角色 {n} 个、世界书 {n}、技能 {n} 个、对话 {n} 条</code>；导入内容分配<b>全新的独立工作目录</b>。</li>
    </ul>

    <div class="co co-note reveal"><span class="co-ic">🎁</span><div class="co-body">把 JSON 发给朋友，对方按上面的流程还原整个世界后即可继续游玩。</div></div>
    <div class="moat"></div>
  `,
});
