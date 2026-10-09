(function () {
  'use strict';

  var storageKey = 'tavern-docs-language';
  var root = document.documentElement;
  var originalTitle = document.title;
  var originalDescription = document.querySelector('meta[name="description"]').content;
  var original = new Map();
  var text = {
    en: {
      brandHome: 'Tavern Harness home', mainNavigation: 'Main navigation', navStart: 'Get started', navFeatures: 'Feature 1', navWorld: 'Feature 2', navDemo: 'Gameplay showcase', readWiki: 'Read the Wiki'
    },
    zh: {
      brandHome: 'Tavern Harness 首页', mainNavigation: '主导航', navStart: '启动方式', navFeatures: '核心特点1', navWorld: '核心特点2', navDemo: '玩法展示', readWiki: '阅读 Wiki'
    }
  };
  var englishHtml = new Map([
    ['.hero-title', '<span class="line line-1 reveal"><span class="serif">You are here!</span><span class="em">Take a seat~</span></span><span class="line line-2 reveal">Let the tavern keeper</span><span class="line line-3 reveal"><span class="em2 serif">handle everything</span><span class="dim">....</span></span>'],
    ['.hero-sub', 'Push open the wooden door, where candlelight flickers—the tavern keeper has prepared <span class="hl">any world your imagination can build</span>. Whether it is <span class="tag">companionship</span><span class="tag">adventure</span>, or <span class="tag">other fantasy</span>, it is yours to command!'],
    ['.hero-cta .btn-primary .btn-label', 'Enter the tavern'],
    ['.hero-cta .btn-ghost:nth-child(2) .btn-label', 'Project on GitHub'],
    ['.hero-cta .btn-ghost:nth-child(3) .btn-label', 'Watch a demo first'],
['#start .kicker-text', 'Begin with a warm drink'], ['#start .section-title', 'Getting started'],
    ['#start .step-card:nth-child(1) h3', 'Install and start'], ['#start .step-card:nth-child(1) > p:not(.step-note)', 'Install globally, then start the tavern from any directory:'], ['#start .step-card:nth-child(1) .c-dim', '# Install and start the tavern'], ['#start .step-card:nth-child(1) .step-note', 'The first launch starts a local server and opens your browser automatically.'],
    ['#start .step-card:nth-child(2) h3', 'Connect your model'], ['#start .step-card:nth-child(2) > p', 'In <strong>Settings → Model Provider</strong>, add any <strong>OpenAI-compatible</strong> endpoint:'], ['#start .step-card:nth-child(2) li:nth-child(1)', 'Enter a name, Base URL, and API key'], ['#start .step-card:nth-child(2) li:nth-child(2)', 'Select “Test connection” to retrieve models'], ['#start .step-card:nth-child(2) li:nth-child(3)', 'Choose a model at the top of chat and start talking!'],
    ['#start .step-card:nth-child(3) h3', 'Keep data local'], ['#start .step-card:nth-child(3) > p:not(.step-note)', 'This app does not provide network services; all generated data stays local. Use your own API key or a locally deployed model service to protect your privacy.'],
['#magic .kicker-text', 'A steward who handles it all'], ['#magic .section-title', 'The tavern keeper'], ['#magic .quote-text', 'You are here! Take a seat~<br />Why wait around?<br /><em>Let the tavern keeper handle everything....</em>'], ['#magic .quote-owner', '— The tavern keeper, always there when you need them'],
    ['#magic .center-text:nth-of-type(1)', 'The keeper has a whole shelf of <strong>built-in skills</strong> ready for you: <span class="skill-chip">run_shell_script</span>, <span class="skill-chip">roll_dice</span>, <span class="skill-chip">file_read</span>, <span class="skill-chip">file_write</span>, <span class="skill-chip">file_edit</span>, <span class="skill-chip">file_display</span>, <span class="skill-chip">create_character</span>…'],
    ['#magic .center-text:nth-of-type(2)', 'You can also have the keeper create new skills on the spot <em>and configure them for characters</em>—run local commands, roll dice, read, write, and display files, and manage characters, conversations, and world settings. Apron on, sleeves rolled up: <strong>they can do it all</strong>.'],
    ['#magic .magic-item:nth-child(1) h4', 'Dice checks'], ['#magic .magic-item:nth-child(1) p', 'Have the keeper call <code>roll_dice</code> to roll fate and make fair rulings at key moments in an adventure.'], ['#magic .magic-item:nth-child(2) h4', 'Game dashboard'], ['#magic .magic-item:nth-child(2) p', 'Read, write, and display game files to check character status, quest progress, and important changes in the world.'], ['#magic .magic-item:nth-child(3) h4', 'Build new characters'], ['#magic .magic-item:nth-child(3) p', 'Have the keeper create a new character from your setting—an unforgettable companion, rival, or passerby for your world.'], ['#magic .magic-item:nth-child(4) h4', 'Build custom skills'], ['#magic .magic-item:nth-child(4) p', 'Package repeated gameplay into a skill, configure it for characters, and let your world run by your own rules.'],
['#world .kicker-text', 'Your world, your rules'], ['#world .section-title', 'Highly flexible roleplay'], ['#world .section-sub', 'Build any world you can imagine—this is your tavern, and you write the rules.'], ['#world .world-card:nth-child(1) .world-cat', 'Multiplayer mode'], ['#world .world-card:nth-child(1) p', 'Group chat lets characters @ one another and speak automatically. Observe their behavior from a god’s-eye view or join the scene as a character—many ways to play await.'], ['#world .world-card:nth-child(2) .world-cat', 'All-purpose sandbox'], ['#world .world-card:nth-child(2) p', 'Every character can read and write files and execute code, allowing complex gameplay to be coded and unlocking unlimited freedom.'], ['#world .world-card:nth-child(3) .world-cat', 'Open ecosystem'], ['#world .world-card:nth-child(3) p', 'Import and export games easily while staying compatible with the SillyTavern ecosystem. Friends can play your creations and build on them further—no barriers, no limits!'],
['#demo .kicker-text', 'Seeing is believing'], ['#demo > .section-title', 'Gameplay showcase'], ['#demo > .section-sub', 'See different ways to play in the tavern.'], ['#affinity-demo .demo-video-title', 'Build an affinity system from scratch'], ['#affinity-demo .video-fallback > p:first-child', '🎬 <strong>Affinity system demo</strong>'], ['#affinity-demo .demo-download strong', 'Want to try it yourself?'], ['#affinity-demo .demo-download span', 'Download the game file, then select “Import” in the tavern sidebar to recreate it.'], ['#affinity-demo .demo-download-link', 'Download affinity game file'], ['#multiplayer-demo .demo-video-title', 'Multiplayer group chat'], ['#multiplayer-demo .video-fallback > p:first-child', '🎬 <strong>Multiplayer group-chat demo</strong>'], ['#multiplayer-demo .demo-download strong', 'Want to try it yourself?'], ['#multiplayer-demo .demo-download span', 'Download the game file, then select “Import” in the tavern sidebar to recreate it.'], ['#multiplayer-demo .demo-download-link', 'Download multiplayer game file'], ['#demo .video-fallback .fallback-note', 'The video is temporarily unavailable. Please try again later.'],
    ['.footer-brand .brand-name', 'Tavern Harness'], ['.footer-links .chip:nth-child(1)', '<img class="chip-icon" src="https://cdn.simpleicons.org/github/ffcb8b" alt="" />Project on GitHub'], ['.footer-links .chip:nth-child(2)', '<img class="chip-icon" src="https://cdn.simpleicons.org/discord/ffcb8b" alt="" />Discord community'], ['.footer-links .chip:nth-child(3)', '<img class="chip-icon" src="https://cdn.simpleicons.org/bilibili/ffcb8b" alt="" />Bilibili introduction video']
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
    document.title = language === 'en' ? 'Introdution·Tavern Harness' : originalTitle;
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
