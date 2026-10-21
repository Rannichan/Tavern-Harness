import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyThemeFromCache } from './theme/theme';
import { enableHorizontalWheel } from './core/horizontalWheel';
import { initMobileViewport } from './core/mobileViewport';
import { installWeChatTouchSelectionGuard } from './core/wechatTouch';
import './theme/global.css';

// 在数据层完成异步初始化前先挂载 React。App 会立即显示壳层和启动状态，
// 避免 IndexedDB / 持久化服务较慢时出现无内容的空白页。
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

try {
  // 首帧同步应用主题（读 localStorage 缓存），避免刷新闪动
  applyThemeFromCache();
  // 移动端视口高度控制：吸收键盘开合时地址栏/底部工具栏的两段式变化
  initMobileViewport();
  // 微信 Android 的长按由原生层接管：兜底阻止系统选词、清掉残留选区
  installWeChatTouchSelectionGuard();
  // 全局：支持 .side-nav 等横向滚动容器响应鼠标滚轮（垂直 → 水平）
  enableHorizontalWheel();
} catch (error) {
  // 非核心的浏览器增强失败不能阻止应用及其初始化错误界面出现。
  console.error('Failed to configure Tavern Harness browser enhancements', error);
}
