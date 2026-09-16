import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initDatabase } from './db/database';
import { applyThemeFromCache } from './theme/theme';
import { enableHorizontalWheel } from './core/horizontalWheel';
import './theme/global.css';

async function bootstrap() {
  // 首帧同步应用主题（读 localStorage 缓存），避免刷新闪动
  applyThemeFromCache();
  await initDatabase();
  // 全局：支持 .side-nav 等横向滚动容器响应鼠标滚轮（垂直 → 水平）
  enableHorizontalWheel();
}

bootstrap().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});