/* Tavern Harness — Wiki 使用手册交互
   章节装配 · 阅读进度 · 侧栏滚动高亮 · 移动端目录抽屉 · 代码复制
   章节内容声明在 docs/wiki/chapters/*.js（一章一文件），本文件只负责装配与交互。 */
(function () {
  'use strict';
  /* ── 装配：目录 + 章节 ── */
  var chapters = (window.WIKI && window.WIKI.chapters) || [];

  /* 目录与正文共用同一阅读顺序：按 group 首次出现顺序排列，组内保持脚本装配顺序。
     把章节移组后正文顺序自动跟随目录，无需再手动对齐 wiki.html 的加载顺序。 */
  (function sortChaptersByGroup() {
    var gi = new Map();
    chapters.forEach(function (c) { if (!gi.has(c.group)) gi.set(c.group, gi.size); });
    chapters.sort(function (a, b) { return gi.get(a.group) - gi.get(b.group); });
  })();

  /* 章节里的内联图标：与应用同源（src/components/shared.tsx 的 ICONS 集合）。
     章节文件写 <i class="ic" data-ic="plus"></i>，装配时替换成应用同款描边 SVG。 */
  var WIKI_ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    import: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 14l-5 5-5-5M12 19V7"/>',
    folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4M12 2v13"/>',
    pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5l-5 1 1-5Z"/><path d="m15 5 4 4"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    send: '<path d="M3 11.5 21 3l-8.5 18-2.5-7.5L3 11.5z"/>',
    settings: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>'
  };
  function injectIcons() {
    document.querySelectorAll('.wsec i.ic[data-ic]').forEach(function (ic) {
      var d = WIKI_ICONS[ic.getAttribute('data-ic')];
      if (!d) return;
      ic.innerHTML =
        '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"' +
        ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
    });
  }

  function buildToc() {
    var aside = document.getElementById('wsb');
    if (!aside) return;
    var groups = []; // [{ name, chapters }]
    chapters.forEach(function (c) {
      var g = groups.find(function (x) { return x.name === c.group; });
      if (!g) groups.push((g = { name: c.group, chapters: [] }));
      g.chapters.push(c);
    });
    var html = groups.map(function (g) {
      return (
        '<div class="toc-group"><div class="toc-group-label">' + g.name + '</div>' +
        '<ul class="toc">' +
        g.chapters.map(function (c) {
          // 二级目录：解析章节 html 中的 h3 小节标题
          var holder = document.createElement('div');
          holder.innerHTML = c.html || '';
          var subs = Array.from(holder.querySelectorAll('h3')).map(function (h) {
            var text = h.textContent.replace(/\s+/g, ' ').trim();
            return '<li><a href="#' + c.id + ':' + slug(text) + '" data-sub="1">' + text + '</a></li>';
          }).join('');
          return (
            '<li><a href="#' + c.id + '">' + c.title + '</a></li>' +
            (subs ? '<ul class="toc-sub">' + subs + '</ul>' : '')
          );
        }).join('') +
        '</ul></div>'
      );
    }).join('');
    aside.innerHTML = html;
  }

  /* 稳定的锚点 slug：抽中文/英文/数字，其余折叠为分隔符 */
  function slug(raw) {
    return (raw || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '');
  }

  function buildChapters() {
    var top = document.getElementById('wcontent-top');
    if (!top) return;
    var html = chapters.map(function (c) {
      // 为每个 h3 注入锚点 id（章节号 + 标题 slug），供二级目录跳转
      var body = (c.html || '').replace(/<h3>([\s\S]*?)<\/h3>/g, function (_m, inner) {
        var text = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        return '<h3 id="' + c.id + ':' + slug(text) + '">' + inner + '</h3>';
      });
      return (
        '<section class="wsec" id="' + c.id + '">' +
        '<div class="wsec-head reveal"><span class="kick-text">' + c.kicker + '</span></div>' +
        '<h2 class="reveal">' + c.title + '<a class="anchor-link" href="#' + c.id + '">§</a></h2>' +
        '<p class="lead reveal">' + c.lead + '</p>' +
        body +
        '</section>'
      );
    }).join('');
    // 底部导航 + 页脚（随章节一起装配）
    html +=
      '<nav class="wend-nav reveal">' +
      '<a class="end-link" href="#' + (chapters[0] ? chapters[0].id : 'top') + '">' +
      '<span class="el-label">↑ 回到开头</span><span class="el-title">' +
      (chapters[0] ? chapters[0].title : '') + '</span></a>' +
      '<a class="end-link" href="index.html"><span class="el-label">↩ 回到主线</span>' +
      '<span class="el-title">产品主页</span></a></nav>' +
      '<footer class="wfooter"><div class="wf-brand">酒馆助手 · Tavern Harness</div>' +
      '<span>© 2026 Tavern Harness. All data stays in your browser.</span></footer>';
    top.insertAdjacentHTML('beforeend', html);
    linkXrefs(top);
  }

  /* 交文跳转：把正文里的「章节名」「章节名 → 小节名」解析成锚点链接。
     匹配特征：全角引号包裹，且其后紧跟「章 / 章节」，或引号内容精确等于
     某章节标题 / 小节标题（可带「→」路径）。只命中真实标题才改写，
     普通 UI 名称（如「新建」）不受影响；本章节内的提及不生成链接。 */
  function makeXrefLink(text, href) {
    return '<a class="xref" href="#' + href + '">' + text + '</a>';
  }

  function linkXrefs(container) {
    if (!container || !chapters.length) return;
    var byTitle = new Map(); // 标题 → { id, chapter }
    chapters.forEach(function (c) {
      byTitle.set(c.title, { id: c.id, chapter: c });
    });
    chapters.forEach(function (c) {
      var holder = document.createElement('div');
      holder.innerHTML = c.html || '';
      Array.from(holder.querySelectorAll('h3')).forEach(function (h) {
        var text = h.textContent.replace(/\s+/g, ' ').trim();
        if (!text) return;
        var bare = text.replace(/^[^A-Za-z0-9\s]+/, '').replace(/\s*$/, '').trim(); // 去掉「⭐️ / 🛠」类 emoji 前缀
        if (bare && !byTitle.has(bare)) byTitle.set(bare, { id: c.id + ':' + slug(text), chapter: c });
      });
    });

    /* 全角引号 + 后跟可选「章 / 章节」（紧跟句读/空白/结尾也可） */
    var quoted = /「([^「」]+)」(章|章节)?(?=[)）。，；,.:：!?！？\s]|$)/g;
    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        var tag = p.tagName;
        if (tag === 'CODE' || tag === 'PRE' || tag === 'SCRIPT' || tag === 'STYLE') return NodeFilter.FILTER_REJECT;
        if (p.closest('.moat, .anchor-link')) return NodeFilter.FILTER_REJECT;
        return quoted.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    nodes.forEach(function (node) {
      var root = node.parentElement ? node.parentElement.closest('section.wsec') : null;
      var curId = root ? root.id : null;
      var text = node.nodeValue;
      var frag = document.createDocumentFragment();
      var last = 0;
      var re = new RegExp(quoted.source, 'g');
      var m;
      while ((m = re.exec(text))) {
        var raw = m[0].trim();
        var inner = m[1].trim();
        var hit = null;
        var parts = inner.split('→').map(function (s) { return s.trim(); }).filter(Boolean);
        if (parts.length > 1) {
          var base = byTitle.get(parts[0]);
          if (base && parts[1]) {
            var sub = byTitle.get(parts[1]);
            hit = sub && sub.chapter === base.chapter ? sub : base;
          }
        } else if (byTitle.has(inner)) {
          hit = byTitle.get(inner);
        }
        if (!hit || (curId && hit.chapter.id === curId)) continue;
        frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        frag.appendChild(document.createRange().createContextualFragment(makeXrefLink(raw, hit.id)));
        last = m.index + m[0].length;
      }
      if (!last) return;
      frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
  }

  /* ── 阅读进度条 ── */
  function initProgress() {
    const bar = document.getElementById('progressBar');
    if (!bar) return;
    const onScroll = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      bar.style.width = max > 0 ? (window.scrollY / max) * 100 + '%' : '0%';
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* 文档绝对坐标（offsetTop 只反映最近定位祖先） */
  function absTop(el) {
    let y = 0;
    for (let n = el; n; n = n.offsetParent) y += n.offsetTop;
    return y;
  }

  /* ── 侧栏滚动高亮（章节 + 小节两级，滚动监听版） ── */
  function initSpy() {
    const links = Array.from(document.querySelectorAll('.toc a[href^="#"], .toc-sub a[href^="#"]'));
    if (!links.length) return;
    // 收集（目标元素 → 侧栏链接），按文档顺序排列
    const targets = [];
    links.forEach((a) => {
      const id = a.getAttribute('href').slice(1);
      const sec = document.getElementById(id);
      if (sec) targets.push({ el: sec, link: a });
    });
    targets.sort((x, y) => absTop(x.el) - absTop(y.el));
    let ticking = false;
    const update = () => {
      ticking = false;
      if (!targets.length) return;
      const line = 90; // 判定线：视口顶部下方 90px
      const lineAbs = window.scrollY + line;
      let current = targets[0];
      for (const t of targets) {
        if (absTop(t.el) <= lineAbs + 1) current = t;
        else break;
      }
      // 文档触底时锁定最后一个目标（可视高度不足时末尾小节越不过判定线）
      const doc = document.documentElement;
      if (window.scrollY + window.innerHeight >= doc.scrollHeight - 2) current = targets[targets.length - 1];
      links.forEach((a) => a.classList.remove('active'));
      current.link.classList.add('active');
      // 二级小节激活时，同时点亮其所属章节（本子列表的兄长项）
      const subList = current.link.closest('.toc-sub');
      const chapterLink = subList ? subList.previousElementSibling?.querySelector?.('a') : null;
      if (chapterLink) chapterLink.classList.add('active');
      // 侧栏内自动跟随
      const sb = document.getElementById('wsb');
      if (sb) {
        const r = current.link.getBoundingClientRect();
        const sr = sb.getBoundingClientRect();
        if (r.top < sr.top + 60 || r.bottom > sr.bottom - 60) {
          sb.scrollTo({ top: sb.scrollTop + r.top - sr.top - sb.clientHeight / 2, behavior: 'smooth' });
        }
      }
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();
  }

  /* ── 首次进入带 hash 时修正滚动位置 ── */
  function initAnchorFix() {
    if (!location.hash) return;
    requestAnimationFrame(() => {
      const el = document.getElementById(location.hash.slice(1));
      if (el) el.scrollIntoView();
    });
  }

  /* ── 移动端目录抽屉 ── */
  function initDrawer() {
    const sb = document.getElementById('wsb');
    const btn = document.getElementById('tocToggle');
    const overlay = document.getElementById('wsbOverlay');
    if (!sb || !btn || !overlay) return;
    const close = () => {
      sb.classList.remove('open');
      overlay.classList.remove('show');
    };
    btn.addEventListener('click', () => {
      sb.classList.toggle('open');
      overlay.classList.toggle('show', sb.classList.contains('open'));
    });
    overlay.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
    sb.addEventListener('click', (e) => {
      if (e.target.closest('a[href^="#"]')) close();
    });
  }

  /* ── 全文搜索：索引已装配的章节与小节，保持内容源仍为章节文件 ── */
  function initSearch() {
    const dialog = document.getElementById('wikiSearchDialog');
    const toggle = document.getElementById('wikiSearchToggle');
    const input = document.getElementById('wikiSearchInput');
    const results = document.getElementById('wikiSearchResults');
    if (!dialog || !toggle || !input || !results) return;

    const index = chapters.flatMap((chapter) => {
      const section = document.getElementById(chapter.id);
      if (!section) return [];
      const items = [{
        title: chapter.title,
        context: chapter.group,
        target: chapter.id,
        text: section.textContent.replace(/\s+/g, ' ').trim()
      }];
      section.querySelectorAll('h3[id]').forEach((heading) => {
        const content = [];
        for (let node = heading.nextElementSibling; node && node.tagName !== 'H3'; node = node.nextElementSibling) {
          content.push(node.textContent);
        }
        items.push({
          title: heading.textContent.trim(),
          context: chapter.title,
          target: heading.id,
          text: (heading.textContent + ' ' + content.join(' ')).replace(/\s+/g, ' ').trim()
        });
      });
      return items;
    });

    const close = () => {
      dialog.hidden = true;
      toggle.focus();
    };
    const open = () => {
      dialog.hidden = false;
      input.value = '';
      render('');
      requestAnimationFrame(() => input.focus());
    };
    const excerpt = (text, query) => {
      const offset = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
      if (offset < 0) return text.slice(0, 118) + (text.length > 118 ? '…' : '');
      const start = Math.max(0, offset - 36);
      const end = Math.min(text.length, offset + query.length + 72);
      return (start ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
    };
    const render = (rawQuery) => {
      const query = rawQuery.trim();
      if (!query) {
        results.innerHTML = '<p class="wiki-search-empty">输入关键词，搜索 ' + chapters.length + ' 个章节。</p>';
        return;
      }
      const matches = index.filter((item) => item.text.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 12);
      if (!matches.length) {
        results.innerHTML = '<p class="wiki-search-empty">没有找到“' + escapeHtml(query) + '”相关内容。</p>';
        return;
      }
      results.innerHTML = matches.map((item) =>
        '<a class="wiki-search-result" href="#' + item.target + '">' +
        '<span class="wiki-search-result-context">' + escapeHtml(item.context) + '</span>' +
        '<strong>' + escapeHtml(item.title) + '</strong>' +
        '<span>' + escapeHtml(excerpt(item.text, query)) + '</span></a>'
      ).join('');
    };
    const escapeHtml = (value) => value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);

    toggle.addEventListener('click', open);
    input.addEventListener('input', () => render(input.value));
    dialog.addEventListener('click', (event) => {
      if (event.target.closest('[data-search-close], .wiki-search-result')) close();
    });
    document.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        dialog.hidden ? open() : close();
      } else if (event.key === 'Escape' && !dialog.hidden) {
        close();
      }
    });
  }

  /* ── 代码块复制按钮 ── */
  function initCopy() {
    document.querySelectorAll('pre > code').forEach((code) => {
      const pre = code.parentElement;
      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.textContent = '复制';
      btn.addEventListener('click', () => {
        navigator.clipboard?.writeText(code.textContent).then(
          () => {
            btn.textContent = '已复制 ✓';
            btn.classList.add('copied');
            setTimeout(() => {
              btn.textContent = '复制';
              btn.classList.remove('copied');
            }, 1600);
          },
          () => (btn.textContent = '失败 ✕')
        );
      });
      code.before(btn);
    });
  }

  /* ── 入场动画 ── */
  function initReveal() {
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            en.target.classList.add('visible');
            io.unobserve(en.target);
          }
        }
      },
      { threshold: 0.06, rootMargin: '0px 0px -40px 0px' }
    );
    document.querySelectorAll('.reveal').forEach((el, i) => {
      el.style.setProperty('--rd', Math.min(i % 5, 3) * 70 + 'ms');
      io.observe(el);
    });
  }

  buildToc();
  buildChapters();
  injectIcons();
  initProgress();
  initSpy();
  initAnchorFix();
  initDrawer();
  initSearch();
  initCopy();
  initReveal();
})();
