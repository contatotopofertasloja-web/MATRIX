// src/core/asr.js
// Transcrição de áudio (ASR) com provedores plugáveis.
// Suporte pronto: OpenAI Whisper. Fácil extender para outros.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// --------- Utils
const env = (k, d = '') => (process.env[k] ?? d);
const asBool = (v, d=false) => (v == null ? d : ['1','true','yes','y','on'].includes(String(v).toLowerCase()));

// --------- Config (com defaults sensatos)
const PROVIDER = (env('ASR_PROVIDER', 'openai') || '').toLowerCase();    // 'openai' | 'none'
const MODEL    = env('ASR_MODEL', 'whisper-1');                          // whisper-1 (OpenAI)
const OPENAI_KEY = env('OPENAI_API_KEY', '');                            // requerido p/ openai
const DEBUG_SAVE_AUDIO = asBool(env('ASR_DEBUG_SAVE_AUDIO'), false);     // opcional

// Salva buffer em arquivo tmp (debug ou upload por caminho)
async function saveTemp(buffer, ext = 'ogg') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'matrix-asr-'));
  const f = path.join(dir, `in.${ext || 'bin'}`);
  await fs.promises.writeFile(f, buffer);
  return f;
}

// --------- Provedor: OpenAI Whisper
async function transcribeWithOpenAI({ buffer, mimeType = 'audio/ogg', model = MODEL, language = 'pt' }) {
  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY não definido');

  // OpenAI Audio API aceita upload de arquivo; alguns tipos via blob/stream.
  // Para máxima compatibilidade, salvamos temporário e fazemos multipart.
  const ext = (mimeType.split('/')[1] || 'ogg').replace('+', '_');
  const filePath = await saveTemp(buffer, ext);

  // Lazy import para evitar custo quando ASR não é usado
  const { default: fetch } = await import('node-fetch');

  const form = new (await import('form-data')).default();
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
  // json.text contém a transcrição
  const out = (json?.text || '').toString().trim();

  try { if (!DEBUG_SAVE_AUDIO) fs.rmSync(path.dirname(filePath), { recursive: true, force: true }); } catch {}
  return out || null;
}

// --------- API pública
/**
 * Transcreve um áudio em texto.
 * @param {{buffer: Buffer, mimeType?: string, provider?: string, model?: string, language?: string}} params
 * @returns {Promise<string|null>}
 */
export async function transcribeAudio(params = {}) {
  const {
    buffer,
    mimeType = 'audio/ogg',
    provider = PROVIDER,
    model = MODEL,
    language = 'pt',
  } = params;

  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) return null;

  const prov = (provider || '').toLowerCase();

  if (prov === 'openai') {
    return await transcribeWithOpenAI({ buffer, mimeType, model, language });
  }

  // Outros provedores podem entrar aqui no futuro:
  // if (prov === 'assemblyai') return await transcribeWithAssembly({ ... });

  // Provedor desativado/indefinido
  return null;
}

export default transcribeAudio;
