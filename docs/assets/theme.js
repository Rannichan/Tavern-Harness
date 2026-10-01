(function () {
  'use strict';

  var storageKey = 'tavern-docs-theme';
  var root = document.documentElement;

  function preferredTheme() {
    try {
      var stored = localStorage.getItem(storageKey);
      if (stored === 'light' || stored === 'dark') return stored;
    } catch (_error) {
      // Storage may be unavailable in privacy-restricted contexts.
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
      var isDark = theme === 'dark';
      button.setAttribute('aria-label', isDark ? '切换到日间模式' : '切换到夜间模式');
      button.setAttribute('title', isDark ? '切换到日间模式' : '切换到夜间模式');
      button.setAttribute('aria-pressed', String(isDark));
      // SVG 元素没有 hidden 的属性↔属性值映射，必须直接操作 attribute
      button.querySelector('.theme-icon-sun').toggleAttribute('hidden', !isDark);
      button.querySelector('.theme-icon-moon').toggleAttribute('hidden', isDark);
    });
  }

  applyTheme(preferredTheme());

  document.addEventListener('DOMContentLoaded', function () {
    applyTheme(root.dataset.theme || preferredTheme());
    document.querySelectorAll('[data-theme-toggle]').forEach(function (button) {
      button.addEventListener('click', function () {
        var next = root.dataset.theme === 'dark' ? 'light' : 'dark';
        try {
          localStorage.setItem(storageKey, next);
        } catch (_error) {
          // The current page still switches even when persistence is unavailable.
        }
        applyTheme(next);
      });
    });
  });
})();