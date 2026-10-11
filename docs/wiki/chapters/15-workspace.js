// Tavern Harness · Wiki 章节 15「工作区与文件」
window.WIKI = window.WIKI || { chapters: [] };
window.WIKI.chapters.push({
  id: 'workspace',
  group: '酒馆日常',
  kicker: 'Workspace',
  title: '工作区与文件',
  lead: '每个会话都有自己的小隔间。',
  html: `
    <h3>会话工作区</h3>
    <div class="tbl-wrap"><table>
      <thead><tr><th>目录</th><th>谁能用</th><th>权限</th></tr></thead>
      <tbody>
        <tr><td><span class="mono">&lt;workspace&gt;/session-&lt;id&gt;/</span></td><td>对应会话</td><td>具备完整的读写取权限，一般用作专属游戏存档/脚本/看板的管理</td></tr>
        <tr><td><span class="mono">&lt;workspace&gt;/public/</span></td><td>所有会话</td><td>普通会话<b>只读</b>；「酒馆老板」单聊可完整读写，为共享素材区</td></tr>
      </tbody>
    </table></div>

    <h3>工作区位置</h3>
    <p><code>&lt;workspace&gt;</code> 在系统中的实际位置如下：</p>
    <ul class="plain">
      <li>macOS：<code>~/Library/Application Support/Tavern Harness/sandbox_workspace</code></li>
      <li>Windows：<code>%APPDATA%\\Tavern Harness\\sandbox_workspace</code></li>
      <li>Linux：<code>$XDG_DATA_HOME/tavern-harness/sandbox_workspace</code>；未设置时为 <code>~/.local/share/tavern-harness/sandbox_workspace</code></li>
    </ul>
    <p>用户可以通过以下方式修改工作区位置：</p>
    <ul class="plain">
      <li>通过环境变量指定：<code>TAVERN_HARNESS_WORKSPACE="/absolute/path" tavern-harness</code>。</li>
      <li>通过命令行参数指定：<code>tavern-harness --workspace /absolute/path</code>。</li>
    </ul>

    <h3>文件管理器 <i class="ic" data-ic="folder"></i></h3>
    <ul class="plain">
      <li>会话头部的 <i class="ic" data-ic="folder"></i> 按钮打开「<b>工作区文件</b>」管理器：<b>只读浏览</b>（不支持上传/下载/重命名/删除）。</li>
      <li>点击文件可以直接弹窗预览，弹窗支持画中画模式，自动刷新内容——非常适合「放仪表盘边玩边看」。</li>
    </ul>
    <div class="moat"></div>
  `,
});
