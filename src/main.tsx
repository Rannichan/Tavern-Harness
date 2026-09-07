import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initDatabase } from './db/database';
import { enableHorizontalWheel } from './core/horizontalWheel';
import './theme/global.css';

async function bootstrap() {
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