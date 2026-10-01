// Tavern Harness · Wiki 章节 06「聊天界面全解」
window.WIKI = window.WIKI || { chapters: [] };
window.WIKI.chapters.push({
  id: 'chat',
  group: '酒馆日常',
  num: '陆',
  kicker: 'Chat UI',
  title: '聊天界面全解',
  lead: '输入、思考、工具卡片、消息操作——每一个细节。',
  html: `
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
      <li><b>指标行</b>：每条回复尾部有 <code>⏱️ 延迟 | ⚡ tokens/s | 📥 输入 | 📤 输出</code> 与所用模型名。</li>
      <li><b>Markdown</b>：代码高亮、表格、行内/块级数学公式（KaTeX）均支持渲染。</li>
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

    <h3>滚动与队列联动</h3>
    <p>进入会话定位到最新消息；新消息到达时自动平滑跟随（用户上滚回看不打断）。群聊右侧「<b>发言队列</b>」与对话区<b>双向联动</b>：点击队列项定位到对应发言，滚动对话区也会高亮当前发言人。</p>
    <div class="moat"></div>
  `,
});
