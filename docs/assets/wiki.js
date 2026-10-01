/* Tavern Harness — Wiki 使用手册交互
   章节装配 · 阅读进度 · 侧栏滚动高亮 · 移动端目录抽屉 · 代码复制
   章节内容声明在 docs/wiki/chapters/*.js（一章一文件），本文件只负责装配与交互。 */
(function () {
  'use strict';

  /* ── 装配：目录 + 章节 ── */
  var chapters = (window.WIKI && window.WIKI.chapters) || [];

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
          return '<li><a href="#' + c.id + '">' + c.title + '</a></li>';
        }).join('') +
        '</ul></div>'
      );
    }).join('');
    html +=
      '<div class="wsb-foot">Wiki 与应用同步演进。<br />发现问题？' +
      '<a href="https://github.com/Rannichan/Tavern-Harness/issues">提交 Issue</a>，' +
      '或在 <a href="https://discord.gg/kPSWGeaHx">Discord</a> 里找老板聊聊。</div>';
    aside.innerHTML = html;
  }

  function buildChapters() {
    var top = document.getElementById('wcontent-top');
    if (!top) return;
    var html = chapters.map(function (c) {
      return (
        '<section class="wsec" id="' + c.id + '">' +
        '<div class="wsec-head reveal"><span class="kick-no">' + c.num + '</span>' +
        '<span class="kick-text">' + c.kicker + '</span></div>' +
        '<h2 class="reveal">' + c.title + '<a class="anchor-link" href="#' + c.id + '">§</a></h2>' +
        '<p class="lead reveal">' + c.lead + '</p>' +
        c.html +
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
      '<span>Wiki 与应用同步演进 · 章节内容见 <code>docs/wiki/chapters/</code>（一章一文件），' +
      '发现纰漏欢迎 <a href="https://github.com/Rannichan/Tavern-Harness/issues">提 Issue</a></span>' +
      '<span>© 2026 Tavern Harness. All data stays in your browser.</span></footer>';
    top.insertAdjacentHTML('beforeend', html);
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

  /* ── 侧栏滚动高亮（当前章节） ── */
  function initSpy() {
    const links = Array.from(document.querySelectorAll('.toc a[href^="#"]'));
    if (!links.length) return;
    const map = new Map();
    links.forEach((a) => {
      const id = a.getAttribute('href').slice(1);
      const sec = document.getElementById(id);
      if (sec) map.set(sec, a);
    });
    const spy = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const link = map.get(en.target);
          if (!link) continue;
          links.forEach((a) => a.classList.remove('active'));
          link.classList.add('active');
          // 侧栏内自动跟随
          const sb = document.getElementById('wsb');
          if (sb) {
            const r = link.getBoundingClientRect();
            const sr = sb.getBoundingClientRect();
            if (r.top < sr.top + 60 || r.bottom > sr.bottom - 60) {
              sb.scrollTo({ top: sb.scrollTop + r.top - sr.top - sb.clientHeight / 2, behavior: 'smooth' });
            }
          }
        }
      },
      { rootMargin: '-70px 0px -66% 0px', threshold: 0 }
    );
    map.forEach((_, sec) => spy.observe(sec));
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
  initProgress();
  initSpy();
  initAnchorFix();
  initDrawer();
  initCopy();
  initReveal();
})();
