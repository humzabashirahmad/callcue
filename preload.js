'use strict';
// The only bridge between the page and the main process. The page never sees
// API keys or Node APIs; it asks the main process to do the work.

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('callcue', {
  init: () => invoke('app:init'),
  setSettings: (patch) => invoke('settings:set', patch),
  setProfile: (patch) => invoke('profile:set', patch),
  setKey: (provider, key) => invoke('keys:set', { provider, key }),
  listModels: (provider, kind) => invoke('models:list', { provider, kind }),
  importText: () => invoke('file:importText'),
  transcribe: (wav, prompt) => invoke('stt:transcribe', { wav, prompt }),
  answer: (req) => invoke('chat:answer', req),
  abortAnswer: (requestId) => invoke('chat:abort', requestId),
  generateNotes: (req) => invoke('notes:generate', req),
  listSessions: () => invoke('sessions:list'),
  getSession: (id) => invoke('sessions:get', id),
  saveSession: (data) => invoke('sessions:save', data),
  deleteSession: (id) => invoke('sessions:delete', id),
  exportSession: (id) => invoke('sessions:export', id),
  openDataFolder: () => invoke('app:openDataFolder'),
  openExternal: (url) => invoke('app:openExternal', url),
  copy: (text) => invoke('app:copy', text),
  setHotkeys: (active) => invoke('hotkeys:set', { active }),
  testAudio: () => invoke('test:audio'),
  closeReady: () => invoke('app:closeReady'),
  onClosing: (fn) => {
    const listener = () => fn();
    ipcRenderer.on('app:closing', listener);
    return () => ipcRenderer.removeListener('app:closing', listener);
  },
  onDelta: (fn) => {
    const listener = (_e, msg) => fn(msg);
    ipcRenderer.on('chat:delta', listener);
    return () => ipcRenderer.removeListener('chat:delta', listener);
  },
  onHotkey: (fn) => {
    const listener = (_e, name) => fn(name);
    ipcRenderer.on('hotkey', listener);
    return () => ipcRenderer.removeListener('hotkey', listener);
  },
});
