// App bootstrap: load state from the main process, wire up tabs and views.

import { state, api, on, saveSettings } from './state.js';
import { $, $$, toast, call } from './lib/dom.js';
import { icon } from './lib/icons.js';
import { initLive } from './views/live.js';
import { initContext } from './views/context.js';
import { initHistory, showHistory, hideHistory } from './views/history.js';
import { initSettings, showSettings } from './views/settings.js';

let current = 'live';

function showView(name, arg) {
  current = name;
  for (const t of $$('.tab')) {
    const on = t.dataset.view === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
  }
  for (const v of $$('.view')) v.classList.toggle('active', v.id === `view-${name}`);
  if (name === 'history') showHistory(arg);
  else hideHistory();
  if (name === 'settings') showSettings();
}

function renderPin() {
  const b = $('#pin-btn');
  const onTop = Boolean(state.settings.window.alwaysOnTop);
  b.innerHTML = icon('pin', 15);
  b.setAttribute('aria-pressed', String(onTop));
  b.title = onTop ? 'On top of other windows (click to turn off)' : 'Keep window on top';
}

async function boot() {
  let init;
  try {
    init = await call(api.init());
  } catch (err) {
    document.body.innerHTML = `<p style="padding:20px">CallCue couldn't start: ${String(err.message)}</p>`;
    return;
  }
  Object.assign(state, {
    settings: init.settings,
    profile: init.profile,
    keys: init.keys,
    providers: init.providers,
    languages: init.languages,
    platform: init.platform,
    version: init.version,
    testMode: init.testMode,
    hotkey: init.hotkey,
  });
  document.body.dataset.platform = init.platform;

  initLive();
  initContext();
  initHistory();
  initSettings();

  for (const t of $$('.tab')) t.addEventListener('click', () => showView(t.dataset.view));
  on('navigate', (name) => showView(name));
  on('open-session', (id) => showView('history', id));

  renderPin();
  on('settings', renderPin);
  $('#pin-btn').addEventListener('click', () => {
    saveSettings({ window: { alwaysOnTop: !state.settings.window.alwaysOnTop } }).catch((err) => toast(err.message, { kind: 'error' }));
  });

  // Dropping a file on the window should do nothing rather than open it.
  for (const evt of ['dragover', 'drop']) {
    document.addEventListener(evt, (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.shiftKey && !e.altKey && ['1', '2', '3', '4'].includes(e.key)) {
      e.preventDefault();
      showView(['live', 'context', 'history', 'settings'][Number(e.key) - 1]);
    }
  });

  if (!state.settings.onboarded) {
    saveSettings({ onboarded: true }).catch(() => {});
  }
}

boot();

export { showView, current };
