'use strict';
// Post-call notes: summary, key points, action items and more, as JSON.

const prompts = require('./prompts');
const { extractJsonObject } = require('./providers/util');

const SIZES = [120000, 30000, 12000];

function isTooBig(err) {
  return err.status === 413 || /too large|too long|tokens per minute|TPM|context (length|window)|maximum.*tokens/i.test(err.message || '');
}

async function generateNotes({ transcript, mode, context, settings, profile, chatStream, getKey }) {
  if (!Array.isArray(transcript) || !transcript.length) throw new Error('Nothing was transcribed, so there is nothing to summarize.');
  // Long calls can exceed a model's (or a free tier's) request size; retry
  // with a shorter transcript if the service says it's too big.
  let text = '';
  for (let i = 0; i < SIZES.length; i++) {
    try {
      text = await chatStream(
        {
          providerId: settings.answers.provider,
          model: settings.answers.model,
          system: prompts.buildNotesSystem(mode, profile.answerLanguage),
          messages: prompts.buildNotesMessages({ transcript, context, maxChars: SIZES[i] }),
          maxTokens: 1800,
          thinking: 'low',
          json: true,
        },
        getKey,
        () => {},
      );
      break;
    } catch (err) {
      if (!isTooBig(err) || i === SIZES.length - 1) throw err;
    }
  }
  const notes = extractJsonObject(text);
  if (!notes) throw new Error('The AI returned notes in an unexpected format. Try "Redo notes" in History.');
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []);
  return {
    title: typeof notes.title === 'string' ? notes.title.trim() : '',
    summary: typeof notes.summary === 'string' ? notes.summary.trim() : '',
    keyPoints: list(notes.keyPoints),
    actionItems: list(notes.actionItems),
    decisions: list(notes.decisions),
    questionsAsked: list(notes.questionsAsked),
    improvementTips: list(notes.improvementTips),
  };
}

module.exports = { generateNotes, isTooBig };
