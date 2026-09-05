import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initDatabase } from './db/database';
import './theme/global.css';

async function bootstrap() {
  await initDatabase();
}

bootstrap().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});