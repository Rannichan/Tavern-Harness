// Tavern Harness · Wiki 章节 11「技能系统总览」
window.WIKI = window.WIKI || { chapters: [] };
window.WIKI.chapters.push({
  id: 'skills',
  group: '技能魔法',
  num: '拾',
  kicker: 'Skills',
  title: '技能系统总览',
  lead: '技能让角色从「会说话」进化到「能行动」。',
  html: `
    <h3>三层实现边界</h3>
    <div class="tbl-wrap"><table>
      <thead><tr><th>层</th><th>实现机制</th><th>典型代表</th></tr></thead>
      <tbody>
        <tr><td><b>内置原生工具</b><br><span class="mono">NATIVE</span></td><td>前端直接分派；数据库类操作走 IndexedDB，文件类经沙箱服务</td><td>roll_dice、create_skill、create_character、file_read …（共 19 项）</td></tr>
        <tr><td><b>内置但走沙箱管道</b><br><span class="mono">NATIVE</span></td><td>由沙箱服务 <code>127.0.0.1:17891</code> 真实执行</td><td>run_shell_script、file_read/write/edit/display</td></tr>
        <tr><td><b>生成式技能</b><br><span class="mono">STANDARD</span></td><td><code>create_skill</code> 产物，声明式 <code>executionJson</code></td><td>template / http_get / javascript / file_read / file_write / shell</td></tr>
      </tbody>
    </table></div>

    <h3>技能绑定</h3>
    <ul class="plain">
      <li>技能是<b>按角色启用</b>的：在角色编辑页「启用技能」里勾选；新创建的自定义技能默认未对任何角色生效。</li>
      <li>修改 / 删除技能需要确认弹窗；<code>update/delete_skill</code> 前会展示完整参数。</li>
      <li>生成式技能支持 <code>$read</code> / <code>$write</code> / <code>$append</code> / <code>$list</code> 桥接会话工作区，免重启即时生效。</li>
    </ul>

    <h3>Agent 执行限制</h3>
    <p class="dim">单回合 ReAct 循环受四类预算约束，达到即弹确认框（拒绝则停止本回合）：</p>
    <ul class="plain">
      <li>调用深度 ≤ 10；单回合计数 ≤ 20 次。</li>
      <li>相同参数连续调用 ≤ 3 次；连续失败 ≤ 3 次。</li>
      <li>结果前缀语义：<code>ERROR:</code> 失败、<code>CANCELLED:</code> 用户取消（不计失败、终止回合）、其余为成功。</li>
    </ul>
    <div class="moat"></div>
  `,
});
