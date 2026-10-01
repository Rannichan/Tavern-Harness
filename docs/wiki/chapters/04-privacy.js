// Tavern Harness · Wiki 章节 04「数据与隐私」
window.WIKI = window.WIKI || { chapters: [] };
window.WIKI.chapters.push({
  id: 'privacy',
  group: '开张准备',
  num: '肆',
  kicker: 'Privacy',
  title: '数据与隐私',
  lead: '你的数据只在你的设备上。',
  html: `
    <ul class="plain">
      <li><b>存在哪</b>：浏览器 <code>IndexedDB</code>（会话、配置、角色卡、世界书、技能、统计、API Key）——<span class="mono">不上传任何服务器</span>。</li>
      <li><b>和什么绑定</b>：浏览器 + 站点 + <span class="mono">端口</span>。换浏览器 / 开隐身窗 / 换端口都会看不到旧数据——这是浏览器安全机制，不是 Bug。</li>
      <li><b>如何迁移</b>：会话页右上角「分享对话」导出会话 JSON（自定义文件名与保存位置）；或整局「导出游戏」（见「导出、分享与 Fork」）。</li>
    </ul>
    <div class="co co-warn reveal"><span class="co-ic">🔒</span><div class="co-body"><b>API Key 也存在本地</b>。提交 Issue 或分享日志时请务必注意脱敏 API Key。本地命令服务凭一次性票据与双 token 机制保护，仅监听 <code>127.0.0.1</code>，且会以当前用户权限运行命令——详细边界见「确认门控与安全边界」。</div></div>
    <div class="moat"></div>
  `,
});
