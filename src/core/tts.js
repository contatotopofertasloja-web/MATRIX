// src/core/tts.js
// TTS neutro (OpenAI gpt-4o-mini-tts). Retorna { buffer, mime }.

import OpenAI from "openai";

const env = (k, d = "") =>
  process.env[k] === undefined || process.env[k] === null || process.env[k] === ""
    ? d
    : String(process.env[k]);

const TTS_PROVIDER = env("TTS_PROVIDER", "openai");
const TTS_MODEL    = env("TTS_MODEL", "gpt-4o-mini-tts");
const TTS_VOICE    = env("TTS_VOICE", "alloy");
const TTS_FORMAT   = env("TTS_FORMAT", "ogg");
const TTS_LANG     = env("ASR_LANG", "pt");

function fmtInfo(requested = TTS_FORMAT) {
  const want = String(requested || "").toLowerCase();
  if (want === "mp3") return { api: "mp3", mime: "audio/mpeg", ext: "mp3" };
  if (want === "wav") return { api: "wav", mime: "audio/wav", ext: "wav" };
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

export async function synthesizeTTS(opts = {}) {
  const text = (opts.text || "").toString().trim();
  if (!text) return null;

  const voice = (opts.voice || TTS_VOICE).toString();
  const fmt   = fmtInfo(opts.format);
  const provider = (opts.provider || TTS_PROVIDER).toLowerCase();
  if (provider !== "openai") return null;

  const client = getOpenAI();
  if (!client) return null;

  const resp = await client.audio.speech.create({
    model: TTS_MODEL,
    voice,
    input: text,
    format: fmt.api,
  });

  const ab = await resp.arrayBuffer();
  const buffer = Buffer.from(ab);
  return { buffer, mime: fmt.mime };
}

export const speak = synthesizeTTS;
export default { synthesizeTTS, speak };
