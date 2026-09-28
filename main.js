'use strict';

const path = require('path');
const fs = require('fs');
const {
  app,
  BrowserWindow,
  ipcMain,
  session,
  desktopCapturer,
  dialog,
  shell,
  globalShortcut,
  clipboard,
  safeStorage,
  Menu,
  nativeTheme,
} = require('electron');

const { Store } = require('./store');
const { SessionStore, toMarkdown, defaultTitle } = require('./sessions');
const providers = require('./providers');
const prompts = require('./prompts');
const { LANGUAGES } = require('./languages');
const { extractText } = require('./docs');
const { generateNotes } = require('./notes');

const TEST_MODE = process.env.CALLCUE_TEST === '1';
const ANSWER_HOTKEY = 'CommandOrControl+Shift+Enter';

if (process.env.CALLCUE_USER_DATA) {
  app.setPath('userData', path.resolve(process.env.CALLCUE_USER_DATA));
}
if (TEST_MODE) {
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  if (process.env.CALLCUE_FAKE_MIC) {
    app.commandLine.appendSwitch('use-file-for-fake-audio-capture', path.resolve(process.env.CALLCUE_FAKE_MIC));
  }
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;
let closeTimer = null;
let store = null;
let sessions = null;
const activeRequests = new Map();

const ALLOWED_EXTERNAL_HOSTS = new Set([
  'console.groq.com',
  'platform.openai.com',
  'console.anthropic.com',
  'aistudio.google.com',
  'console.deepgram.com',
]);

function createWindow() {
  const s = store.getSettings();
  const dark = nativeTheme.shouldUseDarkColors;
  win = new BrowserWindow({
    width: 460,
    height: 780,
    minWidth: 380,
    minHeight: 520,
    title: 'CallCue',
    show: false,
    backgroundColor: dark ? '#0e1116' : '#f6f7f9',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: dark ? '#0e1116' : '#f6f7f9',
      symbolColor: dark ? '#c9d1d9' : '#3b4350',
      height: 38,
    },
    alwaysOnTop: Boolean(s.window.alwaysOnTop),
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !app.isPackaged || TEST_MODE,
    },
  });
  win.setOpacity(s.window.opacity);
  const indexFile = path.join(__dirname, '..', 'renderer', 'index.html');
  win.loadFile(indexFile);
  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });
  // The app is a single page; never navigate away (e.g. a file dropped on it).
  const appUrl = require('url').pathToFileURL(indexFile).href;
  win.webContents.on('will-navigate', (e, url) => {
    if (url.split('#')[0] !== appUrl) e.preventDefault();
  });
  // Give the page a moment to save a call that is still running.
  let closing = false;
  win.on('close', (e) => {
    if (closing || win.webContents.isDestroyed()) return;
    e.preventDefault();
    closing = true;
    win.webContents.send('app:closing');
    closeTimer = setTimeout(() => {
      if (win && !win.isDestroyed()) win.destroy();
    }, 3000);
  });
  win.on('closed', () => {
    win = null;
  });

  nativeTheme.on('updated', () => {
    if (!win) return;
    const d = nativeTheme.shouldUseDarkColors;
    try {
      win.setTitleBarOverlay({ color: d ? '#0e1116' : '#f6f7f9', symbolColor: d ? '#c9d1d9' : '#3b4350' });
    } catch {}
  });
}

function openExternalSafe(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && ALLOWED_EXTERNAL_HOSTS.has(u.hostname)) {
      shell.openExternal(u.toString());
      return true;
    }
  } catch {}
  return false;
}

function setupMediaHandlers() {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((wc, permission, callback) => {
    callback(['media', 'display-capture', 'clipboard-sanitized-write'].includes(permission));
  });
  ses.setPermissionCheckHandler((wc, permission) => ['media', 'display-capture', 'clipboard-sanitized-write'].includes(permission));

  // getDisplayMedia() in the renderer lands here. On Windows we hand back the
  // primary screen plus 'loopback' audio, which is what the speakers play:
  // the other people on the call. The video track is dropped in the renderer.
  ses.setDisplayMediaRequestHandler(
    (request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => {
          if (!sources.length) return callback({});
          if (process.platform === 'win32') callback({ video: sources[0], audio: 'loopback' });
          else callback({ video: sources[0] });
        })
        .catch(() => callback({}));
    },
    { useSystemPicker: false },
  );
}

// Wrap IPC handlers so the renderer always gets {ok, data} or {ok:false, error}.
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!win || event.sender !== win.webContents) return { ok: false, error: 'Not allowed' };
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err), name: err && err.name };
    }
  });
}

const getKey = (id) => store.getKey(id);

