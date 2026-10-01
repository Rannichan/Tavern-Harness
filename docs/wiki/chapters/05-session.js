// Tavern Harness · Wiki 章节 05「对话与会话模式」
window.WIKI = window.WIKI || { chapters: [] };
window.WIKI.chapters.push({
  id: 'session',
  group: '酒馆日常',
  num: '伍',
  kicker: 'Sessions',
  title: '对话与会话模式',
  lead: '三种模式：标准对话 / NPC 对话 / 群聊；体验主线是后两者。',
  html: `
    <div class="tbl-wrap"><table>
      <thead><tr><th>模式</th><th>谁在说话</th><th>适用场景</th></tr></thead>
      <tbody>
        <tr><td><b>标准对话 STANDARD</b></td><td>通用助手</td><td>日常问答；主要作为游戏导入的兜底模式</td></tr>
        <tr><td><b>NPC 对话</b></td><td>你 + 1 个角色卡</td><td>陪伴、跑团 GM、单主角剧情</td></tr>
        <tr><td><b>群聊 GROUP</b></td><td>你 + 2–5 个角色卡</td><td>剧本杀、多角色群像、圆桌讨论</td></tr>
      </tbody>
    </table></div>

    <h3>创建对话（「创建对话」弹窗）</h3>
    <p>从侧栏「<b>新建</b>」或仪表盘「<b>新建对话</b>」打开：</p>
    <ol class="steps">
      <li><b>参与角色</b>：至少选一位角色；<span class="mono">玩家（用户）默认队首</span>，可拖拽排序发言顺序。</li>
      <li><b>对话名称</b>：默认由角色名拼出，可自己改。</li>
      <li><b>随机顺序</b>：开启后每轮洗牌（RANDOM）；关闭则固定座位顺序（PRESET）。</li>
      <li><b>启用开场白</b>：单人对话启用 NPC 开场白；群聊仅当首位发言者是角色时启用其开场白。角色若有多个开场白，<span class="mono">随机选一条</span>。</li>
      <li><b>用户人设（可选）</b>：从「不在会话中的角色卡」中选择，你将以该身份入戏。</li>
      <li><b>世界书（可选）</b>：为这局对话绑定一份世界观。</li>
    </ol>

    <h3>会话管理</h3>
    <ul class="plain">
      <li>侧栏会话列表支持<b>搜索</b>（标题 + 消息内容）、<b>置顶</b>、活动指示点（正在生成或有新回复）。</li>
      <li>会话右键菜单：<b>编辑会话</b> / <b>置顶对话</b> / <b>导出游戏</b> / <b>删除会话</b>。</li>
      <li>会话头部：<b>编辑对话设置</b>、<b>重置对话</b>（清空消息按最新设置重新开始，二次确认）、<b>工作区 📁</b>（浏览会话专属目录，只读）、<b>导出游戏</b>、<b>删除对话</b>。</li>
      <li>删除会话会同时清理其专属工作目录 <span class="mono">sandbox_workspace/session-&lt;id&gt;/</span>。</li>
    </ul>
    <div class="moat"></div>
  `,
});
