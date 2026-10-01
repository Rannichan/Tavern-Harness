// Tavern Harness · Wiki 章节 18「常见问题」
window.WIKI = window.WIKI || { chapters: [] };
window.WIKI.chapters.push({
  id: 'faq',
  group: '高手进阶',
  num: '拾陆',
  kicker: 'FAQ',
  title: '常见问题',
  lead: '老板最常被问到的几件事。',
  html: `
    <details class="faq reveal"><summary>测试连接失败，提示「疑似 CORS 跨域被拦截」？</summary>
      <div class="faq-body">多数公共 API 不开 CORS 头。应用已自动尝试经内置代理转发（仅限内网/局域网地址；公网 HTTPS 不代理）。仍失败时检查：Base URL 是否以 <code>/v1</code> 收尾、Key 是否有效、服务是否在线。可分别在「{base}/models」与「{base}/v1/models」两条路径间自动重试。</div>
    </details>
    <details class="faq reveal"><summary>换浏览器 / 换端口后数据不见了？</summary>
      <div class="faq-body">这是浏览器安全机制：IndexedDB 与浏览器+站点+端口绑定。始终用同一端口启动、同一浏览器打开；迁移用「分享对话」或「导出游戏」JSON。</div>
    </details>
    <details class="faq reveal"><summary>工具调用卡片是红色的 <code>ERROR:</code>？</summary>
      <div class="faq-body">常见原因：沙箱服务未启动（首次访问 <code>/api-v2/…</code> 时会自动拉起，失败后 5s 退避重试）、路径越出会话工作区、http_get 打到内网地址、JS 超时等。展开卡片可见具体原因，逐项排查即可。</div>
    </details>
    <details class="faq reveal"><summary>面板/队列里模型一直重复同一个工具调用？</summary>
      <div class="faq-body">相同参数连续调用 3 次会触发「Agent 执行限制」弹窗；拒绝则终止本回合。确认后计数重置继续。避免方案：让模型在工具结果后先思考再行动。</div>
    </details>
    <details class="faq reveal"><summary>群聊里 NPC 抢我台词 / 互相代写？</summary>
      <div class="faq-body">群聊人设已包含「只以自己身份发言、不得代写他人台词」的约束；若仍越界，可在角色的「人设 Prompt」中重复强调这一约束，并在下次发言前用「编辑消息」清掉代写内容。</div>
    </details>
    <details class="faq reveal"><summary>公开 <code>public/</code> 目录写不进去？</summary>
      <div class="faq-body">普通会话对 <code>public/</code> 只读——<b>只有内置「酒馆老板」的 NPC 单聊可以写入公共区</b>。这是有意设计：老板是唯一官方管理员/素材区守门人。</div>
    </details>
    <details class="faq reveal"><summary>生成了文件，点开预览不对劲？</summary>
      <div class="faq-body">file_display 按扩展名推断渲染方式（.md 走 Markdown，html 走沙箱 iframe，其余文本原样展示）。内容不对就请老板 <code>file_edit</code> 修正或重写；想自己核对，用工作区 <i class="ic" data-ic="folder"></i> 或 <code>file_read</code> 直接看原文。</div>
    </details>
  `,
});
