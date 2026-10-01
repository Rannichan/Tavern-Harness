// Tavern Harness · Wiki 章节 13「现场造技能 create_skill」
window.WIKI = window.WIKI || { chapters: [] };
window.WIKI.chapters.push({
  id: 'create-skill',
  group: '技能魔法',
  num: '拾贰',
  kicker: 'create_skill',
  title: '现场造技能 create_skill',
  lead: '告诉老板你想要什么，他会写出一个新技能挂上技能架。',
  html: `
    <p>对话里直接说需求即可，例如：「帮我生成一个技能，输入城市名返回天气」。老板会调用 <code>create_skill</code> 产出一份声明式 <code>executionJson</code>（描述 + 参数 Schema + 实现）。之后：</p>
    <ol class="steps">
      <li>到「角色工坊 → 🛠 技能表」查看与确认新技能。</li>
      <li>到角色编辑页「<b>启用技能</b>」为需要的角色勾选（新技能默认未启用）。</li>
      <li>在对话里直接使用或让模型调用。</li>
    </ol>

    <h3>六类执行类型怎么选</h3>
    <div class="tbl-wrap"><table>
      <thead><tr><th>执行类型</th><th>适用</th><th>边界/限制</th></tr></thead>
      <tbody>
        <tr><td><span class="mono">template</span> <b>零门槛</b></td><td>可重复使用的文本模板</td><td><code>{{param}}</code> 占位符插值，纯前端执行，无副作用</td></tr>
        <tr><td><span class="mono">http_get</span></td><td>拉取公开 API 数据</td><td>仅公网 HTTPS + 占位符；屏蔽内网/localhost；10s 超时</td></tr>
        <tr><td><span class="mono">javascript</span> <b>最强</b></td><td>任意计算逻辑、持久化小游戏</td><td>Web Worker 沙箱：20KB 代码、5s 总时长（含桥接等待）、结果需可 JSON 序列化；仅浏览器环境（无 DOM、无 Node API）</td></tr>
        <tr><td><span class="mono">file_read</span></td><td>挂载知识/存档</td><td>会话工作区内，100KB 上限</td></tr>
        <tr><td><span class="mono">file_write</span></td><td>生成文件/HTML 仪表盘</td><td>400KB 上限、public 只读；<code>json_content</code> 递归插值</td></tr>
        <tr><td><span class="mono">shell</span></td><td>真实本地命令、整理文件</td><td>白名单直执 + 名单外确认；受沙箱目录边界约束</td></tr>
      </tbody>
    </table></div>

    <h3>javascript 技能的文件桥接</h3>
    <p>Worker 内提供的 <code>await $read(path)</code> / <code>$write(path, text)</code> / <code>$append(path, text)</code> / <code>$list()</code> 是仅有的文件入口，共用文件沙箱同一套规则（限会话工作区、public 软链只读）：这是实现「<b>好感度存档</b>」「<b>每日一句</b>」类持久玩法的核心。</p>
    <pre><code>// 示例：好感度 +1 并存档（javascript 技能）
const state = JSON.parse(await $read('state.json') || '{}');
state.affinity = (state.affinity ?? 0) + (input.delta ?? 1);
await $write('state.json', JSON.stringify(state, null, 2));
result = { affinity: state.affinity, mood: state.affinity &gt;= 60 ? 'happy' : 'neutral' };</code></pre>

    <div class="co co-note reveal"><span class="co-ic">🧪</span><div class="co-body">造完就测：先让老板 <code>$list()</code> 或 <code>ls</code> 看看工作区，再让它执行一次新技能拿输出验证；不满意就让 <code>update_skill</code> 迭代（会弹确认）。</div></div>
    <div class="moat"></div>
  `,
});
