// Tavern Harness · Wiki 章节 03「接入模型 Provider」
window.WIKI = window.WIKI || { chapters: [] };
window.WIKI.chapters.push({
  id: 'provider',
  group: '开张准备',
  num: '叁',
  kicker: 'Providers & Parameters',
  title: '接入模型 Provider',
  lead: '从左上角 <span class="chip chip-main"><i class="ic" data-ic="settings"></i> 设置</span> 进入 → 多端点可并存；测试连通、拉模型、生成参数，都在设置页。',
  html: `
    <h3>Provider 管理</h3>
    <ul class="plain">
      <li><b>启用/停用</b>：每张 Provider 卡片带开关；<span class="mono">唯一启用的 Provider 自动成为默认端点</span>。</li>
      <li><b>测试连接</b>：成功提示 <code>✅ 连通正常，拉取到 {n} 个模型</code>；失败会给出 CORS 排查提示。</li>
      <li><b>编辑 / 删除</b>：删除前弹通用确认框。</li>
    </ul>

    <h3>生成参数</h3>
    <div class="tbl-wrap"><table>
      <thead><tr><th>参数</th><th>范围</th><th>作用</th></tr></thead>
      <tbody>
        <tr><td>Temperature</td><td>0 – 2</td><td>创造性与随机性</td></tr>
        <tr><td>Top P</td><td>0 – 1</td><td>核采样</td></tr>
        <tr><td>Top K</td><td>0 – 100</td><td>候选数量</td></tr>
        <tr><td>Max Tokens</td><td>0 – 16384</td><td>0 = 不限制</td></tr>
        <tr><td>Frequency Penalty</td><td>-2 – 2</td><td>重复惩罚</td></tr>
        <tr><td>Presence Penalty</td><td>-2 – 2</td><td>话题新颖度</td></tr>
        <tr><td>Repetition Penalty</td><td>0.5 – 2</td><td>重复惩罚</td></tr>
        <tr><td>Reasoning Effort</td><td>auto / off / low / medium / xhigh</td><td>思考强度</td></tr>
      </tbody>
    </table></div>
    <div class="co co-note reveal"><span class="co-ic">💭</span><div class="co-body">不单独提供思考模式开关，如需关闭思考模式，请将 <b>Reasoning Effort</b> 设置为 <code>off</code>。适配 deepseek / qwen 等模型时，应用会自动选择 <code>enable_thinking</code> 或 Qwen 专用的 <code>chat_template_kwargs</code> 参数。</div></div>
    <div class="moat"></div>
  `,
});
