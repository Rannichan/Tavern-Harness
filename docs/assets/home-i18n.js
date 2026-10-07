(function () {
  'use strict';

  var storageKey = 'tavern-docs-language';
  var root = document.documentElement;
  var originalTitle = document.title;
  var originalDescription = document.querySelector('meta[name="description"]').content;
  var original = new Map();
  var text = {
    en: {
      brandHome: 'Tavern Harness home', mainNavigation: 'Main navigation', navStart: 'Get started', navFeatures: 'Features', navWorld: 'World sandbox', navDemo: 'Demo', readWiki: 'Read the Wiki'
    },
    zh: {
      brandHome: 'Tavern Harness 首页', mainNavigation: '主导航', navStart: '启动方式', navFeatures: '核心特点', navWorld: '世界沙盒', navDemo: '试玩 Demo', readWiki: '阅读 Wiki'
    }
  };
  var englishHtml = new Map([
    ['.hero-title', '<span class="line line-1 reveal"><span class="serif">You are here!</span><span class="em">Take a seat~</span></span><span class="line line-2 reveal">Let the tavern keeper</span><span class="line line-3 reveal"><span class="em2 serif">handle everything</span><span class="dim">....</span></span>'],
    ['.hero-sub', 'Push open the wooden door, where candlelight flickers—the tavern keeper has prepared <span class="hl">any world you want to build</span>. Whether it is <span class="tag">companionship</span><span class="tag">adventure</span><span class="tag">other fantasy</span>, it is yours to command, and your data stays in your browser.'],
    ['.hero-cta .btn-primary .btn-label', '→ Enter the tavern (quick start)'],
    ['.hero-cta .btn-ghost:nth-child(2) .btn-label', 'Tavern Keeper’s Handbook (Wiki)'],
    ['.hero-cta .btn-ghost:nth-child(3)', '▶&nbsp; Watch a demo first'],
    ['.hero-ribbon', '✦ Runs locally · No server required · Data stays in your browser ✦'],
    ['#start .kicker-no', 'I'], ['#start .kicker-text', 'Begin with a warm drink'], ['#start .section-title', 'Getting started'], ['#start .section-sub', 'Bring your own API key; everything else stays local.'],
    ['#start .step-card:nth-child(1) h3', 'Install and start'], ['#start .step-card:nth-child(1) > p:not(.step-note)', 'Clone the repository, then open the tavern with three commands:'], ['#start .step-card:nth-child(1) .c-dim', '# Start the tavern'], ['#start .step-card:nth-child(1) .step-note', 'The development server automatically starts the local sandbox service (default: <code>127.0.0.1:17891</code>), allowing generative <code>shell</code> skills to run local commands.'],
    ['#start .step-card:nth-child(2) h3', 'Connect your model'], ['#start .step-card:nth-child(2) > p', 'In <strong>Settings → Model Provider</strong>, add any <strong>OpenAI-compatible</strong> endpoint:'], ['#start .step-card:nth-child(2) li:nth-child(1)', 'Enter a name, Base URL, and API key'], ['#start .step-card:nth-child(2) li:nth-child(2)', 'Select “Test connection” to retrieve models'], ['#start .step-card:nth-child(2) li:nth-child(3)', 'Choose a model at the top of chat and start talking!'],
    ['#start .step-card:nth-child(3) h3', 'Keep data local'], ['#start .step-card:nth-child(3) > p:not(.step-note)', 'All data lives in browser <strong>IndexedDB</strong>—sessions, characters, and Lorebooks never leave your browser. No server is needed.'], ['#start .step-card:nth-child(3) .step-note', 'Can’t see old data after changing browsers or ports? That is browser security at work. Export a JSON from “Share conversation” to take it with you.'],
    ['#magic .kicker-no', 'II'], ['#magic .kicker-text', 'A steward who handles it all'], ['#magic .section-title', 'Feature one'], ['#magic .quote-text', 'You are here! Take a seat~<br />Why wait around?<br /><em>Let the tavern keeper handle everything....</em>'], ['#magic .quote-owner', '— The tavern keeper, always there when you need them'],
    ['#magic .center-text:nth-of-type(1)', 'The keeper has a whole shelf of <strong>generative skills</strong> ready for you: <span class="skill-chip">web_search</span>, <span class="skill-chip">roll_dice</span> <span class="skill-chip">create_skill</span> <span class="skill-chip">manage_timer</span>, <span class="skill-chip">file_read</span>, <span class="skill-chip">file_write</span> <span class="skill-chip">shell</span>, <span class="skill-chip">http_get</span>, <span class="skill-chip">javascript</span> …'],
    ['#magic .center-text:nth-of-type(2)', 'Use <span class="hl">generative skills</span> to write new skills <em>for the keeper</em> on the spot—search, roll dice, set reminders, read and write files, run real commands, and manage game state. Apron on, sleeves rolled up: <strong>they can do it all</strong>.'],
    ['#magic .magic-item:nth-child(1) h4', 'Native tool calling'], ['#magic .magic-item:nth-child(1) p', 'OpenAI <code>tools</code> protocol with real local execution, up to four layers of chained ReAct calls, and automatic <code>role=tool</code> result feedback.'], ['#magic .magic-item:nth-child(2) h4', 'Thinking mode'], ['#magic .magic-item:nth-child(2) p', 'Shows thinking content independently and supports Qwen <code>chat_template_kwargs</code>, so the keeper’s reasoning is visible.'], ['#magic .magic-item:nth-child(3) h4', 'Scheduled messages'], ['#magic .magic-item:nth-child(3) p', 'Ask the keeper to remind you on time—classes, meetings, or potions coming out of the oven.'], ['#magic .magic-item:nth-child(4) h4', 'Multimodal attachments'], ['#magic .magic-item:nth-child(4) p', 'Paste or select images to send with a message, and show the keeper your world sketches directly.'],
    ['#world .kicker-no', 'III'], ['#world .kicker-text', 'Your world, your rules'], ['#world .section-title', 'Feature two · a highly flexible sandbox'], ['#world .section-sub', 'Build any world you can imagine—this is your tavern, and you write the rules.'], ['#world .world-card:nth-child(1) .world-cat', 'Companionship'], ['#world .world-card:nth-child(1) p', 'Someone to talk to late at night, who remembers every small thing you share.'], ['#world .world-card:nth-child(2) .world-cat', 'Adventure'], ['#world .world-card:nth-child(2) p', 'Open the dungeon door, roll the dice for fate, and make choices that lead to different endings.'], ['#world .world-card:nth-child(3) .world-cat', 'Other fantasy'], ['#world .world-card:nth-child(3) p', 'Magic academies, cyber cities, medieval taverns—any imagined place can come alive.'], ['#world .world-detail h3', 'What makes this sandbox so flexible?'],
    ['#demo .kicker-no', 'IV'], ['#demo .kicker-text', 'Seeing is believing'], ['#demo > .section-title', 'Gameplay showcase'], ['#demo > .section-sub', 'See different ways to play in the tavern.'], ['#affinity-demo .demo-video-title', 'Affinity system'], ['#affinity-demo .video-fallback > p:first-child', '🎬 <strong>Affinity system demo</strong>'], ['#affinity-demo .demo-download strong', 'Want to try it yourself?'], ['#affinity-demo .demo-download span', 'Download the game file, then select “Import” in the tavern sidebar to recreate it.'], ['#affinity-demo .demo-download-link', 'Download affinity game file'], ['#multiplayer-demo .demo-video-title', 'Multiplayer group chat'], ['#multiplayer-demo .video-fallback > p:first-child', '🎬 <strong>Multiplayer group-chat demo</strong>'], ['#multiplayer-demo .demo-download strong', 'Want to try it yourself?'], ['#multiplayer-demo .demo-download span', 'Download the game file, then select “Import” in the tavern sidebar to recreate it.'], ['#multiplayer-demo .demo-download-link', 'Download multiplayer game file'], ['#demo .video-fallback .fallback-note', 'The video is temporarily unavailable. Please try again later.'],
    ['.footer-brand .brand-name', 'Tavern Harness'], ['.footer-note', 'Local first · Your data stays in your hands · Build your world now'], ['.footer-links .chip:nth-child(1)', '<img class="chip-icon" src="https://cdn.simpleicons.org/github/ffcb8b" alt="" />Project on GitHub'], ['.footer-links .chip:nth-child(2)', '<img class="chip-icon" src="https://cdn.simpleicons.org/discord/ffcb8b" alt="" />Discord community'], ['.footer-links .chip:nth-child(3)', '<img class="chip-icon" src="https://cdn.simpleicons.org/bilibili/ffcb8b" alt="" />Bilibili introduction video']
  ]);

  function storeLanguage(language) {
    try { localStorage.setItem(storageKey, language); } catch (_error) { /* Ignore unavailable storage. */ }
  }
  function preferredLanguage() {
    try {
      var stored = localStorage.getItem(storageKey);
      if (stored === 'zh' || stored === 'en') return stored;
    } catch (_error) { /* Use browser preference instead. */ }
    return navigator.language && navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  }
  function setContent(language) {
    document.querySelectorAll('[data-i18n]').forEach(function (element) {
      var key = element.getAttribute('data-i18n');
      if (text[language][key]) element.textContent = text[language][key];
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach(function (element) {
      element.setAttribute('aria-label', text[language][element.getAttribute('data-i18n-aria-label')]);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function (element) {
      element.setAttribute('title', text[language][element.getAttribute('data-i18n-title')]);
    });
    englishHtml.forEach(function (english, selector) {
      var element = document.querySelector(selector);
      if (!element) return;
      if (!original.has(element)) original.set(element, element.innerHTML);
      element.innerHTML = language === 'en' ? english : original.get(element);
    });
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    document.title = language === 'en' ? 'Tavern Harness — You are here. Take a seat.' : originalTitle;
    document.querySelector('meta[name="description"]').content = language === 'en'
      ? 'Tavern Harness is a local-first AI role-playing tavern. Build any world you imagine in a flexible sandbox.'
      : originalDescription;

    document.querySelectorAll('.demo-video').forEach(function (video) {
      var source = video.querySelector('source');
      var videoSource = video.getAttribute(language === 'en' ? 'data-video-en' : 'data-video-zh');
      if (source && source.getAttribute('src') !== videoSource) {
        video.pause();
        source.setAttribute('src', videoSource);
        video.load();
      }
    });
    document.querySelectorAll('.demo-download-link').forEach(function (link) {
      link.setAttribute('href', link.getAttribute(language === 'en' ? 'data-game-en' : 'data-game-zh'));
    });

    // Replacing localized markup creates new reveal nodes after the observer was initialized.
    // Mark them visible immediately so translated headings cannot remain transparent.
    document.querySelectorAll('.reveal').forEach(function (element) {
      element.classList.add('visible');
    });
  }
  function applyLanguage(language, persist) {
    root.dataset.language = language;
    setContent(language);
    var button = document.querySelector('[data-language-toggle]');
    if (button) {
      var next = language === 'zh' ? 'EN' : '中文';
      button.textContent = next;
      button.setAttribute('aria-label', language === 'zh' ? 'Switch to English' : '切换为中文');
      button.setAttribute('title', button.getAttribute('aria-label'));
    }
    if (persist) storeLanguage(language);
  }
  document.addEventListener('DOMContentLoaded', function () {
    applyLanguage(preferredLanguage(), false);
    document.querySelector('[data-language-toggle]').addEventListener('click', function () {
      applyLanguage(root.dataset.language === 'zh' ? 'en' : 'zh', true);
    });
  });
})();
