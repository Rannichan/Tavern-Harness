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
      <li><b>内置角色</b>「酒馆老板」默认启用全部内置技能、<span class="mono">受保护不可删除</span>。</li>
      <li>技能默认对新角色<b>未启用</b>——去编辑角色的「启用技能」里勾选生效。</li>
    </ul>

    <h3>📖 世界书</h3>
    <ul class="plain">
      <li>可编辑字段：<code>世界书名</code> + <code>世界书内容</code>，支持 Markdown 渲染预览。</li>
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
        <tr><td><span class="mono">file_read</span></td><td>读文件</td></tr>
        <tr><td><span class="mono">file_write</span></td><td>写文件</td></tr>
        <tr><td><span class="mono">shell</span></td><td>shell脚本执行能力</td></tr>
        <tr><td><span class="mono">javascript</span></td><td>js代码执行能力</td></tr>
      </tbody>
    </table></div>

    <p>构建完成后：</p>
    <ol class="steps">
      <li>到「角色工坊 → 🛠 技能表」查看与确认新技能。</li>
      <li>到角色编辑页「<b>启用技能</b>」为需要的角色勾选（新技能默认未启用）。</li>
      <li>在对话里直接使用或让模型调用。</li>
    </ol>

    <div class="co co-ok reveal"><span class="co-ic">🧩</span><div class="co-body">角色卡定义了角色的人设，世界书定义了世界观和游戏的玩法，技能则是赋予角色在世界观下进行游戏的能力。</div></div>
    <div class="moat"></div>
  `,
});
