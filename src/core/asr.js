// src/core/asr.js
// Transcrição de áudio (ASR) com provedores plugáveis — OpenAI Whisper.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const env = (k, d = '') => (process.env[k] ?? d);
const asBool = (v, d=false) => (v == null ? d : ['1','true','yes','y','on'].includes(String(v).toLowerCase()));

const PROVIDER = (env('ASR_PROVIDER', 'openai') || '').toLowerCase();
const MODEL    = env('ASR_MODEL', 'whisper-1');
const OPENAI_KEY = env('OPENAI_API_KEY', '');
const DEBUG_SAVE_AUDIO = asBool(env('ASR_DEBUG_SAVE_AUDIO'), false);

async function saveTemp(buffer, ext = 'ogg') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-asr-'));
  const f = path.join(dir, `in.${ext || 'bin'}`);
  await fs.promises.writeFile(f, buffer);
  return f;
}

async function transcribeWithOpenAI({ buffer, mimeType = 'audio/ogg', model = MODEL, language = 'pt' }) {
  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY não definido');

  const ext = (mimeType.split('/')[1] || 'ogg').replace('+', '_');
  const filePath = await saveTemp(buffer, ext);

  const { default: fetch } = await import('node-fetch');
  const FormData = (await import('form-data')).default;

  const form = new FormData();
  form.append('model', model);
  if (language) form.append('language', language);
  form.append('file', fs.createReadStream(filePath), { filename: `audio.${ext}`, contentType: mimeType });

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI ASR falhou: ${res.status} ${body}`);
  }
  const json = await res.json();
  const out = (json?.text || '').toString().trim();

  try { if (!DEBUG_SAVE_AUDIO) fs.rmSync(path.dirname(filePath), { recursive: true, force: true }); } catch {}
  return out || null;
}

export async function transcribeAudio(params = {}) {
  const {
    buffer,
    mimeType = 'audio/ogg',
    provider = PROVIDER,
    model = MODEL,
    language = 'pt',
  } = params;

  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) return null;

  if ((provider || '').toLowerCase() === 'openai') {
    return await transcribeWithOpenAI({ buffer, mimeType, model, language });
  }
  return null;
}

export default transcribeAudio;
