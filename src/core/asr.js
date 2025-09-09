// src/core/asr.js
// Transcrição de áudio (ASR). Default: OpenAI Whisper.
// Aceita buffer em memória; devolve string (ou null em erro).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Carrega .env em dev
if (process.env.NODE_ENV !== 'production') {
  try { await import('dotenv/config'); } catch {}
}

const TMP_DIR = path.join(os.tmpdir(), 'matrix-asr');
if (!fs.existsSync(TMP_DIR)) { try { fs.mkdirSync(TMP_DIR, { recursive: true }); } catch {} }

export async function transcribeAudio({ buffer, mimeType = 'audio/ogg', provider = 'openai', model = 'whisper-1', language = 'pt' }) {
  if (!buffer || !buffer.length) return null;

  if (String(provider).toLowerCase() === 'openai') {
    const key = process.env.OPENAI_API_KEY || process.env.OPENAI_KEY;
    if (!key) throw new Error('OPENAI_API_KEY ausente para ASR');

    // Escreve um arquivo temporário (SDK de áudio via file)
    const ext = mimeType.includes('wav') ? 'wav' :
                mimeType.includes('mp3') ? 'mp3' :
                mimeType.includes('m4a') ? 'm4a' :
                mimeType.includes('webm') ? 'webm' : 'ogg';
    const tmpFile = path.join(TMP_DIR, `clip-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
    fs.writeFileSync(tmpFile, buffer);

    // Evita import pesado se não for usar ASR
    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({ apiKey: key });

    try {
      const resp = await client.audio.transcriptions.create({
        file: fs.createReadStream(tmpFile),
        model,
        language, // ajuda em PT-BR
        temperature: 0,
      });
      const txt = resp?.text || '';
      return txt.trim() || null;
    } finally {
      // limpeza best-effort
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  }

  // Provedores futuros (Deepgram, etc.)
  throw new Error(`ASR provider não suportado: ${provider}`);
}

export default transcribeAudio;
