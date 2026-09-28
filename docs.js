'use strict';
// Extract plain text from a resume or job description file.

const fs = require('fs');
const path = require('path');

const MAX_BYTES = 15 * 1024 * 1024;

async function extractText(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_BYTES) throw new Error('That file is larger than 15 MB.');
  const ext = path.extname(filePath).toLowerCase();
  let text;
  if (ext === '.pdf') {
    const { extractText: pdfText, getDocumentProxy } = await import('unpdf');
    const data = new Uint8Array(fs.readFileSync(filePath));
    const pdf = await getDocumentProxy(data);
    const out = await pdfText(pdf, { mergePages: true });
    text = Array.isArray(out.text) ? out.text.join('\n') : out.text;
  } else if (ext === '.docx') {
    const mammoth = require('mammoth');
    const out = await mammoth.extractRawText({ path: filePath });
    text = out.value;
  } else if (['.txt', '.md', '.markdown', '.text', '.rtf'].includes(ext)) {
    text = fs.readFileSync(filePath, 'utf8');
    if (ext === '.rtf') text = stripRtf(text);
  } else {
    throw new Error('Use a PDF, Word (.docx) or text file.');
  }
  return tidy(text);
}

function tidy(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 60000);
}

function stripRtf(rtf) {
  return rtf
    .replace(/\\par[d]?/g, '\n')
    .replace(/\{\\\*[^}]*\}/g, '')
    .replace(/\\'[0-9a-f]{2}/gi, '')
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, '');
}

module.exports = { extractText, tidy };
