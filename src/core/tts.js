// src/core/tts.js
// -----------------------------------------------------------------------------
// TTS neutro do core (sem "cheiro" de bot).
// Fornecedor: OpenAI (gpt-4o-mini-tts). Se não houver chave, retorna null.
// Exporte: synthesizeTTS({ text, voice?, language?, format? }) -> { buffer, mime }
// -----------------------------------------------------------------------------

import OpenAI from "openai";

const env = (k, d = "") =>
  process.env[k] === undefined || process.env[k] === null || process.env[k] === ""
    ? d
    : String(process.env[k]);

const TTS_PROVIDER = env("TTS_PROVIDER", "openai"); // "openai" | "none"
const TTS_MODEL    = env("TTS_MODEL", "gpt-4o-mini-tts");
const TTS_VOICE    = env("TTS_VOICE", "alloy");
const TTS_FORMAT   = env("TTS_FORMAT", "ogg"); // "ogg" | "mp3" | "wav"
const TTS_LANG     = env("ASR_LANG", "pt");    // mantemos nomenclatura do core

function fmtInfo(requested = TTS_FORMAT) {
  const want = String(requested || "").toLowerCase();
  if (want === "mp3")
    return { api: "mp3", mime: "audio/mpeg", ext: "mp3" };
  if (want === "wav")
    return { api: "wav", mime: "audio/wav", ext: "wav" };
  // padrão: ogg/opus
  return { api: "opus", mime: "audio/ogg", ext: "ogg" };
}

let openai = null;
function getOpenAI() {
  if (!openai) {
    const key = process.env.OPENAI_API_KEY || "";
    if (!key) return null;
    openai = new OpenAI({ apiKey: key });
  }
  return openai;
}

/**
 * Gera áudio de fala.
 * @param {Object} opts
 * @param {string} opts.text - Texto a ser falado (obrigatório)
 * @param {string} [opts.voice] - Voz (ex.: alloy, verse, aria…)
 * @param {string} [opts.language] - Língua principal ("pt" etc.) — apenas informativo
 * @param {string} [opts.format] - "ogg" (opus), "mp3" ou "wav"
 * @returns {Promise<{buffer: Buffer, mime: string}|null>}
 */
export async function synthesizeTTS(opts = {}) {
  const text = (opts.text || "").toString().trim();
  if (!text) return null;

  const voice = (opts.voice || TTS_VOICE).toString();
  const fmt   = fmtInfo(opts.format);
  const provider = (opts.provider || TTS_PROVIDER).toLowerCase();

  if (provider !== "openai") return null;

  const client = getOpenAI();
  if (!client) return null;

  // OpenAI: audio.speech.create({ model, voice, input, format })
  // format: "mp3" | "wav" | "opus"
  const resp = await client.audio.speech.create({
    model: TTS_MODEL,
    voice,
    input: text,
    format: fmt.api, // "opus"->OGG/Opus
  });

  const ab = await resp.arrayBuffer();
  const buffer = Buffer.from(ab);
  return { buffer, mime: fmt.mime };
}

// alias amigável
export const speak = synthesizeTTS;
export default { synthesizeTTS, speak };
