// Tavern Harness · Wiki 章节 14「确认门控与安全边界」
window.WIKI = window.WIKI || { chapters: [] };
window.WIKI.chapters.push({
  id: 'confirm-gates',
  group: '技能魔法',
  num: '拾肆',
  kicker: 'Safety Gates',
  title: '确认门控与安全边界',
  lead: '能力越大，把关越细——哪些操作会停下来问你。',
  html: `
    <h3>两类确认触发点</h3>
    <div class="tbl-wrap"><table>
      <thead><tr><th>触发点</th><th>覆盖工具</th><th>时机</th></tr></thead>
      <tbody>
        <tr><td><b>修改 / 删除组</b></td><td><code>update_* / delete_*</code>（技能、角色、世界书）</td><td>执行前弹窗，展示完整参数；取消则不执行</td></tr>
        <tr><td><b>shell 组</b></td><td><code>run_shell_script</code> / 生成式 <code>shell</code></td><td>执行中按需：仅「非白名单命令」弹确认（展示整个脚本）。路径越界直接拒绝、不弹窗</td></tr>
      </tbody>
    </table></div>
    <p class="dim">其余工具（掷骰、查询系、文件读写、展示）<b>不弹确认</b>，只受各沙箱自身规则约束。取消一律表现为 <code>CANCELLED:</code> 前缀——不计失败、不弹错误 toast，语义是「用户主动停止」。</p>

    <h3>沙箱边界速记</h3>
    <ul class="plain">
      <li><b>JavaScript 沙箱</b>：浏览器线程隔离，无 DOM / Node API，双档限额（20KB 代码 / 5s 时长）。</li>
      <li><b>文件沙箱</b>：所有文件操作一律解析到<b>会话工作目录</b>内；<code>..</code> 与绝对路径双层拒绝；软链逃逸专项检测；公共目录 <code>public</code> 普通会话只读。</li>
      <li><b>命令沙箱</b>：仅 <code>127.0.0.1</code> + 双 token 鉴权；<code>spawn(shell:false)</code> 无解释器；长度/超限双层拒绝；请求体上限（512KB/64KB/16KB）超限返回 413。</li>
    </ul>

    <div class="co co-warn reveal"><span class="co-ic">⚠️</span><div class="co-body"><b>这不是 OS 沙箱。</b>命令以启动服务的当前用户权限执行；安全来自白名单 + 你的确认，与启动命令前弹出的许可弹窗。请像对待你手边的终端一样对待它。</div></div>
    <div class="moat"></div>
  `,
});
