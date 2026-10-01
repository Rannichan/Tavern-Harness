// Tavern Harness · Wiki 章节 07「群聊与回合制」
window.WIKI = window.WIKI || { chapters: [] };
window.WIKI.chapters.push({
  id: 'groups',
  group: '酒馆日常',
  num: '柒',
  kicker: 'Group Chat',
  title: '群聊与回合制',
  lead: '2–5 位 NPC + 玩家同台，像跑团一样管理发言。',
  html: `
    <h3>发言顺序</h3>
    <ul class="plain">
      <li><b>固定座位顺序（PRESET）</b>：按创建时拖拽的顺序依次发言。</li>
      <li><b>随机顺序（RANDOM）</b>：每轮自动洗牌，队列上标注「随机顺序（每轮洗牌）」。</li>
      <li>队列耗尽自动进入下一轮（「第 {n} 轮 / 共 {n} 轮」），实时高亮正在发言者。</li>
    </ul>

    <h3>点名与跳过</h3>
    <ul class="plain">
      <li><code>@角色名</code>：玩家或角色在消息中点名，被点名者<b>插队优先发言</b>；输入时自动补全。</li>
      <li><code>/pass</code>：玩家跳过本轮发言，移出当轮队列（不修改对话历史）。</li>
      <li><code>/new</code>：插入「开始新话题」标记，此后上下文从标记处截断（NPC 单聊保留开场白）。</li>
      <li>模型也可以用 <code>@角色名</code> 指定下一个发言者（群聊人设中已告知）。</li>
    </ul>

    <h3>群聊 Prompt 组装</h3>
    <p class="dim">系统提示词会包含：多角色对话框架（只以自己身份发言、不得代写他人台词）、其他成员列表、玩家可随时发言、消息前缀 <code>[角色名]</code> 说明、@点名规则，以及当前轮发言顺序 <code>A → B → …</code>；随后按发言者注入「<code>=== {当前发言人} ===</code>+ 人设 + 世界书 + 用户人设」。其他成员的消息在发送时折叠为带前缀的 user 消息。这套组装规则固定，暂不提供全局模板编辑。</p>

    <div class="co co-note reveal"><span class="co-ic">🎭</span><div class="co-body">从上帝视角观测角色们自由对话，或亲自代入角色参与——<b>两种玩法都由回合制队列支撑</b>：你想加入时 @ 名字或直接发言，想旁观时用 <code>/pass</code> 静观。</div></div>
    <div class="moat"></div>
  `,
});
