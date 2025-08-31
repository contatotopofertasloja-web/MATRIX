// src/core/asr.js
import OpenAI from 'openai';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PROVIDER = (process.env.ASR_PROVIDER || 'openai').toLowerCase();
const MODEL    = process.env.ASR_MODEL || 'whisper-1';

/**
 * Transcreve Buffer de áudio e retorna string.
 * Salva arquivo temporário apenas para a API aceitar stream de arquivo.
 */
export async function transcribeAudioBuffer(buffer, mimeType = 'audio/ogg') {
  if (PROVIDER !== 'openai') throw new Error(`ASR provider "${PROVIDER}" não implementado`);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const tmp = path.join(os.tmpdir(), `asr-${Date.now()}.${guessExt(mimeType)}`);
  await fs.promises.writeFile(tmp, buffer);

  try {
    const resp = await client.audio.transcriptions.create({
      file: fs.createReadStream(tmp),
      model: MODEL,
      // language: 'pt', // opcional
      // prompt: 'Portuguese WhatsApp voice message...', // opcional
    });
    return resp?.text?.trim() || '';
  } finally {
    fs.promises.unlink(tmp).catch(() => {});
  }
}

function guessExt(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('mp4') || m.includes('m4a')) return 'm4a';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  return 'ogg';
}
