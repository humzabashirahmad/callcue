'use strict';
// Prompt construction for live answers and post-call notes.

const { languageName } = require('./languages');

const MODE_LABEL = {
  interview: 'job interview',
  sales: 'sales call',
  meeting: 'meeting',
  general: 'conversation',
};

const MODE_RULES = {
  interview:
    'This is a job interview and the user is the candidate. When the interviewer asks a question, answer as the candidate. ' +
    'For behavioral questions ("tell me about a time..."), use a compact STAR shape (situation, action, result) with a real example from the resume. ' +
    'If they ask whether the user has questions, suggest 2-3 thoughtful questions about the role, team or company.',
  sales:
    'This is a sales call and the user is the seller. Help them answer the prospect\'s questions, handle objections with empathy and evidence, and move toward a clear next step. ' +
    'Suggest a discovery question when it helps. Use only product facts from the notes; never promise features, prices or terms that are not in them.',
  meeting:
    'This is a work meeting or client call. Help the user respond clearly: answer questions, state their position, propose next steps, or ask a useful clarifying question.',
  general: 'Help the user respond well to whatever the other person just said.',
};

const LENGTH_RULES = {
  short: 'Keep it under 60 words.',
  medium: 'Keep it to roughly 80-130 words.',
  long: 'Use up to about 220 words.',
};

const STYLE_RULES = {
  bullets:
    'Format: one bold opening sentence (markdown **like this**) that directly answers, then 2-4 short "- " bullet points with the specifics to mention. Keep each bullet under 15 words.',
  script:
    'Format: a natural spoken answer in 1-3 short paragraphs the user can read aloud as-is. Bold (markdown **like this**) the single most important phrase.',
};

const MAX_TOKENS = { short: 300, medium: 500, long: 900 };

function clip(text, max) {
  const s = String(text || '').trim();
  return s.length > max ? s.slice(0, max) + '\n[...]' : s;
}

function languageRule(code) {
  const name = languageName(code);
  if (!code || code === 'auto' || !name) return 'Reply in the same language the other person is speaking.';
  return `Always reply in ${name}.`;
}

function buildAnswerSystem(profile, { auto }) {
  const p = profile || {};
  const mode = MODE_RULES[p.mode] ? p.mode : 'general';
  const lines = [
    `You are CallCue, a real-time assistant helping the user during a live ${MODE_LABEL[mode]}. You read the live transcript and suggest what the user can say next.`,
    'In the transcript, "Them" is the other side and "You" is the user.',
    p.name ? `The user's name is ${clip(p.name, 80)}.` : '',
    '',
    MODE_RULES[mode],
    '',
    'Rules:',
    '- Write in first person, as words the user can say out loud right away. Natural and confident. No filler such as "Great question".',
    '- Ground every claim in the resume and notes below. Never invent employers, job titles, degrees, dates, numbers or projects that are not there. If the background does not cover something, give an honest answer (related experience, how you would approach it, willingness to learn) instead of making things up.',
    `- ${LENGTH_RULES[p.answerLength] || LENGTH_RULES.medium}`,
    `- ${STYLE_RULES[p.answerStyle] || STYLE_RULES.bullets}`,
    '- For technical questions, lead with the core idea, then the key details. Include a short code block only when they ask you to write code.',
    `- ${languageRule(p.answerLanguage)}`,
    '- Output only the suggested answer: no headings, no preamble, no commentary about the transcript.',
  ];
  if (auto) {
    lines.push(
      '- If the latest words from Them are not a question or a request for the user to respond (for example small talk, an acknowledgement such as "okay" or "great", or an unfinished sentence), reply with exactly SKIP and nothing else.',
    );
  }
  const ctx = [];
  if (p.role) ctx.push(`<role>${clip(p.role, 300)}</role>`);
  if (p.company) ctx.push(`<company>${clip(p.company, 300)}</company>`);
  if (p.jobDescription) ctx.push(`<job_description>\n${clip(p.jobDescription, 12000)}\n</job_description>`);
  if (p.resume) ctx.push(`<resume>\n${clip(p.resume, 20000)}\n</resume>`);
  if (p.instructions) ctx.push(`<user_notes_and_instructions>\n${clip(p.instructions, 8000)}\n</user_notes_and_instructions>`);
  if (ctx.length) {
    lines.push('', 'Background about the user and this call:', ...ctx);
  } else {
    lines.push('', 'No resume or background was provided, so keep answers general and honest, and never invent personal details.');
  }
  return lines.filter((l, i, arr) => !(l === '' && arr[i - 1] === '')).join('\n');
}

