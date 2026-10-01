// Tavern Harness · Wiki 章节 16「玩法配方（7 例）」
window.WIKI = window.WIKI || { chapters: [] };
window.WIKI.chapters.push({
  id: 'recipes',
  group: '高手进阶',
  num: '拾肆',
  kicker: 'Recipes',
  title: '玩法配方（7 例）',
  lead: '由浅入深：前三例零配置开箱即玩，后四例逐步解锁沙盒能力。',
  html: `
    <div class="recipe reveal"><span class="r-num">一</span>
      <span class="r-level">零门槛</span>
      <h3>深夜陪伴</h3>
      <ol class="steps">
        <li>「<i class="ic" data-ic="plus"></i> 新建」开一局单聊，角色选「酒馆老板」（或任意自定义角色）。</li>
        <li>直接开聊，像跟朋友一样。想听他内心盘算，用「Reasoning Effort」调思考强度，聊天区展开「🧠 思考」折叠块。</li>
        <li>长按 / 右键任意消息：编辑历史、重新生成、Fork 分支、查看原始日志。</li>
      </ol>
      <div class="r-feat"><b>要点</b>：多开场白可随机开场；换浏览器看不到数据？导出 JSON 即可带走。</div>
    </div>

    <div class="recipe reveal"><span class="r-num">二</span>
      <span class="r-level">零门槛</span>
      <h3>跑团掷骰</h3>
      <ol class="steps">
        <li>「<i class="ic" data-ic="plus"></i> 新建」开一局单聊，GM 人设写：「你是主持本团的 GM，用 roll_dice 决定命运」。</li>
        <li>开场白抛剧情钩子；老板自动调用 <code>roll_dice</code>，结果消息里呈现「大成功！/ 大失败！」。</li>
        <li>把团规、世界观写进<b>世界书</b>并绑定到该会话，人设即刻变成完整世界。</li>
      </ol>
      <div class="r-feat"><b>要点</b>：单 d20 大成功/大失败自动识别；骰子结果回灌上下文，后续剧情可引用。</div>
    </div>

    <div class="recipe reveal"><span class="r-num">三</span>
      <span class="r-level">零门槛</span>
      <h3>群聊剧本（最多 5 人一台戏）</h3>
      <ol class="steps">
        <li>「角色工坊」里建多个 NPC（如侦探、管家、女主）。</li>
        <li>「<i class="ic" data-ic="plus"></i> 新建」开一局群聊：添加 2–5 位角色，拖拽座位顺序或开启随机洗牌。</li>
        <li>用 <code>@角色名</code> 点名下一个发言者；<code>/new</code> 开新话题；<code>/pass</code> 跳过自己。</li>
      </ol>
      <div class="r-feat"><b>要点</b>：发言队列实时高亮、双向联动定位；NPC 也能互相点名，形成接力。</div>
    </div>

    <div class="recipe reveal"><span class="r-num">四</span>
      <span class="r-level">技能解锁</span>
      <h3>现场造技能（自造能力）</h3>
      <ol class="steps">
        <li>对老板说：「帮我生成一个技能，输入城市名返回天气」→ 他调用 <code>create_skill</code> 写出新技能。</li>
        <li>新技能默认未启用——去「角色工坊 → 技能表」为其角色勾选「启用技能」。</li>
        <li>技能免重启即时生效；<code>template</code> 模板、<code>http_get</code> 取数、<code>javascript</code> 计算都在可选之列。</li>
      </ol>
      <div class="r-feat"><b>要点</b>：详细字段说明见「现场造技能」章；不想要时 <code>delete_skill</code> 删除（需确认）。</div>
    </div>

    <div class="recipe reveal"><span class="r-num">五</span>
      <span class="r-level">沙盒进阶</span>
      <h3>持久化小游戏（好感度系统）</h3>
      <ol class="steps">
        <li>让老板写一个 <code>javascript</code> 技能维护好感度：每轮数值经 <code>$write</code> 存进 <code>state.json</code>。</li>
        <li>写一个 <code>$read</code> 的技能；再用 <code>file_write</code> 生成 HTML 仪表盘 <code>dashboard.html</code>。</li>
        <li><code>file_display</code> 直接弹窗展示数值变化——HTML 沙箱渲染、可缩放，还能开<b>画中画</b>边玩边看。</li>
      </ol>
      <div class="r-feat"><b>要点</b>：删除会话时 <code>session-&lt;id&gt;</code> 目录自动清理；「酒馆老板」单聊建议把仪表盘存到 <code>public/</code>（全酒馆可见）。</div>
    </div>

    <div class="recipe reveal"><span class="r-num">六</span>
      <span class="r-level">沙盒进阶</span>
      <h3>整理文件（shell）</h3>
      <ol class="steps">
        <li>对话里让老板 <code>ls</code> 看工作区、<code>cat</code> 读文件、<code>cp</code> 归档文稿。</li>
        <li>白名单命令直接执行；非白名单命令（如 <code>node</code>、<code>git</code>）以及越界读写会<b>先弹窗确认</b>再执行；<code>mv</code>/<code>rm</code> 之类的修改一旦提交无法撤销，务必看清楚弹窗内容。</li>
        <li><b>普通会话对公共目录 <code>public/</code> 只读</b>——老板是唯一可以在公共区落笔的会话。</li>
      </ol>
      <div class="r-feat"><b>要点</b>：单条命令 5s 超时；不支持管道/重定向，需要更复杂逻辑请写 <code>javascript</code> 技能。</div>
    </div>

    <div class="recipe reveal"><span class="r-num">七</span>
      <span class="r-level">生态</span>
      <h3>携带整个世界（导入导出 / Fork）</h3>
      <ol class="steps">
        <li>一局玩到中期，「<b>导出游戏</b>」勾选「包含对话历史」，得到自包含 JSON。</li>
        <li>发给朋友，对方「<i class="ic" data-ic="import"></i> 导入」一键还原角色与世界（冲突自动建副本）；分配全新工作目录后可直接续玩。</li>
        <li>或自己「创建分支 / Fork」：同一段历史分岔出多个平行结局。</li>
      </ol>
      <div class="r-feat"><b>要点</b>：Fork 与导入都<b>不会覆盖</b>现有数据；游戏 JSON 会剔除调试字段，只留正文。</div>
    </div>
    <div class="moat"></div>
  `,
});
