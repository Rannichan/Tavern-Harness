// Tavern Harness · Wiki 章节 06「聊天界面全解」
window.WIKI = window.WIKI || { chapters: [] };
window.WIKI.chapters.push({
  id: 'chat',
  group: '酒馆日常',
  kicker: 'Chat UI',
  title: '聊天界面',
  lead: '从左上角 <span class="chip chip-main"><i class="ic" data-ic="send"></i> 对话</span> 进入 → 头部按钮、输入、思考、工具卡片、消息操作——每一个细节。',
  html: `
    <h3>功能按钮</h3>
    <p>对话页面右上角是一排五个功能按钮，悬停各自可看完整提示：</p>
    <div class="tbl-wrap tbl-nowrap"><table>
      <thead><tr><th>按钮</th><th>作用</th><th>说明</th></tr></thead>
      <tbody>
        <tr><td><b><i class="ic" data-ic="folder"></i> 工作区文件</b></td><td>只读浏览本对话的专属工作目录</td><td>打开「<b>工作区文件</b>」管理器。详见「工作区与文件」章。</td></tr>
        <tr><td><b><i class="ic" data-ic="pencil"></i> 编辑对话</b></td><td>打开与「创建对话」同款的设置弹窗</td><td>可改标题、参与角色与座位顺序、随机顺序、开场白开关、用户人设、世界书；保存即时生效（发言队列按新设置重建），消息历史保留。</td></tr>
        <tr><td><b><i class="ic" data-ic="refresh"></i> 重置对话</b></td><td>清空消息重新开局</td><td>弹确认框后清空全部消息，按当前设置重建发言队列并重置开场白。会话设置保留，消息不可恢复。</td></tr>
        <tr><td><b><i class="ic" data-ic="share"></i> 导出游戏</b></td><td>把整局游戏打包成 JSON</td><td>与侧栏会话右键「<b>导出游戏</b>」同一弹窗，默认勾选「<b>包含对话历史</b>」。详见「导出 & 导入」章。</td></tr>
        <tr><td><b><i class="ic" data-ic="trash"></i> 删除对话</b></td><td>彻底删除本局</td><td>红色危险按钮：确认后删除会话及全部消息，并清理专属工作目录 <code>sandbox_workspace/session-&lt;id&gt;/</code>，不可恢复。</td></tr>
      </tbody>
    </table></div>
    <div class="co co-note reveal"><span class="co-ic">🧹</span><div class="co-body"><b>「重置」与「删除」的区别</b>：重置只清消息、设置与工作目录文件原样保留；删除则连磁盘上专属工作目录一起清掉。改玩法从头再来用重置，这一局不要了才用删除。</div></div>

    <h3>输入与发送</h3>
    <ul class="plain">
      <li><code>Enter</code> 发送 · <code>Shift+Enter</code> 换行。</li>
      <li>附件：点击 / 粘贴（剪贴板图片）/ 多选，支持图片与视频，随消息一起发送。</li>
      <li>魔法命令：<code>/new</code> 开始新话题（截断上下文）；群聊另有 <code>/pass</code> 跳过本轮发言（不修改历史）。群聊还支持 <code>@角色名</code> 点名，输入自动补全。</li>
      <li>流式生成时发送键变为<b>停止生成</b>；中断后已生成部分自动落库。</li>
    </ul>

    <h3>消息与生成</h3>
    <ul class="plain">
      <li><b>思考内容</b>：折叠块「🧠 思考」，生成过程中实时预览，完成后默认收起。</li>
      <li><b>工具调用卡片</b>：<code>调用工具: {name}</code>，可展开查看参数 JSON 与完整结果；执行中显示转圈，<code>file_display</code> 结果附「查看」按钮弹窗展示。<code>ERROR:</code> / <code>CANCELLED:</code> 结果会红色高亮独立展示。</li>
      <li><b>指标行</b>：每条回复尾部有 <code>⏱️ 延迟 | ⚡ tokens/s | 📥 输入 | 📤 输出</code>。</li>
      <li><b>Markdown</b>：代码高亮、表格、行内/块级数学公式均支持渲染。</li>
    </ul>

    <h3>消息右键菜单</h3>
    <div class="tbl-wrap"><table>
      <thead><tr><th>菜单项</th><th>适用</th><th>说明</th></tr></thead>
      <tbody>
        <tr><td><b>编辑消息</b></td><td>user / assistant</td><td>气泡内联编辑，支持增删附件。玩家消息可「保存并重新生成」（删其后全部消息重跑）；NPC 消息「仅保存」。<code>⌘/Ctrl+Enter</code> 保存 · <code>Esc</code> 取消</td></tr>
        <tr><td><b>重新生成回复</b></td><td>assistant</td><td>删除该消息及之后内容后重跑；失败自动回滚快照。群聊会把该角色重新置顶队列「重讲一遍」</td></tr>
        <tr><td><b>查看原始日志</b></td><td>有 raw 日志时</td><td>标签页「请求体 / 完整响应」（由 SSE 分片拼装），自动脱敏，可下载 txt</td></tr>
        <tr><td><b>创建分支 / Fork</b></td><td>所有消息</td><td>复制该消息及之前历史到新会话（标题 <code>{title} #fork</code>），共享世界书、人设与队列设置，分配<b>独立工作目录</b></td></tr>
      </tbody>
    </table></div>

    <div class="moat"></div>
  `,
});