function fmtClock(ms) {
  const total = Math.max(0, Math.round((ms || 0) / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function transcriptText(transcript, { maxLines = 40, maxChars = 9000 } = {}) {
  const rows = (Array.isArray(transcript) ? transcript : [])
    .filter((t) => t && typeof t.text === 'string' && t.text.trim())
    .map((t) => `[${fmtClock(t.t)}] ${t.speaker === 'you' ? 'You' : 'Them'}: ${t.text.trim()}`);
  let picked = rows.slice(-maxLines);
  while (picked.length > 1 && picked.join('\n').length > maxChars) picked = picked.slice(1);
  return picked.join('\n');
}

function buildAnswerMessages({ transcript, question, typed }) {
  // Recent context only: keeps requests small enough for free-tier limits.
  const convo = transcriptText(transcript, { maxLines: 30, maxChars: 6000 });
  const parts = [];
  parts.push(convo ? `Live transcript (oldest first):\n${convo}` : 'The call has just started; there is no transcript yet.');
  if (question && question.trim()) {
    parts.push(typed ? `The question I need to answer: "${clip(question, 2000)}"` : `The latest from Them: "${clip(question, 2000)}"`);
  }
  parts.push('Suggest what I should say now.');
  return [{ role: 'user', content: parts.join('\n\n') }];
}

function isSkip(text) {
  return /^\s*\**\s*SKIP\s*\**\s*\.?\s*$/i.test(String(text || ''));
}

function buildNotesSystem(mode, languageCode) {
  const m = MODE_RULES[mode] ? mode : 'general';
  const lang = languageCode && languageCode !== 'auto' && languageName(languageCode) ? languageName(languageCode) : 'the main language of the transcript';
  return [
    `You write concise, accurate notes for a finished ${MODE_LABEL[m]}. Use only what is in the transcript; do not guess.`,
    '"Them" is the other side and "You" is the user.',
    'Return a JSON object with exactly these keys:',
    '- "title": string, at most 8 words',
    '- "summary": string, 2-5 sentences',
    '- "keyPoints": array of short strings',
    '- "actionItems": array of short strings (follow-ups, with the owner when known)',
    '- "decisions": array of short strings (may be empty)',
    m === 'interview'
      ? '- "questionsAsked": array of the main questions the interviewer asked'
      : '- "questionsAsked": array of important questions Them asked (may be empty)',
    m === 'interview'
      ? '- "improvementTips": array of 2-4 specific, kind coaching tips on how the user answered'
      : '- "improvementTips": empty array',
    `Write the values in ${lang}. Return only the JSON object.`,
  ].join('\n');
}

// For long calls keep the opening and the most recent part, dropping the middle.
function trimMiddle(text, maxChars) {
  if (text.length <= maxChars) return text;
  const lines = text.split('\n');
  const headBudget = Math.floor(maxChars * 0.35);
  const tailBudget = maxChars - headBudget;
  const head = [];
  let used = 0;
  for (const l of lines) {
    if (used + l.length + 1 > headBudget) break;
    head.push(l);
    used += l.length + 1;
  }
  const tail = [];
  used = 0;
  for (let i = lines.length - 1; i >= head.length; i--) {
    if (used + lines[i].length + 1 > tailBudget) break;
    tail.unshift(lines[i]);
    used += lines[i].length + 1;
  }
  return [...head, '[... middle of the call left out for length ...]', ...tail].join('\n');
}

function buildNotesMessages({ transcript, context, maxChars = 120000 }) {
  const text = trimMiddle(transcriptText(transcript, { maxLines: 100000, maxChars: Infinity }), maxChars);
  const ctx = [];
  if (context && context.role) ctx.push(`Role: ${clip(context.role, 200)}`);
  if (context && context.company) ctx.push(`Company: ${clip(context.company, 200)}`);
  return [
    {
      role: 'user',
      content: `${ctx.length ? ctx.join('\n') + '\n\n' : ''}Transcript:\n${text || '(empty)'}\n\nWrite the JSON notes now.`,
    },
  ];
}

module.exports = {
  buildAnswerSystem,
  buildAnswerMessages,
  buildNotesSystem,
  buildNotesMessages,
  transcriptText,
  trimMiddle,
  isSkip,
  MAX_TOKENS,
  MODE_LABEL,
};
