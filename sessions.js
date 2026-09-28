'use strict';
// Saved call sessions: one JSON file per session in <userData>/sessions.

const fs = require('fs');
const path = require('path');
const { writeJsonAtomic, readJson } = require('./store');

const ID_RE = /^[a-z0-9-]{6,64}$/i;

class SessionStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  fileFor(id) {
    if (!ID_RE.test(String(id))) throw new Error('Invalid session id');
    return path.join(this.dir, `${id}.json`);
  }

  save(session) {
    if (!session || !ID_RE.test(String(session.id))) throw new Error('Invalid session');
    const clean = sanitizeSession(session);
    writeJsonAtomic(this.fileFor(clean.id), clean);
    return summarize(clean);
  }

  get(id) {
    const data = readJson(this.fileFor(id), null);
    return data ? sanitizeSession(data) : null;
  }

  delete(id) {
    try {
      fs.unlinkSync(this.fileFor(id));
      return true;
    } catch {
      return false;
    }
  }

  list() {
    let files = [];
    try {
      files = fs.readdirSync(this.dir).filter((f) => f.endsWith('.json'));
    } catch {
      return [];
    }
    const items = [];
    for (const f of files) {
      const data = readJson(path.join(this.dir, f), null);
      if (data && data.id) items.push(summarize(sanitizeSession(data)));
    }
    items.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
    return items;
  }
}

function str(v, max = 200000) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function strList(v, maxItems = 50) {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, maxItems).map((x) => x.slice(0, 2000)) : [];
}

function sanitizeNotes(n) {
  if (!n || typeof n !== 'object') return null;
  return {
    title: str(n.title, 200),
    summary: str(n.summary, 8000),
    keyPoints: strList(n.keyPoints),
    actionItems: strList(n.actionItems),
    decisions: strList(n.decisions),
    questionsAsked: strList(n.questionsAsked),
    improvementTips: strList(n.improvementTips),
  };
}

function sanitizeSession(s) {
  const transcript = Array.isArray(s.transcript) ? s.transcript : [];
  const answers = Array.isArray(s.answers) ? s.answers : [];
  return {
    id: String(s.id),
    title: str(s.title, 200),
    mode: ['interview', 'sales', 'meeting', 'general'].includes(s.mode) ? s.mode : 'general',
    startedAt: str(s.startedAt, 40),
    endedAt: str(s.endedAt, 40),
    context: {
      role: str(s.context && s.context.role, 200),
      company: str(s.context && s.context.company, 200),
    },
    transcript: transcript
      .filter((t) => t && typeof t.text === 'string' && t.text.trim())
      .map((t) => ({
        speaker: t.speaker === 'you' ? 'you' : 'them',
        text: t.text.slice(0, 5000),
        t: Number.isFinite(t.t) ? t.t : 0,
      })),
    answers: answers
      .filter((a) => a && typeof a.answer === 'string' && a.answer.trim())
      .map((a) => ({
        question: str(a.question, 5000),
        answer: a.answer.slice(0, 20000),
        t: Number.isFinite(a.t) ? a.t : 0,
        provider: str(a.provider, 40),
        model: str(a.model, 120),
      })),
    notes: sanitizeNotes(s.notes),
  };
}

function summarize(s) {
  return {
    id: s.id,
    title: s.title || (s.notes && s.notes.title) || defaultTitle(s),
    mode: s.mode,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    lines: s.transcript.length,
    answers: s.answers.length,
    hasNotes: Boolean(s.notes && (s.notes.summary || s.notes.keyPoints.length)),
  };
}

function defaultTitle(s) {
  const label = { interview: 'Interview', sales: 'Sales call', meeting: 'Meeting', general: 'Call' }[s.mode] || 'Call';
  const who = [s.context.role, s.context.company].filter(Boolean).join(' · ');
  return who ? `${label}: ${who}` : label;
}

function fmtClock(ms) {
  const total = Math.max(0, Math.round((ms || 0) / 1000));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function toMarkdown(session) {
  const s = sanitizeSession(session);
  const lines = [];
  const title = s.title || (s.notes && s.notes.title) || defaultTitle(s);
  lines.push(`# ${title}`, '');
  const started = s.startedAt ? new Date(s.startedAt) : null;
  const ended = s.endedAt ? new Date(s.endedAt) : null;
  if (started && !isNaN(started)) {
    let meta = `**Date:** ${started.toLocaleString()}`;
    if (ended && !isNaN(ended)) meta += `  \n**Duration:** ${fmtClock(ended - started)}`;
    lines.push(meta, '');
  }
  const n = s.notes;
  if (n) {
    if (n.summary) lines.push('## Summary', '', n.summary, '');
    const section = (name, items) => {
      if (items && items.length) lines.push(`## ${name}`, '', ...items.map((x) => `- ${x}`), '');
    };
    section('Key points', n.keyPoints);
    section('Questions asked', n.questionsAsked);
    section('Decisions', n.decisions);
    section('Action items', n.actionItems);
    section('Tips for next time', n.improvementTips);
  }
  if (s.answers.length) {
    lines.push('## Suggested answers', '');
    for (const a of s.answers) {
      lines.push(`**[${fmtClock(a.t)}] ${a.question || 'Question'}**`, '', a.answer, '');
    }
  }
  if (s.transcript.length) {
    lines.push('## Transcript', '');
    for (const t of s.transcript) {
      lines.push(`[${fmtClock(t.t)}] **${t.speaker === 'you' ? 'You' : 'Them'}:** ${t.text}  `);
    }
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = { SessionStore, sanitizeSession, summarize, toMarkdown, fmtClock, defaultTitle };
