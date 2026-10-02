// Tavern Harness · Wiki 章节 15「工作区与文件」
window.WIKI = window.WIKI || { chapters: [] };
window.WIKI.chapters.push({
  id: 'workspace',
  group: '高手进阶',
  num: '拾',
  kicker: 'Workspace',
  title: '工作区与文件',
  lead: '每个会话都有自己的小隔间。',
  html: `
    <h3>目录模型</h3>
    <div class="tbl-wrap"><table>
      <thead><tr><th>目录</th><th>谁能用</th><th>权限</th></tr></thead>
      <tbody>
        <tr><td><span class="mono">sandbox_workspace/session-&lt;id&gt;/</span></td><td>对应会话</td><td>读写（400KB/条），专属游戏存档/CSS/脚本</td></tr>
        <tr><td><span class="mono">sandbox_workspace/public/</span></td><td>所有会话</td><td>普通会话<b>只读</b>；仅内置「酒馆老板」的 NPC 单聊可写——官方共享素材区</td></tr>
      </tbody>
    </table></div>

    <h3>工作区文件 <i class="ic" data-ic="folder"></i></h3>
    <ul class="plain">
      <li>会话头部的 <i class="ic" data-ic="folder"></i> 按钮打开「<b>工作区文件</b>」管理器：<b>只读浏览</b>（不支持上传/下载/重命名/删除）。</li>
      <li>支持目录进入、面包屑与 <code>..</code> 返回上级；点击文件复用 file_display 弹窗预览。</li>
    </ul>

    <h3>file_display 预览弹窗</h3>
    <ul class="plain">
      <li><b>文本</b>：<code>.md</code> 走 Markdown 渲染（含代码高亮）；代码扩展名等宽语法高亮。</li>
      <li><b>图片</b>：滚轮/按钮缩放、拖拽平移、双击重置。</li>
      <li><b>HTML</b>：sandbox iframe 隔离渲染（脚本可运行但与外部隔离）、可缩放。消息中的展示锚点可随时「查看」回看。</li>
      <li><b>画中画（PIP）</b>：悬浮小窗、可拖动/缩放，1s 轮询自动刷新内容——非常适合「放仪表盘边玩边看」。</li>
    </ul>
    <div class="moat"></div>
  `,
});
