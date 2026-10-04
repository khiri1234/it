const { app, BrowserWindow, Menu, shell, session } = require('electron');
const path = require('path');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'THE H BUSINESS MANAGEMENT',
    backgroundColor: '#0b1220',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'));

  // The app uses window.open() only for wa.me and paypal.me links — send those
  // to the system browser instead of opening a second Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [{ type: 'separator' }, { role: 'front' }] : [{ role: 'close' }])
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Press-and-hold (or right-click) the Dock icon to jump straight to a section,
// without having to bring the window forward and click through the sidebar first.
function sendDockNavigate(section) {
  if (!mainWindow) {
    createWindow();
    mainWindow.webContents.once('did-finish-load', () => mainWindow.webContents.send('dock-navigate', section));
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('dock-navigate', section);
}

function buildDockMenu() {
  if (process.platform !== 'darwin') return;
  app.dock.setMenu(Menu.buildFromTemplate([
    { label: 'Dashboard', click: () => sendDockNavigate('dashboard') },
    { label: 'Apple Store', click: () => sendDockNavigate('iphone-orders') },
    { label: 'Invoices', click: () => sendDockNavigate('invoices') },
    { label: 'Purchases', click: () => sendDockNavigate('purchases') },
    { label: 'Projects', click: () => sendDockNavigate('projects') }
  ]));
}

app.whenReady().then(() => {
  // The barcode/QR scanner feature needs the camera; nothing else in the app
  // asks for a permission, so allow media and deny everything else.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'media');
  });

  buildMenu();
  buildDockMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
