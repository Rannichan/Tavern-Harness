// Tavern Harness · Wiki 章节 10「导出、分享与 Fork」
window.WIKI = window.WIKI || { chapters: [] };
window.WIKI.chapters.push({
  id: 'export-share',
  group: '世界搭建',
  num: '拾',
  kicker: 'Share & Fork',
  title: '导出、分享与 Fork',
  lead: '你的世界可以打包随身携带。',
  html: `
    <h3>导出游戏</h3>
    <p>会话右键「<b>导出游戏</b>」或会话头部分享按钮打开弹窗：</p>
    <ul class="plain">
      <li><b>包含对话历史</b>（可选开关）：勾选后 JSON 会包含全部消息记录。</li>
      <li>导出内容 = 会话设置（模式/标题/世界书/用户人设/发言顺序/开场白开关/队列）+ 全部参与角色卡（人设/开场白/头像/启用技能）+ 所需生成式技能。</li>
      <li>消息剔除 token/延迟模型等调试字段，只留正文；保存走系统「另存为」，不支持时回退默认下载目录。</li>
    </ul>

    <h3>Fork 分支</h3>
    <p>任意消息右键 → 「<b>创建分支 / Fork</b>」：同一段历史分岔出平行世界，每个分支拥有独立工作目录，互不打扰。适合「多种结局并行推进」或回滚实验。</p>

    <div class="co co-note reveal"><span class="co-ic">🎁</span><div class="co-body">把 JSON 发给朋友，对方侧栏「导入」还原整个世界后即可继续游玩。<b>分享游戏的门槛=零配置</b>；唯一前提是对方也需要一个自己的 API Provider。</div></div>
    <div class="moat"></div>
  `,
});
