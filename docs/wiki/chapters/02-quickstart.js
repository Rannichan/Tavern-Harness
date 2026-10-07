// Tavern Harness · Wiki 章节 02「三步开张」
window.WIKI = window.WIKI || { chapters: [] };
window.WIKI.chapters.push({
  id: 'quickstart',
  group: '开张准备',
  kicker: 'Quickstart',
  title: '三步开张',
  lead: '只需要 Node.js ≥ 18，无需外部harness、无需 Docker、无需数据库服务。',
  html: `
    <h3>启动酒馆</h3>
    <p>三种方式任选其一：</p>
    <div class="tbl-wrap"><table>
      <thead><tr><th>方式</th><th>命令</th><th>说明</th></tr></thead>
      <tbody>
        <tr><td><b>一键启动（推荐）</b></td><td><span class="mono">npx tavern-harness</span></td><td>无需克隆仓库或全局安装；首次运行会下载包、启动本地服务并自动打开浏览器，<span class="mono">--no-open</span>/<span class="mono">--port 5273</span> 可选</td></tr>
        <tr><td>全局安装（推荐长期使用）</td><td><span class="mono">npm install -g tavern-harness<br>tavern-harness</span></td><td>安装一次后，可从任意目录启动；可用 <span class="mono">npm update -g tavern-harness</span> 更新</td></tr>
        <tr><td>从源码安装</td><td><span class="mono">git clone … &amp;&amp; npm install &amp;&amp; npm run dev</span></td><td>开发服务器默认 5173，被占用自动顺延</td></tr>
      </tbody>
    </table></div>
    <p class="dim">首次启动时内置角色<b>「酒馆老板」</b>已经做好在柜台后等你——他默认启用全部 19 项内置技能，开局就能交办杂活。</p>

    <h3>接入模型</h3>
    <p>打开「<b>设置 → 模型服务 Provider（多端点）</b>」，点「<b>添加 Provider</b>」：</p>
    <ol class="steps">
      <li>填写 <code>名称</code>、<code>Base URL</code>、<code>API Key</code> —— 任意 OpenAI 兼容 <code>chat/completions</code> 端点均可（OpenAI / DeepSeek / Qwen / SiliconFlow / Ollama / LM Studio / 自建 vLLM）</li>
      <li>点「<b>测试</b>」，依次尝试 <code>{base}/models</code> 与 <code>{base}/v1/models</code>，成功会拉取模型列表</li>
      <li>为模型设置不重复的别名，并按需开启模型；启用 Provider 后，回到聊天页顶部「<b>选模型</b>」选择已开启的模型即可开聊</li>
    </ol>
    <div class="co co-note reveal"><span class="co-ic">💬</span><div class="co-body">若目标服务未开 CORS 头导致跨域被拦，应用会自动尝试经<b>内置同源代理</b>转发（仅限内网/局域网地址；公网 HTTPS 不代理）。经代理成功时 Base URL 会自动改写为代理形式保存，提示会注明「经本地代理转发」。</div></div>

    <h3>开聊前的最后检查</h3>
    <ul class="plain">
      <li>同一浏览器 + 同一端口访问：数据与浏览器/端口/站点绑定，换了看不到旧数据（详见「数据与隐私」）。</li>
    </ul>
    <div class="moat"></div>
  `,
});
