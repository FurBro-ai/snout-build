const { app, BrowserWindow, desktopCapturer, dialog, session } = require('electron');

const APP_URL = process.env.SNOUT_DESKTOP_URL || 'https://snout.cloud';
const TRUSTED_ORIGIN = new URL(APP_URL).origin;

function isTrustedUrl(value) {
  try {
    return new URL(value).origin === TRUSTED_ORIGIN;
  } catch {
    return false;
  }
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#0d0f12',
    title: 'Snout',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());

  await window.loadURL(APP_URL);
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const allowed = isTrustedUrl(details.requestingUrl) && ['media', 'display-capture'].includes(permission);
    callback(allowed);
  });

  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], fetchWindowIcons: true });
    if (sources.length === 0) {
      callback({});
      return;
    }
    const selected = await dialog.showMessageBox({
      type: 'question',
      title: 'Share your screen',
      message: 'Choose a screen or window to share with this Snout call.',
      buttons: [...sources.map((source) => source.name), 'Cancel'],
      cancelId: sources.length,
      noLink: true,
    });
    if (selected.response >= sources.length) {
      callback({});
      return;
    }
    callback({ video: sources[selected.response] });
  });

  void createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});