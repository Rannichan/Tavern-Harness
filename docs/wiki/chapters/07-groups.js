// Tavern Harness · Wiki 章节 07「群聊与回合制」
window.WIKI = window.WIKI || { chapters: [] };
window.WIKI.chapters.push({
  id: 'groups',
  group: '酒馆日常',
  num: '柒',
  kicker: 'Group Chat',
  title: '群聊与回合制',
  lead: '2–5 位 NPC + 玩家同台游戏。',
  html: `
    <h3>发言顺序</h3>
    <ul class="plain">
      <li><b>固定座位顺序</b>：按创建时拖拽的顺序依次发言。</li>
      <li><b>随机顺序</b>：每轮自动洗牌。</li>
      <li>队列耗尽自动进入下一轮（<code>第 {n} 轮 / 共 {n} 轮</code>），右侧发言队列面板会显示当前的发言顺序，并实时高亮正在发言者。</li>
    </ul>

    <h3>发言队列面板</h3>
    <p>多人群聊页面右侧为发言队列面板，进入会话会自动定位到最新消息；新消息到达时自动平滑跟随，并实时高亮正在发言者。右侧「<b>发言队列</b>」面板与对话区<b>双向联动</b>：点击队列项定位到对应发言，滚动对话区也会定位到对应发言人。</p>

    <h3>点名与跳过</h3>
    <ul class="plain">
      <li><code>@角色名</code>：玩家或角色在消息中点名，被点名者<b>插队优先发言</b>；输入时自动补全。</li>
      <li><code>/pass</code>：玩家跳过本轮发言，并移出当轮队列。</li>
      <li><code>/new</code>：清空上下文，并插入「开始新话题」标记。</li>
      <li>玩家之外的角色也可以用 <code>@角色名</code> 指定下一个发言者，可以利用此机制实现更复杂的玩法。</li>
    </ul>
  `,
});
