// Tavern Harness · Wiki 章节 17「成就与生涯统计」
window.WIKI = window.WIKI || { chapters: [] };
window.WIKI.chapters.push({
  id: 'achievements',
  group: '高手进阶',
  num: '拾伍',
  kicker: 'Career',
  title: '成就与生涯统计',
  lead: '<span class="chip chip-main"><i class="ic" data-ic="trophy"></i> 成就</span> → 奖杯陈列柜与生涯数据。',
  html: `
    <h3>🎖️ 奖杯陈列柜</h3>
    <div class="tbl-wrap"><table>
      <thead><tr><th>成就</th><th>图标</th><th>解锁条件</th></tr></thead>
      <tbody>
        <tr><td>旅人</td><td>🧭</td><td>累计消耗 1,000 Token</td></tr>
        <tr><td>老友</td><td>🤝</td><td>累计 10,000 Token</td></tr>
        <tr><td>吟游诗人</td><td>🎻</td><td>累计 100,000 Token</td></tr>
        <tr><td>午夜不归人</td><td>🌙</td><td>累计 1,000,000 Token</td></tr>
        <tr><td>酒馆传奇</td><td>🏆</td><td>累计 100,000,000 Token</td></tr>
      </tbody>
    </table></div>
    <p class="dim">解锁瞬间弹出「🎉 成就解锁！」弹窗（带撒花），多枚解锁按阈值从高到低排队展示。</p>

    <h3>生涯统计</h3>
    <ul class="plain">
      <li><b>总 Tokens（输入 + 输出）</b> / 输入 / 输出 tokens；<b>对话轮数</b>（一个 assistant 回合 = 一轮，ReAct 多层只计一次）；<b>累计会话</b> 与 <b>平均轮数 / 会话</b>。</li>
      <li><b>🏆 最活跃角色</b> 与 <b>🎭 角色轮数排行</b>：按角色累计发言轮数。</li>
      <li>「重置统计」只清数据<b>不清已解锁奖杯</b>。</li>
    </ul>
    <div class="moat"></div>
  `,
});
