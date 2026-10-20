import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initDatabase } from './db/database';
import { applyThemeFromCache } from './theme/theme';
import { enableHorizontalWheel } from './core/horizontalWheel';
import { initMobileViewport } from './core/mobileViewport';
import { installWeChatTouchSelectionGuard } from './core/wechatTouch';
import './theme/global.css';

let appRendered = false;

async function bootstrap() {
  // 首帧同步应用主题（读 localStorage 缓存），避免刷新闪动
  applyThemeFromCache();
  // 移动端视口高度控制：吸收键盘开合时地址栏/底部工具栏的两段式变化
  initMobileViewport();
  // 微信 Android 的长按由原生层接管：兜底阻止系统选词、清掉残留选区
  installWeChatTouchSelectionGuard();
  await initDatabase();
  // 全局：支持 .side-nav 等横向滚动容器响应鼠标滚轮（垂直 → 水平）
  enableHorizontalWheel();
}

function renderApp() {
  // bootstrap 失败时也渲染 App，由 store 的 init 错误页接管；这里保证只渲染一次。
  if (appRendered) return;
  appRendered = true;
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

bootstrap().then(renderApp).catch((error: unknown) => {
  console.error('Failed to start Tavern Harness', error);
  renderApp();
});
