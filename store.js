'use strict';
// Settings, profile and API-key storage. Everything lives in the app's
// userData folder as JSON. API keys are encrypted with Electron's safeStorage
// (DPAPI on Windows) whenever the OS supports it.

const fs = require('fs');
const path = require('path');

const PROVIDER_IDS = ['openai', 'anthropic', 'gemini', 'groq', 'deepgram'];

const DEFAULT_SETTINGS = {
  version: 1,
  transcription: { provider: 'groq', model: 'whisper-large-v3-turbo', language: 'auto' },
  answers: { provider: 'groq', model: 'openai/gpt-oss-120b', thinking: 'off' },
  autoAnswer: true,
  audio: {
    captureMic: true,
    micDeviceId: 'default',
    endSilenceMs: 800,
    sensitivity: 0.5,
    maxUtteranceSec: 15,
  },
  window: { alwaysOnTop: true, opacity: 1 },
  onboarded: false,
};

const DEFAULT_PROFILE = {
  mode: 'interview', // interview | sales | meeting | general
  name: '',
  role: '',
  company: '',
  jobDescription: '',
  resume: '',
  instructions: '',
  answerLength: 'medium', // short | medium | long
  answerStyle: 'bullets', // bullets | script
  answerLanguage: 'auto',
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Deep-merge `patch` into `base`, returning a new object. Only keys that exist
// in `shape` are kept, so stale or unknown keys never leak into the files.
function mergeKnown(shape, base, patch) {
  const out = {};
  for (const key of Object.keys(shape)) {
    const s = shape[key];
    const b = base ? base[key] : undefined;
    const p = patch ? patch[key] : undefined;
    if (isPlainObject(s)) {
      out[key] = mergeKnown(s, isPlainObject(b) ? b : s, isPlainObject(p) ? p : undefined);
    } else if (p !== undefined && (typeof p === typeof s || s === null)) {
      out[key] = p;
    } else if (b !== undefined && (typeof b === typeof s || s === null)) {
      out[key] = b;
    } else {
      out[key] = s;
    }
  }
  return out;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

class Store {
  /**
   * @param {string} dir  folder to keep the JSON files in
   * @param {{isEncryptionAvailable():boolean, encryptString(s:string):Buffer, decryptString(b:Buffer):string}|null} crypto
   */
  constructor(dir, crypto) {
    this.dir = dir;
    this.crypto = crypto || null;
    this.settingsFile = path.join(dir, 'settings.json');
    this.profileFile = path.join(dir, 'profile.json');
    this.keysFile = path.join(dir, 'keys.json');
    this.settings = mergeKnown(DEFAULT_SETTINGS, readJson(this.settingsFile, {}), undefined);
    this.profile = mergeKnown(DEFAULT_PROFILE, readJson(this.profileFile, {}), undefined);
    this.keys = readJson(this.keysFile, {});
  }

  getSettings() {
    return JSON.parse(JSON.stringify(this.settings));
  }

  setSettings(patch) {
    this.settings = mergeKnown(DEFAULT_SETTINGS, this.settings, patch || {});
    this.settings.audio.endSilenceMs = clamp(this.settings.audio.endSilenceMs, 300, 3000);
    this.settings.audio.sensitivity = clamp(this.settings.audio.sensitivity, 0, 1);
    this.settings.audio.maxUtteranceSec = clamp(this.settings.audio.maxUtteranceSec, 5, 60);
    this.settings.window.opacity = clamp(this.settings.window.opacity, 0.4, 1);
    writeJsonAtomic(this.settingsFile, this.settings);
    return this.getSettings();
  }

  getProfile() {
    return { ...this.profile };
  }

  setProfile(patch) {
    this.profile = mergeKnown(DEFAULT_PROFILE, this.profile, patch || {});
    writeJsonAtomic(this.profileFile, this.profile);
    return this.getProfile();
  }

  canEncrypt() {
    try {
      return Boolean(this.crypto && this.crypto.isEncryptionAvailable());
    } catch {
      return false;
    }
  }

  setKey(provider, key) {
    if (!PROVIDER_IDS.includes(provider)) throw new Error(`Unknown provider: ${provider}`);
    const value = String(key || '').trim();
    if (!value) {
      delete this.keys[provider];
    } else if (this.canEncrypt()) {
      this.keys[provider] = 'enc:' + this.crypto.encryptString(value).toString('base64');
    } else {
      this.keys[provider] = 'plain:' + Buffer.from(value, 'utf8').toString('base64');
    }
    writeJsonAtomic(this.keysFile, this.keys);
  }

  getKey(provider) {
    const stored = this.keys[provider];
    if (!stored || typeof stored !== 'string') return '';
    try {
      if (stored.startsWith('enc:')) {
        if (!this.canEncrypt()) return '';
        return this.crypto.decryptString(Buffer.from(stored.slice(4), 'base64'));
      }
      if (stored.startsWith('plain:')) {
        return Buffer.from(stored.slice(6), 'base64').toString('utf8');
      }
    } catch {
      return '';
    }
    return '';
  }

  // Safe summary for the UI: never returns the full key.
  keyStatus() {
    const out = {};
    for (const id of PROVIDER_IDS) {
      const key = this.getKey(id);
      out[id] = key ? { set: true, hint: maskKey(key) } : { set: false, hint: '' };
    }
    out.encrypted = this.canEncrypt();
    return out;
  }
}

function maskKey(key) {
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

function clamp(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

module.exports = { Store, DEFAULT_SETTINGS, DEFAULT_PROFILE, PROVIDER_IDS, mergeKnown, writeJsonAtomic, readJson, maskKey };
