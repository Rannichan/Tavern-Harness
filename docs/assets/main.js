/* Tavern Harness — 主页交互
   火星粒子 · 滚动进入动画 · 视频回退检测 · 导航高亮 */
(function () {
  'use strict';

  /* ── 火星粒子（烛火氛围） ── */
  function spawnEmbers() {
    const field = document.getElementById('ember-field');
    if (!field) return;
    const count = window.innerWidth < 700 ? 22 : 36;
    for (let i = 0; i < count; i++) {
      const e = document.createElement('span');
      e.className = 'ember';
      const size = 3 + Math.random() * 4;
      e.style.width = size + 'px';
      e.style.height = size + 'px';
      e.style.left = Math.random() * 100 + '%';
      e.style.setProperty('--dur', (7 + Math.random() * 9).toFixed(2) + 's');
      e.style.setProperty('--delay', (-Math.random() * 12).toFixed(2) + 's');
      e.style.setProperty('--sway', (Math.random() * 90 - 45).toFixed(0) + 'px');
      e.style.setProperty('--o', (0.35 + Math.random() * 0.5).toFixed(2));
      field.appendChild(e);
    }
  }

  /* ── 滚动进入动画 ── */
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (en.isIntersecting) {
          en.target.classList.add('visible');
          io.unobserve(en.target);
        }
      }
    },
    { threshold: 0.12, rootMargin: '0px 0px -60px 0px' }
  );

  function initReveal() {
    document.querySelectorAll('.reveal').forEach((el, i) => {
      el.style.setProperty('--rd', Math.min(i % 6, 3) * 90 + 'ms');
      io.observe(el);
    });
  }

  /* ── 滚动时给顶栏加深背景 ── */
  function initTopbar() {
    const bar = document.getElementById('topbar');
    if (!bar) return;
    const onScroll = () => {
      if (window.scrollY > 20) {
        bar.style.background = 'var(--topbar-bg-solid)';
      } else {
        bar.style.background = 'var(--topbar-bg)';
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ── 导航高亮（当前章节） ── */
  function initNavSpy() {
    const links = Array.from(document.querySelectorAll('.nav a'));
    if (links.length === 0) return;
    const map = new Map();
    links.forEach((a) => {
      const id = a.getAttribute('href').replace('#', '');
      if (id) map.set(id, a);
    });
    const sections = Array.from(map.keys())
      .map((id) => document.getElementById(id))
      .filter(Boolean);

    const spy = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const link = map.get(en.target.id);
          if (!link) continue;
          links.forEach((a) => {
            a.style.color = a === link ? '#F2EADC' : '';
            a.style.textShadow = a === link ? '0 0 14px rgba(255,178,96,0.4)' : '';
            const after = a.querySelector('::after');
            if (after) after.style.width = a === link ? '100%' : '';
          });
        }
      },
      { threshold: 0.4 }
    );
    sections.forEach((s) => spy.observe(s));
  }

  /* ── 视频回退检测：demo.mp4 不存在时展示占位 ── */
  function initVideo() {
    const frame = document.getElementById('video-frame');
    const video = document.getElementById('demo-video');
    if (!frame || !video) return;

    let failed = false;
    const showFallback = () => {
      if (failed) return;
      failed = true;
      frame.classList.add('show-fallback');
    };

    const src = video.querySelector('source');
    if (src) {
      src.addEventListener('error', showFallback, { once: true });
      // 预检资源存在性
      fetch(src.getAttribute('src'), { method: 'HEAD' })
        .then((r) => {
          if (!r.ok) throw new Error('not found');
        })
        .catch(showFallback);
    } else {
      showFallback();
    }

    // 解码失败也算缺失
    video.addEventListener('error', showFallback, { once: true });
  }

  /* ── 启动 ── */
  spawnEmbers();
  initReveal();
  initTopbar();
  initNavSpy();
  initVideo();
})();