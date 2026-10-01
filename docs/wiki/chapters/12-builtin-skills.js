// Tavern Harness · Wiki 章节 12「内置技能一览」
window.WIKI = window.WIKI || { chapters: [] };
window.WIKI.chapters.push({
  id: 'builtin-skills',
  group: '技能魔法',
  num: '拾贰',
  kicker: 'Builtins',
  title: '内置技能一览',
  lead: '全部 19 项内置技能，酒馆老板默认全开。',
  html: `
    <h3>掷骰与展示</h3>
    <div class="tbl-wrap"><table>
      <thead><tr><th>技能</th><th>用途</th><th>备注</th></tr></thead>
      <tbody>
        <tr><td><span class="mono">roll_dice</span></td><td>掷任意表达式骰子（<code>d20</code> / <code>2d6</code> / <code>3d10+2</code>）</td><td>单 d20 出 20/1 时报告「大成功！/ 大失败！」</td></tr>
        <tr><td><span class="mono">file_display</span></td><td>弹窗向<b>用户</b>展示工作区文件（文本 / 图片 / HTML 沙箱预览）</td><td>内容不回传给模型；如模型需要阅读，应改用 <code>file_read</code></td></tr>
      </tbody>
    </table></div>

    <h3>文件与命令</h3>
    <div class="tbl-wrap"><table>
      <thead><tr><th>技能</th><th>用途</th><th>边界</th></tr></thead>
      <tbody>
        <tr><td><span class="mono">file_read</span></td><td>读会话工作区文本文件</td><td>上限 100KB；拒绝绝对路径与 <code>..</code>；普通会话可读 <code>public/</code></td></tr>
        <tr><td><span class="mono">file_write</span></td><td>创建/覆写/追加文件</td><td>上限 400KB；<span class="mono">public</span> 对普通会话只读</td></tr>
        <tr><td><span class="mono">file_edit</span></td><td>精确文本替换（old_text / new_text）</td><td>匹配数与 expected_replacements 不符则拒绝修改</td></tr>
        <tr><td><span class="mono">run_shell_script</span></td><td>受控本地命令执行（≤20 条命令，支持换行 / <code>&amp;&amp;</code> / <code>||</code> / <code>;</code>）</td><td>白名单直执（ls/cat/grep/jq/bc 等 40+ 命令），名单外弹确认；无 shell 解释器（不支持管道/重定向/<code>$()</code>)；单条 5s 超时</td></tr>
      </tbody>
    </table></div>

    <h3>酒馆管理（数据库 / 元数据）</h3>
    <div class="tbl-wrap"><table>
      <thead><tr><th>技能</th><th>用途</th><th>确认</th></tr></thead>
      <tbody>
        <tr><td><span class="mono">create_skill</span> / <span class="mono">update_skill</span> / <span class="mono">delete_skill</span></td><td>技能 CRUD：创建后默认未启用；内置技能不可改删</td><td>update / delete 需确认</td></tr>
        <tr><td><span class="mono">create_character</span> / <span class="mono">update_character</span> / <span class="mono">delete_character</span></td><td>角色 CRUD；<code>update_character</code> 可用 <code>enable_skills</code>/<code>disable_skills</code> 控制技能勾选</td><td>update / delete 需确认；内置角色受保护</td></tr>
        <tr><td><span class="mono">create_lorebook</span> / <span class="mono">update_lorebook</span> / <span class="mono">delete_lorebook</span></td><td>世界书 CRUD（名 ≤60 字，内容 ≤10000 字）；删除时自动从所有会话解绑</td><td>update / delete 需确认</td></tr>
        <tr><td><span class="mono">create_conversation</span></td><td>由模型创建新对话（参与者 ≤5 + 世界书 + 发言顺序 + 用户人设 + 开场白开关）</td><td>—</td></tr>
        <tr><td><span class="mono">get_tavern_info</span> / <span class="mono">get_character_info</span> / <span class="mono">get_lorebook_info</span></td><td>只读快照：全局角色 / 世界书 / 技能 / 生涯统计，或按名称读详情</td><td>—</td></tr>
      </tbody>
    </table></div>

    <div class="co co-warn reveal"><span class="co-ic">⚙️</span><div class="co-body"><b>退役说明</b>：早期的 <code>web_search</code> 与 <code>manage_timer</code> 已退役（需要联网/定时的玩法，请让酒馆老板用 <code>create_skill</code> 现场造一个 <code>http_get</code> 或 <code>javascript</code> 技能替代）。旧库残留记录会被自动清理。</div></div>
    <div class="moat"></div>
  `,
});
