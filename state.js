// Shared app state and a tiny event bus between views.

import { call } from './lib/dom.js';

export const api = window.callcue;

export const state = {
  settings: null,
  profile: null,
  keys: null,
  providers: [],
  languages: [],
  platform: '',
  version: '',
  testMode: false,
  hotkey: 'Ctrl+Shift+Enter',
  notesPending: new Set(), // session ids whose notes are being written
};

const bus = new EventTarget();

export function emit(name, detail) {
  bus.dispatchEvent(new CustomEvent(name, { detail }));
}

export function on(name, fn) {
  const h = (e) => fn(e.detail);
  bus.addEventListener(name, h);
  return () => bus.removeEventListener(name, h);
}

export function providerById(id) {
  return state.providers.find((p) => p.id === id) || null;
}

// Providers the current settings rely on that have no API key yet.
export function missingKeys() {
  const need = new Set([state.settings.transcription.provider, state.settings.answers.provider]);
  return [...need].filter((id) => !(state.keys[id] && state.keys[id].set)).map((id) => providerById(id)).filter(Boolean);
}

export async function saveSettings(patch) {
  state.settings = await call(api.setSettings(patch));
  emit('settings', state.settings);
  return state.settings;
}

export async function saveProfile(patch) {
  state.profile = await call(api.setProfile(patch));
  emit('profile', state.profile);
  return state.profile;
}

// Write notes for a finished session and save them with it.
export async function writeNotes(session) {
  state.notesPending.add(session.id);
  emit('notes-status', { id: session.id, pending: true });
  try {
    const notes = await call(api.generateNotes({ transcript: session.transcript, mode: session.mode, context: session.context }));
    session.notes = notes;
    if (notes.title) session.title = notes.title;
    await call(api.saveSession(session));
    return notes;
  } finally {
    state.notesPending.delete(session.id);
    emit('notes-status', { id: session.id, pending: false });
    emit('sessions-changed');
  }
}
