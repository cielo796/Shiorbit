/**
 * Electron メインプロセス。
 *
 * ファイル操作はすべてここで行い、レンダラには IPC 経由でしか触らせない。
 * どのパスも「選ばれた Vault フォルダの中か」を必ず検証してから実行する。
 * これを省くと、レンダラで動く任意のコードが PC 上の全ファイルを読めてしまう。
 */
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { listTree } = require('./listTree.cjs');

const DEV_URL = process.env['SHIORBIT_DEV_URL'] ?? '';
const isDev = DEV_URL !== '';

let mainWindow = null;
let vaultRoot = null;

// --------------------------------------------------------------- 設定の保存

function settingsFile() {
  return path.join(app.getPath('userData'), 'window.json');
}

/** 旧 Obidisan 版のウィンドウ設定。リネーム後も前回の Vault を引き継ぐ。 */
function legacySettingsFiles() {
  const parent = path.dirname(app.getPath('userData'));
  return ['Obidisan', 'obidisan'].map((name) => path.join(parent, name, 'window.json'));
}

async function loadState() {
  for (const file of [settingsFile(), ...legacySettingsFiles()]) {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
      // 現行・旧版の順に探す。どちらにも無ければ既定値を使う。
    }
  }
  return {};
}

async function saveState(patch) {
  const current = await loadState();
  await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
  await fs.writeFile(settingsFile(), JSON.stringify({ ...current, ...patch }, null, 2), 'utf8');
}

// ------------------------------------------------------------- パスの検証

/** Vault の外を指していないか確認する。少しでも外なら例外を投げる。 */
function safePath(target) {
  if (!vaultRoot) throw new Error('Vault が開かれていません');
  const resolved = path.resolve(target);
  const root = path.resolve(vaultRoot);
  const rel = path.relative(root, resolved);
  if (resolved !== root && (rel.startsWith('..') || path.isAbsolute(rel))) {
    throw new Error(`Vault の外は操作できません: ${target}`);
  }
  return resolved;
}

// ----------------------------------------------------------------- ウィンドウ

async function createWindow() {
  const state = await loadState();
  vaultRoot = state.vaultPath ?? null;

  mainWindow = new BrowserWindow({
    width: state.width ?? 1280,
    height: state.height ?? 820,
    minWidth: 480,
    minHeight: 400,
    backgroundColor: '#1b1b1f',
    title: 'Shiorbit',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  if (isDev) {
    await mainWindow.loadURL(DEV_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('close', () => {
    if (!mainWindow) return;
    const [width, height] = mainWindow.getSize();
    void saveState({ width, height });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 外部リンクは既定のブラウザで開く（アプリ内に別ページを読み込ませない）
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ------------------------------------------------------------------- IPC

ipcMain.handle('app:init', async () => ({
  sep: path.sep,
  vaultPath: vaultRoot,
  version: app.getVersion(),
}));

ipcMain.handle('vault:pick', async () => {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    title: 'Vault にするフォルダを選ぶ',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  vaultRoot = result.filePaths[0];
  await saveState({ vaultPath: vaultRoot });
  return vaultRoot;
});

ipcMain.handle('vault:forget', async () => {
  vaultRoot = null;
  await saveState({ vaultPath: null });
});

/**
 * fs のハンドラ。
 *
 * ipcMain.handle の失敗はメッセージだけがレンダラへ渡り、`error.code` は落ちる。
 * それだと「ファイルが無い (ENOENT)」と「本当の入出力エラー」を区別できないので、
 * コードをメッセージの先頭に載せて渡す (受け側は adapters/node.ts が読む)。
 */
function fsHandle(channel, run) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return await run(...args);
    } catch (error) {
      const code = error && error.code ? String(error.code) : 'EIO';
      const message = error && error.message ? String(error.message) : String(error);
      // node のメッセージは既に "ENOENT: ..." で始まることが多い。二重に付けない。
      throw new Error(message.startsWith(`${code}:`) ? message : `${code}: ${message}`);
    }
  });
}

fsHandle('fs:readText', (p) => fs.readFile(safePath(p), 'utf8'));
fsHandle('fs:listTree', (p, withStat = false) => listTree(safePath(p), withStat));

fsHandle('fs:readBytes', async (p) => new Uint8Array(await fs.readFile(safePath(p))));

fsHandle('fs:writeText', (p, text) => fs.writeFile(safePath(p), text, 'utf8'));

fsHandle('fs:writeBytes', (p, data) => fs.writeFile(safePath(p), Buffer.from(data)));

fsHandle('fs:readDir', async (p, withStat = false) => {
  const dir = safePath(p);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const result = entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
  // ファイルごとのIPC往復を廃止。I/Oも16件ずつに制限してイベントループを塞がない。
  if (withStat) for (let at = 0; at < result.length; at += 16) {
    await Promise.all(result.slice(at, at + 16).map(async (entry) => {
      if (entry.isDirectory) return;
      try {
        const stat = await fs.stat(safePath(path.join(dir, entry.name)));
        entry.mtimeMs = stat.mtimeMs;
        entry.size = stat.size;
      } catch { /* 列挙後に消えたファイル等は従来の個別確認に任せる。 */ }
    }));
  }
  return result;
});

fsHandle('fs:stat', async (p) => {
  const st = await fs.stat(safePath(p));
  return { mtimeMs: st.mtimeMs, size: st.size, isDirectory: st.isDirectory() };
});

fsHandle('fs:mkdirp', (p) => fs.mkdir(safePath(p), { recursive: true }));

fsHandle('fs:remove', (p) => fs.rm(safePath(p), { recursive: true, force: true }));

fsHandle('fs:rename', (from, to) => fs.rename(safePath(from), safePath(to)));

// ------------------------------------------------------------------ 起動

// タスクバーでのグループ化と通知の表示名
app.setAppUserModelId('app.shiorbit');

app.whenReady().then(() => {
  void createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
