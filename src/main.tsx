import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// 拖放：文件由 Rust 窗口级 DragDrop 事件接收（真实路径，见 webviewdrop.rs / lib.rs）。
// 这里只兜住 drop 默认行为，避免 WebView2 把它当导航把页面带走（不影响宿主接收拖放）。
window.addEventListener('drop', (e) => e.preventDefault(), false);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
