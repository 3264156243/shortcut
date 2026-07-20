const { app, BrowserWindow } = require('electron');

console.log('Electron starting...');
console.log('App:', app);

app.whenReady().then(() => {
  console.log('App ready, creating window...');
  const win = new BrowserWindow({ width: 800, height: 600 });
  win.loadURL('data:text/html,<h1>Hello ShortCut!</h1>');
  console.log('Window created!');
});

app.on('window-all-closed', () => {
  console.log('All windows closed');
  app.quit();
});
