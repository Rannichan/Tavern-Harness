// Tavern Harness · Wiki 章节 08「角色工坊与世界观」
window.WIKI = window.WIKI || { chapters: [] };
window.WIKI.chapters.push({
  id: 'workshop',
  group: '世界搭建',
  kicker: 'Workshop',
  title: '角色工坊与世界书',
  lead: '从左上角 <span class="chip chip-main"><i class="ic" data-ic="users"></i> 角色工坊</span> 进入 → 三个标签页：<span class="chip">👤 角色卡</span> <span class="chip">📖 世界书</span> <span class="chip">🛠 技能表</span>',
  html: `
    <h3>👤 角色卡</h3>
    <ul class="plain">
      <li><b>可编辑字段</b>：头像、角色名称、人设 Prompt、开场白 Greeting、启用技能。</li>
      <li><b>多开场白</b>：「添加开场白」可建备用版本，<span class="mono">每次新对话随机选择一条</span>。</li>
      <li><b>角色知识库（Character Book）</b>：角色编辑页的「知识库」标签支持 SillyTavern 风格的 Character Book JSON 结构与字段，用于为角色配置按关键词检索的背景知识。</li>
      <li><b>PNG 自动导入</b>：导入 SillyTavern PNG 角色卡时，如其中包含 Character Book，会自动导入并随该角色启用。</li>
      <li><b>内置角色</b>「酒馆老板」默认置顶、启用全部内置技能；名称不可编辑且受保护不可删除。编辑页可「恢复默认」人设、开场白和装备技能。</li>
      <li>技能默认对新角色<b>未启用</b>——去编辑角色的「启用技能」里勾选生效。</li>
    </ul>

    <h3>📖 世界书</h3>
    <ul class="plain">
      <li>内置世界书「酒馆经营手册（精华版）」默认置顶：<b>名称不可编辑或删除</b>，内容可编辑，并可随时「恢复默认」。开发者可在 <code>src/assets/tavern-handbook.md</code> 直接维护默认文案。</li>
      <li>其他世界书可编辑字段：<code>世界书名</code> + <code>世界书内容</code>；全部支持 Markdown 渲染预览。</li>
      <li>内容会在系统提示词中以 <code>=== 世界书 ===</code> 分节附加在人设后，可<b>按会话绑定</b>。</li>
      <li>SillyTavern PNG 角色卡内嵌世界书导入时会自动解析为条目文本。</li>
    </ul>

    <h3>🛠 技能表</h3>
    <ul class="plain">
      <li>分组：自定义技能 / 导入技能 / 内置技能（不可修改）；支持<b>拖拽排序</b>。</li>
      <li>卡片显示名称 / 描述 / 实现类型；「详情」弹窗展示描述、参数 Schema、声明式实现与原始 OpenAI Tool JSON。</li>
      <li><b>内置技能受保护</b>：不可删除，使用 <code>update_skill</code> 修改亦被拒。</li>
    </ul>
    <div class="tbl-wrap"><table>
      <thead><tr><th>分类</th><th>技能</th><th>用途</th></tr></thead>
      <tbody>
        <tr><td rowspan="1">游戏工具</td><td><span class="mono">roll_dice</span></td><td>掷骰子，支持多种玩法（跑团、概率判定等）</td></tr>
        <tr><td rowspan="4">文件操作</td><td><span class="mono">file_read</span></td><td>读取会话工作区中的文件</td></tr>
        <tr><td><span class="mono">file_write</span></td><td>创建新文件，或在文件末尾追加内容</td></tr>
        <tr><td><span class="mono">file_edit</span></td><td>对现有文件进行编辑</td></tr>
        <tr><td><span class="mono">file_display</span></td><td>以弹窗方式向你展示一个文件（文本 / 图片 / 网页预览）</td></tr>
        <tr><td rowspan="2">沙箱拓展</td><td><span class="mono">run_shell_script</span></td><td>在沙箱服务中执行受控的 shell 脚本</td></tr>
        <tr><td><span class="mono">create_skill</span></td><td>现场创造一个新技能，临场解锁新能力</td></tr>
        <tr><td rowspan="12">酒馆管理</td><td><span class="mono">update_skill</span></td><td>修改已有技能的定义</td></tr>
        <tr><td><span class="mono">delete_skill</span></td><td>删除一个技能</td></tr>
        <tr><td><span class="mono">create_character</span></td><td>创建新角色</td></tr>
        <tr><td><span class="mono">update_character</span></td><td>修改角色卡（含启用 / 停用技能）</td></tr>
        <tr><td><span class="mono">delete_character</span></td><td>删除角色</td></tr>
        <tr><td><span class="mono">create_lorebook</span></td><td>创建新的世界书</td></tr>
        <tr><td><span class="mono">update_lorebook</span></td><td>修改世界书</td></tr>
        <tr><td><span class="mono">delete_lorebook</span></td><td>删除世界书</td></tr>
        <tr><td><span class="mono">create_conversation</span></td><td>创建一个新的对话</td></tr>
        <tr><td><span class="mono">get_tavern_info</span></td><td>查询酒馆概览（角色、世界书、技能与统计）</td></tr>
        <tr><td><span class="mono">get_character_info</span></td><td>查询某个角色的详细信息</td></tr>
        <tr><td><span class="mono">get_lorebook_info</span></td><td>查询某本世界书的详细信息</td></tr>
      </tbody>
    </table></div>

    <h3>⭐️ 构建自定义技能</h3>
    <p>对话里直接说需求即可，例如：「帮我生成一个技能，输入城市名返回天气」。老板会调用 <code>create_skill</code> ，基于以下子能力，构建一个自定义技能。</p>

    <div class="tbl-wrap"><table>
      <thead><tr><th>执行类型</th><th>子能力</th></tr></thead>
      <tbody>
        <tr><td><span class="mono">template</span></td><td>输出固定模板的文本</td></tr>
        <tr><td><span class="mono">http_get</span></td><td>进行安全的网络请求</td></tr>
        <tr><td><span class="mono">shell</span></td><td>shell脚本执行能力</td></tr>
        <tr><td><span class="mono">javascript</span></td><td>JS 代码执行，以及受控的文件读写、列举与弹窗展示能力</td></tr>
      </tbody>
    </table></div>

    <p>构建完成后：</p>
    <ol class="steps">
      <li>到「角色工坊 → 🛠 技能表」查看与确认新技能。</li>
      <li>到角色编辑页「<b>启用技能</b>」为需要的角色勾选（新技能默认未启用）。</li>
      <li>在对话里直接使用或让模型调用。</li>
    </ol>

    <h3>⭐️ 占位符支持</h3>
    <p>角色卡的人设 Prompt、开场白，以及世界书的名称、条目标题、触发词和正文均支持占位符。替换仅用于前端显示；已保存的角色卡、世界书与聊天消息，以及发送给模型的原始内容均不会被改写。</p>
    <div class="tbl-wrap"><table>
      <thead><tr><th style="width: 10%; white-space: nowrap;">占位符</th><th>含义</th><th>替换时机和行为</th></tr></thead>
      <tbody>
        <tr><td style="white-space: nowrap;"><code>{{user}}</code></td><td>当前对话配置的用户人设（Persona）名称。</td><td>仅在对话配置 Persona 时，由前端展示消息时替换为 Persona 名称；未配置 Persona 时保留原样。兼容 <code>{{ user }}</code> 与大小写变体。</td></tr>
      </tbody>
    </table></div>

    <div class="co co-ok reveal"><span class="co-ic">🧩</span><div class="co-body">角色卡定义了角色的人设，世界书定义了世界观和游戏的玩法，技能则是赋予角色在世界观下进行游戏的能力。</div></div>
    <div class="moat"></div>
  `,
});
