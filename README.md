# CallCue

A Windows desktop app that listens to your calls, transcribes both sides live, suggests what to say when you're asked a question, and writes notes when the call ends. It works with Zoom, Google Meet, Microsoft Teams, phone apps, or anything else that plays audio on your PC.

You bring your own AI key. Groq's free key is enough to run everything.

## Install

1. Run `CallCue-Setup-1.0.0.exe`.
2. The installer isn't code-signed, so Windows SmartScreen may say "Windows protected your PC". Click **More info**, then **Run anyway**.
3. Open CallCue from the Start menu or the desktop shortcut.

## Set up (about 3 minutes)

1. **Add an API key.** Go to **Settings > API keys**. For a free start, create a key at [console.groq.com/keys](https://console.groq.com/keys), paste it next to Groq and press **Save**. CallCue checks the key right away.
2. **Add your background.** Go to **Context**. Pick the call type, fill in the role and company, paste the job description, and paste or **Import** your resume (PDF, Word or text). Answers only use facts from here; CallCue is told never to invent experience you don't have.
3. **Start the call.** Join your meeting as usual, then press **Start call** in CallCue.

## During a call

- **Them** is whatever your computer plays (the other people on the call). **You** is your microphone. The two bars under the Start button show that both are being heard.
- When they ask a question, a suggested answer appears within a few seconds. Small talk like "can you hear me?" is usually skipped.
- **Answer now** or **Ctrl+Shift+Enter** answers the latest question on demand. You can also click any "Them" line in the transcript, or type a question in the box at the bottom.
- Use the arrows on the answer card to go back to earlier answers. The copy button copies the current one.
- Turn **Auto-answer** off if you only want answers when you ask for them.

## After a call

Press **End call**. CallCue saves the call and writes notes: a summary, key points, action items, the questions you were asked and, for interviews, a few tips for next time. Find every call under **History**, where you can re-read the transcript and answers, copy the notes, redo them, export everything to a Markdown file, or delete the call.

## AI services

Pick these in **Settings**. You can mix them, for example Groq for transcription and Claude for answers.

| Service | Transcription | Answers | Cost |
| --- | --- | --- | --- |
| Groq | Whisper Large v3 Turbo | GPT-OSS 120B, Llama 3.3 70B | Free tier |
| Google Gemini | Gemini 3.5 Transcribe | Gemini 3.8 Flash | Free tier |
| OpenAI | GPT-4o mini Transcribe | GPT-6 Luna | Paid |
| Claude | – | Claude Sonnet 5, Haiku 4.5 | Paid |
| Deepgram | Nova-3 | – | Free starter credit |

Model names change often. The refresh button next to each model list loads the current models from that service, and "Other model ID…" lets you type any model name.

For live calls, keep **Thinking** set to **Off** in Settings. It gives the fastest answers.

## Troubleshooting

**The "Them" bar doesn't move.** CallCue captures your Windows default speaker output. In Zoom, Teams or Meet, set the speaker to "Same as system" (or pick the device that is your Windows default), and make sure the call is audible on that device.

**Their words show up as "You".** Your microphone is picking up your speakers. Headphones fix this. CallCue already drops most of these echoes.

**Microphone blocked.** Open Windows Settings > Privacy & security > Microphone and turn on "Let desktop apps access your microphone".

**Rate limit or quota errors.** Free tiers have per-minute limits. Wait a moment, or add a second service and switch to it in Settings.

**Sentences get cut in half.** Increase **Pause before transcribing** in Settings. If background noise gets transcribed, lower **Speech sensitivity**.

## Privacy

- API keys are stored on your PC, encrypted with Windows (DPAPI).
- Audio clips go straight from your PC to the transcription service you picked, and text goes to the answer service you picked. There is no CallCue server.
- Calls, notes and settings are saved in `%APPDATA%\CallCue`. **Settings > Open data folder** takes you there.
- The CallCue window appears in screen shares and recordings like any other app.

## Build from source

Requires Node.js 22 or later.

```bash
npm install
npm start          # run the app
npm test           # unit tests
npm run dist       # build the Windows installer into dist/
```

On GitHub, every push to `main` builds the installer on a Windows machine and attaches it to the repository's Releases page (see `.github/workflows/build-windows.yml`).

The end-to-end test runs the real app with recorded call audio, a local Whisper model and a mock AI service:

```bash
pip install sherpa-onnx numpy
# download and unpack sherpa-onnx-whisper-tiny.en from the sherpa-onnx GitHub releases
CALLCUE_WHISPER_DIR=/path/to/sherpa-onnx-whisper-tiny.en npm run e2e
```

### How it works

```
src/main/            Electron main process (Node)
  main.js            window, system-audio capture handler, IPC
  providers/         OpenAI, Groq, Claude, Gemini, Deepgram adapters
  prompts.js         answer and notes prompts
  store.js           settings, profile, encrypted keys
  sessions.js        saved calls and Markdown export
src/renderer/        the app window
  audio/             capture (loopback + mic), voice detection, WAV encoding
  views/             Live, Context, History, Settings
```

1. Windows loopback audio (the other side) and your microphone are captured separately.
2. A voice detector cuts each stream into utterances at natural pauses.
3. Each utterance is sent as a 16 kHz WAV clip to the transcription service.
4. When the other side finishes a question, the recent transcript plus your context goes to the answer service, and the reply streams onto the answer card.
5. When the call ends, the transcript is summarized into notes and saved.