function registerIpc() {
  handle('app:init', () => ({
    settings: store.getSettings(),
    profile: store.getProfile(),
    keys: store.keyStatus(),
    providers: providers.publicRegistry(),
    languages: LANGUAGES,
    platform: process.platform,
    version: app.getVersion(),
    testMode: TEST_MODE,
    hotkey: 'Ctrl+Shift+Enter',
  }));

  handle('settings:set', (patch) => {
    const s = store.setSettings(patch);
    if (win) {
      win.setAlwaysOnTop(Boolean(s.window.alwaysOnTop));
      win.setOpacity(s.window.opacity);
    }
    return s;
  });

  handle('profile:set', (patch) => store.setProfile(patch));

  handle('keys:set', async ({ provider, key }) => {
    store.setKey(provider, key);
    let test = null;
    if (key && String(key).trim()) {
      try {
        await providers.testKey(provider, String(key).trim());
        test = { ok: true };
      } catch (err) {
        test = { ok: false, error: err.message };
      }
    }
    return { keys: store.keyStatus(), test };
  });

  handle('models:list', ({ provider, kind }) => providers.listModels(provider, kind, getKey));

  handle('file:importText', async () => {
    if (TEST_MODE && process.env.CALLCUE_TEST_IMPORT) {
      const file = path.resolve(process.env.CALLCUE_TEST_IMPORT);
      return { text: await extractText(file), name: path.basename(file) };
    }
    const res = await dialog.showOpenDialog(win, {
      title: 'Import a file',
      properties: ['openFile'],
      filters: [
        { name: 'Documents', extensions: ['pdf', 'docx', 'txt', 'md', 'rtf'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const text = await extractText(res.filePaths[0]);
    if (!text) throw new Error('No text found in that file. If it is a scanned PDF, paste the text instead.');
    return { text, name: path.basename(res.filePaths[0]) };
  });

  handle('stt:transcribe', async ({ wav, prompt }) => {
    const s = store.getSettings();
    const buf = Buffer.from(wav);
    if (buf.length < 44 || buf.length > 24 * 1024 * 1024) throw new Error('Audio clip has an invalid size.');
    const text = await providers.transcribe(
      {
        providerId: s.transcription.provider,
        model: s.transcription.model,
        wav: buf,
        language: s.transcription.language,
        prompt: typeof prompt === 'string' ? prompt.slice(0, 600) : '',
      },
      getKey,
    );
    return { text };
  });

  handle('chat:answer', async ({ requestId, question, typed, transcript, auto }) => {
    const s = store.getSettings();
    const profile = store.getProfile();
    const ctl = new AbortController();
    activeRequests.set(requestId, ctl);
    const send = (delta) => {
      if (win && !win.isDestroyed()) win.webContents.send('chat:delta', { requestId, delta });
    };
    // Hold back the first few characters of auto answers so a bare "SKIP"
    // never flashes on screen.
    let head = '';
    let released = !auto;
    const onDelta = (d) => {
      if (released) return send(d);
      head += d;
      const norm = head.replace(/\*/g, '').trimStart().toUpperCase();
      if (norm.length < 6 && 'SKIP.'.startsWith(norm)) return;
      released = true;
      send(head);
    };
    try {
      const system = prompts.buildAnswerSystem(profile, { auto: Boolean(auto) });
      const messages = prompts.buildAnswerMessages({ transcript, question, typed: Boolean(typed) });
      const text = await providers.chatStream(
        {
          providerId: s.answers.provider,
          model: s.answers.model,
          system,
          messages,
          maxTokens: prompts.MAX_TOKENS[profile.answerLength] || 500,
          thinking: s.answers.thinking,
          signal: ctl.signal,
        },
        getKey,
        onDelta,
      );
      if (!released) {
        if (prompts.isSkip(head) || !head.trim()) return { text: '', skipped: true };
        send(head);
      }
      return { text, skipped: false, provider: s.answers.provider, model: s.answers.model };
    } finally {
      activeRequests.delete(requestId);
    }
  });

  handle('chat:abort', (requestId) => {
    const ctl = activeRequests.get(requestId);
    if (ctl) ctl.abort();
    return true;
  });

  handle('notes:generate', ({ transcript, mode, context }) =>
    generateNotes({ transcript, mode, context, settings: store.getSettings(), profile: store.getProfile(), chatStream: providers.chatStream, getKey }),
  );

  handle('sessions:list', () => sessions.list());
  handle('sessions:get', (id) => sessions.get(id));
  handle('sessions:save', (data) => sessions.save(data));
  handle('sessions:delete', (id) => sessions.delete(id));
  handle('sessions:export', async (id) => {
    const data = sessions.get(id);
    if (!data) throw new Error('Session not found.');
    const title = (data.title || (data.notes && data.notes.title) || defaultTitle(data)).replace(/[\\/:*?"<>|]+/g, '').slice(0, 80);
    const date = (data.startedAt || '').slice(0, 10);
    const res = await dialog.showSaveDialog(win, {
      title: 'Export notes',
      defaultPath: path.join(app.getPath('documents'), `${title}${date ? ' ' + date : ''}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (res.canceled || !res.filePath) return null;
    fs.writeFileSync(res.filePath, toMarkdown(data), 'utf8');
    return res.filePath;
  });

  handle('app:closeReady', () => {
    clearTimeout(closeTimer);
    setImmediate(() => {
      if (win && !win.isDestroyed()) win.destroy();
    });
    return true;
  });

  handle('app:openDataFolder', () => shell.openPath(app.getPath('userData')));
  handle('app:openExternal', (url) => openExternalSafe(url));
  handle('app:copy', (text) => {
    clipboard.writeText(String(text || ''));
    return true;
  });

  handle('hotkeys:set', ({ active }) => {
    globalShortcut.unregister(ANSWER_HOTKEY);
    if (active) {
      return globalShortcut.register(ANSWER_HOTKEY, () => {
        if (win && !win.isDestroyed()) win.webContents.send('hotkey', 'answer');
      });
    }
    return true;
  });

  handle('test:audio', () => {
    if (!TEST_MODE || !process.env.CALLCUE_FAKE_THEM) return null;
    return fs.readFileSync(path.resolve(process.env.CALLCUE_FAKE_THEM));
  });
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.callcue.app');
  store = new Store(app.getPath('userData'), safeStorage);
  sessions = new SessionStore(path.join(app.getPath('userData'), 'sessions'));
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
  } else {
    Menu.setApplicationMenu(null);
  }
  setupMediaHandlers();
  registerIpc();
  createWindow();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  app.quit();
});
