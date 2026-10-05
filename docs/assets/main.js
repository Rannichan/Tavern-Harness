/* Tavern Harness — 主页交互
   漂浮图标 · 滚动进入动画 · 视频回退检测 · 导航高亮 */
(function () {
  'use strict';

  /* ── 漂浮图标（酒馆氛围） ── */
  function spawnEmbers() {
    const field = document.getElementById('ember-field');
    if (!field) return;

    const icons = [
      'assets/icons8-dice-90.png',
      'assets/icons8-lantern-100.png',
      'assets/icons8-quill-pen-96.png'
    ];
    const count = window.innerWidth < 700 ? 9 : 15;

    for (let i = 0; i < count; i++) {
      const icon = document.createElement('img');
      icon.className = 'ember';
      icon.src = icons[i % icons.length];
      icon.alt = '';
      icon.decoding = 'async';
      icon.style.left = Math.random() * 100 + '%';
      icon.style.setProperty('--dur', (11 + Math.random() * 10).toFixed(2) + 's');
      icon.style.setProperty('--delay', (-Math.random() * 18).toFixed(2) + 's');
      icon.style.setProperty('--sway', (Math.random() * 120 - 60).toFixed(0) + 'px');
      icon.style.setProperty('--rotate', (Math.random() * 24 - 12).toFixed(0) + 'deg');
      icon.style.setProperty('--o', (0.3 + Math.random() * 0.3).toFixed(2));
      field.appendChild(icon);
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
            a.classList.toggle('active', a === link);
          });
        }
      },
      { threshold: 0.4 }
    );
    sections.forEach((s) => spy.observe(s));
  }

  /* ── 视频回退检测：仅在媒体本身确实加载失败时显示占位 ── */
  function initVideo() {
    const frame = document.getElementById('video-frame');
    const video = document.getElementById('demo-video');
    if (!frame || !video) return;

    const showFallback = () => {
      frame.classList.add('show-fallback');
    };

    if (!video.querySelector('source')) {
      showFallback();
      return;
    }

    video.addEventListener('error', showFallback, { once: true });
  }

  /* ── 启动 ── */
  spawnEmbers();
  initReveal();
  initTopbar();
  initNavSpy();
  initVideo();
})();